import { FixtureStory } from "@autosoccer/contracts";
import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { buildHandlers } from "../../jobs/handlers.ts";
import { createWorker } from "../../jobs/worker.ts";
import { offlineManagerLlm } from "../agents/offline.ts";
import { managerRoundHook, seedManagers } from "../agents/service.ts";
import { auditPublishedArticles } from "../editorial/audit.ts";
import { prematchFacts } from "../editorial/facts.ts";
import { type ArticleDraft, checkGrounding } from "../editorial/grounding.ts";
import { offlineEditorialLlm } from "../editorial/offline.ts";
import { enqueuePreviews, PREVIEW_JOB, seedJournalists, writePreview } from "../editorial/service.ts";
import { standingRows } from "../league/read.ts";
import { SEED_TEAMS } from "../league/seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "../league/service.ts";
import { fixtureStory } from "./read.ts";

const MODEL = "claude-opus-5-5";

describe("fixture stories over a season", () => {
  let t: TestDatabase;
  let seasonId: string;
  /** Pre-match facts of every round-2 fixture, captured before round 2 kicked off. */
  const earlyFacts = new Map<string, unknown>();
  /** Stories of a round-2 fixture captured at each stage it passed through. */
  const stages: string[] = [];
  let watched: string;
  const app = () => createApp({ db: t.db, store: new MemoryReplayStore() });

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedTeams(t.db);
    ({ seasonId } = await createSeason(t.db, {
      slug: "season-1",
      name: "Season 1",
      seed: 20261115,
      budgetPerTeamMicroUsd: 1_000_000,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      startsAt: new Date("2026-11-15T12:00:00Z"),
      roundIntervalMinutes: 240,
      playersPerTeam: 7,
    }));
    await seedManagers(t.db, seasonId, MODEL);
    await seedJournalists(t.db, MODEL);
    const worker = createWorker({
      db: t.db,
      handlers: buildHandlers({
        db: t.db,
        store: new MemoryReplayStore(),
        llm: offlineManagerLlm(MODEL),
        editorialLlm: offlineEditorialLlm(MODEL),
        halfDurationSec: 30,
      }),
    });
    const [r2] = await t.db<{ id: string }[]>`
      select id from fixtures where season_id = ${seasonId} and round = 2 order by id limit 1`;
    watched = r2!.id;
    const hook = managerRoundHook(t.db);
    const note = async () => {
      const s = await fixtureStory(t.db, watched, new Date("2026-11-15T12:00:00Z"));
      if (stages.at(-1) !== s!.stage) stages.push(s!.stage);
    };
    for (let i = 0; i < 100; i++) {
      await enqueuePreviews(t.db, seasonId);
      const [open] = await t.db<{ round: number }[]>`
        select min(round)::int as round from fixtures where season_id = ${seasonId} and status <> 'completed'`;
      if (open?.round === 2 && earlyFacts.size === 0) {
        for (const f of await t.db<
          { id: string }[]
        >`select id from fixtures where season_id = ${seasonId} and round = 2`)
          earlyFacts.set(f.id, await prematchFacts(t.db, f.id));
      }
      await note();
      const a = await advanceSeason(t.db, seasonId, { beforeRound: hook });
      await note();
      if (a.state === "completed") break;
      await worker.drain();
      await note();
    }
    await worker.drain();
  }, 300_000);
  afterAll(async () => {
    await t.drop();
  });

  it("serves a contract-valid story for every fixture, at a stable fixture URL", async () => {
    const ids = await t.db<{ id: string }[]>`select id from fixtures where season_id = ${seasonId}`;
    for (const { id } of ids) {
      const res = await app().request(`/api/v1/fixtures/${id}/story`);
      expect(res.status).toBe(200);
      const s = FixtureStory.parse(await res.json());
      expect(s).toMatchObject({ contract: "fixture-story/1", fixtureId: id, stage: "completed", timezone: "UTC" });
    }
    expect((await app().request("/api/v1/fixtures/not-a-uuid/story")).status).toBe(404);
    expect((await app().request("/api/v1/fixtures/00000000-0000-4000-8000-000000000000/story")).status).toBe(404);
  });

  it("moves through the stages from official state: awaiting decisions → prepared → playing → completed", () => {
    expect(stages[0]).toBe("scheduled");
    expect(stages).toContain("awaiting_decisions");
    expect(stages).toContain("prepared");
    expect(stages.at(-1)).toBe("completed");
    expect(stages.indexOf("awaiting_decisions")).toBeLessThan(stages.indexOf("completed"));
  });

  it("pre-match facts are exactly what was known before kickoff: no hindsight, however late they're read", async () => {
    expect(earlyFacts.size).toBe(2);
    for (const [id, early] of earlyFacts) {
      const late = await prematchFacts(t.db, id);
      // Tactics committed at kickoff are the only addition; everything else is identical.
      expect({ ...late, facts: late.facts.filter((f) => !f.id.includes(":tactics:")) }).toEqual(early);
      const [own] = await t.db<{ id: string }[]>`select id from matches where fixture_id = ${id}`;
      for (const f of late.facts) {
        expect(f.id).not.toContain(own!.id);
        expect(f.id).not.toMatch(/:r[2-9]:/); // nothing after round 1
      }
      // The table in the story is the snapshot after round 1, matching the official standings then.
      const story = (await fixtureStory(t.db, id))!;
      const { rows } = await standingRows(t.db, seasonId, { throughRound: 1 });
      for (const s of [story.home, story.away]) {
        const row = rows.find((r) => r.team.id === s.team.id)!;
        expect(s.before).toEqual({ afterRound: 1, position: row.position, points: row.points, played: 1 });
      }
      expect(story.prematch.asOfRound).toBe(1);
      // Every prematch line cites facts that exist in the prematch facts.
      const ids = new Set(story.prematch.facts.map((f) => f.id));
      for (const l of story.prematch.lines) for (const fid of l.factIds) expect(ids.has(fid)).toBe(true);
    }
  });

  it("says what changed: the official result, the table movement and each club's next fixture", async () => {
    const fixtures = await t.db<{ id: string; round: number }[]>`
      select id, round from fixtures where season_id = ${seasonId} order by round, id`;
    for (const f of fixtures) {
      const s = (await fixtureStory(t.db, f.id))!;
      const [m] = await t.db<{ home_score: number; away_score: number }[]>`
        select home_score, away_score from matches where fixture_id = ${f.id}`;
      expect(s.match!.score).toEqual({ home: m!.home_score, away: m!.away_score });
      const post = s.postmatch!;
      expect(post.lines[0]!.text).toContain(`${m!.home_score}–${m!.away_score}`);
      const goals = post.lines.find((l) => l.kind === "goals")!;
      if (m!.home_score + m!.away_score === 0) expect(goals.text).toBe("No goals were scored.");
      else expect(goals.factIds).toHaveLength(m!.home_score + m!.away_score);
      const { rows } = await standingRows(t.db, seasonId, { throughRound: f.round });
      for (const side of [s.home, s.away]) {
        const row = rows.find((r) => r.team.id === side.team.id)!;
        expect(side.after).toEqual({
          afterRound: f.round,
          position: row.position,
          points: row.points,
          played: f.round,
        });
        if (f.round < 6) expect(side.next!.round).toBe(f.round + 1);
        else expect(side.next).toBeNull();
      }
      const ids = new Set(post.facts.map((x) => x.id));
      for (const l of post.lines) for (const fid of l.factIds) expect(ids.has(fid)).toBe(true);
      // Managers' lessons are labelled as their interpretation, never as the record.
      for (const l of post.lines.filter((x) => x.text.includes("took this lesson")))
        expect(l).toMatchObject({ source: "interpretation", factIds: [] });
    }
  });

  it("publishes exactly one grounded preview per fixture, before kickoff, linked from the story", async () => {
    const previews = await t.db<{ fixture_id: string; published_at: Date; started_at: Date; status: string }[]>`
      select a.fixture_id, a.published_at, m.started_at, a.status from articles a
      join matches m on m.fixture_id = a.fixture_id where a.kind = 'preview'`;
    const rejected = await t.db<{ error: string }[]>`
      select r.error from articles a join agent_runs r on r.id = a.agent_run_id where a.status = 'rejected'`;
    expect(rejected.map((r) => r.error)).toEqual([]);
    expect(previews).toHaveLength(12);
    expect(new Set(previews.map((p) => p.fixture_id)).size).toBe(12);
    for (const p of previews) {
      expect(p.status).toBe("published");
      expect(p.published_at.getTime()).toBeLessThan(p.started_at.getTime());
    }
    const s = (await fixtureStory(t.db, watched))!;
    expect(s.articles.preview?.kind).toBe("preview");
    expect(s.articles.report?.kind).toBe("match_report");
    expect(await auditPublishedArticles(t.db)).toEqual([]);
  });

  it("is idempotent and never writes a preview once the fixture has kicked off", async () => {
    await enqueuePreviews(t.db, seasonId);
    const [jobs] = await t.db<{ n: number }[]>`select count(*)::int as n from jobs where kind = ${PREVIEW_JOB}`;
    expect(jobs!.n).toBe(12);
    const deps = { db: t.db, llm: offlineEditorialLlm(MODEL) };
    expect(await writePreview(deps, watched)).toEqual({ status: "skipped-kicked-off" });
    const [n] = await t.db<{ n: number }[]>`select count(*)::int as n from articles where kind = 'preview'`;
    expect(n!.n).toBe(12);
  });

  it("rejects previews that report the unplayed result, invent history or state predictions as fact", async () => {
    const [f] = await t.db<{ id: string }[]>`
      select f.id from fixtures f where f.season_id = ${seasonId} and f.round = 1 order by f.id limit 1`;
    const facts = await prematchFacts(t.db, f!.id);
    const fixture = facts.facts.find((x) => x.kind === "fixture")!;
    const v = fixture.value as { homeTeam: { name: string }; awayTeam: { name: string } };
    const [home, away] = [v.homeTeam.name, v.awayTeam.name];
    const draft = (body: string): ArticleDraft => ({
      headline: `${home} v ${away}`,
      standfirst: "A preview.",
      body,
      citations: [{ factId: fixture.id, text: fixture.statement }],
    });
    const opts = { preview: { fixtureFact: fixture.id } };
    const ok = (body: string) => expect(checkGrounding(draft(body), facts, opts)).toEqual([]);
    const bad = (body: string, re: RegExp) => expect(checkGrounding(draft(body), facts, opts).join("\n")).toMatch(re);
    ok(`${home} host ${away} in round 1.`);
    ok(`Prediction: ${home} could beat ${away}.`);
    bad(`${home} beat ${away}.`, /no official result between/);
    bad(`${home} will beat ${away}.`, /label .* as a prediction/);
    bad(`${home} won 2–1.`, /2–1 is not an official score/);
    bad(`After round 1, ${home} are top.`, /written before round 1 kicks off/);
    bad(`${home} are the defending champions.`, /no earlier season is on record/);
    expect(checkGrounding({ ...draft("x"), citations: [] }, facts, opts).join("\n")).toMatch(/must cite the fixture/);
  });

  it("rejects wrong winners of earlier meetings, false runs of form and false title history, even with valid citations", async () => {
    // A round-4+ fixture: the clubs met earlier this season.
    const [f] = await t.db<{ id: string }[]>`
      select f.id from fixtures f where f.season_id = ${seasonId} and f.round >= 4 and exists (
        select 1 from matches m join fixtures g on g.id = m.fixture_id
        where g.season_id = f.season_id and g.round < f.round and m.home_score <> m.away_score
          and g.home_team_id in (f.home_team_id, f.away_team_id) and g.away_team_id in (f.home_team_id, f.away_team_id))
      order by f.round limit 1`;
    const facts = await prematchFacts(t.db, f!.id);
    const fixture = facts.facts.find((x) => x.kind === "fixture")!;
    const meeting = facts.facts.find((x) => x.statement.startsWith("Earlier meeting") && /\d–\d/.test(x.statement))!;
    const v = meeting.value as { home: number; away: number; homeTeam: { name: string }; awayTeam: { name: string } };
    const [winner, loser] = v.home > v.away ? [v.homeTeam.name, v.awayTeam.name] : [v.awayTeam.name, v.homeTeam.name];
    const cites = [
      { factId: fixture.id, text: fixture.statement },
      { factId: meeting.id, text: meeting.statement },
    ];
    const check = (body: string) =>
      checkGrounding({ headline: "Preview", standfirst: "A preview.", body, citations: cites }, facts, {
        preview: { fixtureFact: fixture.id },
      }).join("\n");
    expect(check(`Earlier this season ${winner} beat ${loser}.`)).toBe("");
    expect(check(`Earlier this season ${loser} beat ${winner}.`)).toMatch(/contradiction/);
    // Runs of form are checked against the table's form column as of the previous round.
    const row = facts.facts.find((x) => x.id.startsWith("standing:") && x.statement.startsWith(winner))!;
    const form = (row.value as { form: string[] }).form;
    const wins = form
      .slice()
      .reverse()
      .findIndex((r) => r !== "W");
    const streak = wins === -1 ? form.length : wins;
    if (streak < form.length)
      expect(check(`${winner} have won their last ${streak + 1} league matches.`)).toMatch(
        /last \d results? after round/,
      );

    // A second season: history exists, and must be told straight.
    await t.db`update seasons set status = 'completed', completed_at = now() where id = ${seasonId}`;
    const { seasonId: next } = await createSeason(t.db, {
      slug: "season-2",
      name: "Season 2",
      seed: 2,
      budgetPerTeamMicroUsd: 1_000_000,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      startsAt: new Date("2026-11-16T12:00:00Z"),
      roundIntervalMinutes: 240,
      playersPerTeam: 7,
    });
    const { rows } = await standingRows(t.db, seasonId);
    const champion = rows[0]!.team.name;
    const other = rows[1]!.team.name;
    const [g] = await t.db<{ id: string }[]>`select id from fixtures where season_id = ${next} and round = 1 limit 1`;
    const hf = await prematchFacts(t.db, g!.id);
    const hfix = hf.facts.find((x) => x.kind === "fixture")!;
    const hcheck = (body: string) =>
      checkGrounding(
        { headline: "Preview", standfirst: "A preview.", body, citations: [{ factId: hfix.id, text: hfix.statement }] },
        hf,
        { preview: { fixtureFact: hfix.id } },
      ).join("\n");
    expect(hcheck(`${champion} are the defending champions.`)).toBe("");
    expect(hcheck(`${other} are the defending champions.`)).toMatch(/calls .* the defending champions, but they are/);
    expect(hcheck(`${champion} are chasing a third straight title.`)).toMatch(/run of 2 titles/);
    expect(hcheck(`${other} have won the last two titles.`)).toMatch(/run of 2 titles/);
  });
});

describe("fixture story edge states", () => {
  let t: TestDatabase;
  let seasonId: string;
  beforeAll(async () => {
    t = await createTestDatabase();
    await seedTeams(t.db);
    ({ seasonId } = await createSeason(t.db, {
      slug: "season-1",
      name: "Season 1",
      seed: 1,
      budgetPerTeamMicroUsd: 1_000_000,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      startsAt: new Date("2026-11-15T12:00:00Z"),
      roundIntervalMinutes: 240,
      playersPerTeam: 7,
    }));
  });
  afterAll(async () => {
    await t.drop();
  });

  it("round 1 has no table or form to cite, and says so by leaving them out", async () => {
    const [f] = await t.db<
      { id: string }[]
    >`select id from fixtures where season_id = ${seasonId} and round = 1 limit 1`;
    const s = (await fixtureStory(t.db, f!.id, new Date("2026-11-15T11:00:00Z")))!;
    expect(s.stage).toBe("scheduled");
    expect(s.prematch.asOfRound).toBe(0);
    expect(s.home.before).toBeNull();
    expect(s.prematch.lines.map((l) => l.kind)).toEqual(["fixture"]);
    expect(s.postmatch).toBeNull();
    expect(s.match).toBeNull();
    expect(s.home.decision?.status).toBe("opening"); // the pre-season plan, not a decision for this match
  });

  it("is delayed once kickoff has passed without the match starting, and failed when the match job failed", async () => {
    const [f] = await t.db<
      { id: string }[]
    >`select id from fixtures where season_id = ${seasonId} and round = 1 limit 1`;
    expect((await fixtureStory(t.db, f!.id, new Date("2026-11-15T13:00:00Z")))!.stage).toBe("delayed");
    await t.db`update fixtures set status = 'ready' where id = ${f!.id}`;
    expect((await fixtureStory(t.db, f!.id, new Date("2026-11-15T12:05:00Z")))!.stage).toBe("prepared");
    await t.db`insert into jobs (kind, idempotency_key, payload, status) values ('match.play', ${`match.play:${f!.id}`}, ${t.db.json({ fixtureId: f!.id })}, 'failed')`;
    expect((await fixtureStory(t.db, f!.id))!.stage).toBe("failed");
  });
});
