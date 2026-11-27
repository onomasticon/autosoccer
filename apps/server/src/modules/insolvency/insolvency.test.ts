import {
  ArticleDetailResponse,
  ArticleListResponse,
  ClubFinancesResponse,
  FixtureStory,
  FixturesResponse,
  StandingsResponse,
  TeamDetailResponse,
} from "@autosoccer/contracts";
import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { buildHandlers } from "../../jobs/handlers.ts";
import { createWorker } from "../../jobs/worker.ts";
import { offlineManagerLlm } from "../agents/offline.ts";
import { managerRoundHook, seedManagers } from "../agents/service.ts";
import { prematchFacts } from "../editorial/facts.ts";
import { enqueueNews, NEWS_PRIORITY, type NewsSubject } from "../editorial/news.ts";
import { offlineEditorialLlm } from "../editorial/offline.ts";
import { seedJournalists, writeNews } from "../editorial/service.ts";
import { RULES } from "../finance/rules.ts";
import { settleFinances } from "../finance/settle.ts";
import { forfeitOf, seasonTeams, standingRows } from "../league/read.ts";
import { rolloverSeason } from "../league/rollover.ts";
import { SEED_TEAMS } from "../league/seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "../league/service.ts";
import { computeStandings } from "../league/standings.ts";
import { checkSolvency, resolveForfeits } from "./check.ts";
import { rebrandName, shortNameFor } from "./rules.ts";
import { rescueClubs } from "./takeover.ts";

const MODEL = "claude-opus-5-5";

describe("insolvency/1 rules", () => {
  it("a walkover is 3 points and a win for the club still in, with no goals; void counts for nobody", () => {
    const rows = computeStandings(
      ["a", "b", "c"],
      [
        { round: 1, home: "a", away: "b", homeGoals: 2, awayGoals: 1 },
        { round: 2, home: "b", away: "c", homeGoals: 0, awayGoals: 0, walkover: "away" },
        { round: 3, home: "c", away: "a", homeGoals: 0, awayGoals: 0, walkover: "void" },
      ],
      (t) => t,
      new Map([["b", 2]]),
    );
    const by = new Map(rows.map((r) => [r.team, r]));
    expect(by.get("c")).toMatchObject({ played: 1, won: 1, points: 3, goalsFor: 0, goalDifference: 0, walkovers: 1 });
    expect(by.get("b")).toMatchObject({ played: 2, lost: 2, points: 0, goalsFor: 1, forfeits: 1, withdrawnFrom: 2 });
    expect(by.get("a")).toMatchObject({ played: 1, points: 3 });
    // A withdrawn club is placed below every club still in, whatever its points.
    expect(rows.map((r) => r.team)).toEqual(["a", "c", "b"]);
  });

  it("forfeits: a walkover to the club still in, void when both have withdrawn, nothing before the round", () => {
    const f = { round: 4, home_team_id: "h", away_team_id: "a" };
    expect(forfeitOf(f, new Map())).toBeNull();
    expect(forfeitOf(f, new Map([["h", 5]]))).toBeNull();
    expect(forfeitOf(f, new Map([["h", 4]]))).toEqual({ kind: "walkover", awardedTo: "a", withdrawn: ["h"] });
    expect(
      forfeitOf(
        f,
        new Map([
          ["h", 4],
          ["a", 2],
        ]),
      )?.kind,
    ).toBe("void");
  });

  it("rebrands after the city, with initials", () => {
    expect(rebrandName("Harbour City", "Phoenix")).toBe("Harbour City Phoenix");
    expect(shortNameFor("Harbour City Phoenix")).toBe("HCP");
    expect(shortNameFor("Northgate Phoenix")).toBe("NOP");
  });
});

describe("bankruptcy through the season lifecycle", () => {
  let t: TestDatabase;
  let s1: string;
  let s2: string;
  const ids: Record<string, string> = {};
  let first: string; // withdraws before round 4
  let second: string; // withdraws before round 5 (first's round-6 opponent)
  const before: Record<string, { name: string; shortName: string }> = {};
  const app = () => createApp({ db: t.db, store: new MemoryReplayStore() });
  const get = async <T>(path: string, schema: { parse: (x: unknown) => T }) => {
    const res = await app().request(`/api/v1${path}`);
    expect(res.status).toBe(200);
    return schema.parse(await res.json());
  };
  const worker = () =>
    createWorker({
      db: t.db,
      baseBackoffMs: 1,
      handlers: buildHandlers({
        db: t.db,
        store: new MemoryReplayStore(),
        llm: offlineManagerLlm(MODEL),
        halfDurationSec: 30,
      }),
    });

  /** Plays rounds until `through` is complete; every tick is repeated, as a retry would. */
  async function play(seasonId: string, through = 99) {
    const w = worker();
    const hook = managerRoundHook(t.db);
    for (let i = 0; i < 80; i++) {
      const [open] = await t.db<{ round: number | null }[]>`
        select min(round)::int as round from fixtures where season_id = ${seasonId} and status <> 'completed'`;
      if (open?.round != null && open.round > through) break;
      const a = await advanceSeason(t.db, seasonId, { beforeRound: hook });
      await advanceSeason(t.db, seasonId, { beforeRound: hook });
      if (a.state === "completed") break;
      await w.drain();
    }
  }

  /** Spends a club's cash down to `left` (a ledger entry, as a costly signing would). */
  async function drain(teamId: string, left: number, key: string) {
    const [b] = await t.db<{ b: string }[]>`select sum(amount)::text as b from club_ledger where team_id = ${teamId}`;
    await t.db`
      insert into club_ledger (team_id, season_id, round, kind, amount, key, rule, memo)
      values (${teamId}, ${s1}, null, 'transfer', ${left - Number(b!.b)}, ${key}, 'finance/1', 'Test: a costly signing')`;
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    for (const [slug, id] of await seedTeams(t.db)) ids[slug] = id;
    for (const s of SEED_TEAMS) before[s.slug] = { name: s.name, shortName: s.shortName };
    ({ seasonId: s1 } = await createSeason(t.db, {
      slug: "season-1",
      name: "Season 1",
      seed: 20261125,
      budgetPerTeamMicroUsd: 1_000_000,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      startsAt: new Date("2026-11-15T12:00:00Z"),
      roundIntervalMinutes: 240,
      playersPerTeam: 7,
    }));
    await seedManagers(t.db, s1, MODEL);
    first = ids["harbour-city"]!;
    const [r6] = await t.db<{ opp: string }[]>`
      select case when home_team_id = ${first} then away_team_id else home_team_id end as opp
      from fixtures where season_id = ${s1} and round = 6 and ${first}::uuid in (home_team_id, away_team_id)`;
    second = r6!.opp;
    await play(s1, 3);
    // The first club can't cover round 4's wages; the check runs as soon as round 4 is next.
    await drain(first, 100_000, "test:drain:first");
    await play(s1, 4);
    await drain(second, 50_000, "test:drain:second");
    await play(s1);
    s2 = (
      await t.db<{ id: string }[]>`
        select id from seasons where slug = ${(await rolloverSeason(t.db, { managerModel: MODEL, editorialModel: MODEL, clubs: 4 }))!}`
    )[0]!.id;
  }, 600_000);
  afterAll(async () => {
    await t.drop();
  });

  it("declares each club bankrupt once, from the round it can't pay, with the numbers behind it", async () => {
    const w = await t.db<{ team_id: string; effective_round: number; reason: string; basis: { wages: number } }[]>`
      select team_id, effective_round, reason, basis from club_withdrawals where season_id = ${s1} order by effective_round`;
    expect(w.map((x) => [x.team_id, x.effective_round])).toEqual([
      [first, 4],
      [second, 5],
    ]);
    expect(w[0]!.reason).toMatch(/^Couldn't pay round 4 wages: Ȼ[\d,]+ due with Ȼ100,000 available\.$/);
    // Retried checks, for a round already released or still to come, change nothing.
    for (const r of [4, 5, 6]) expect(await checkSolvency(t.db, s1, r)).toEqual([]);
    expect(await resolveForfeits(t.db, s1, 6)).toBe(0);
  });

  it("resolves every remaining fixture exactly once: walkovers and a void, never simulated", async () => {
    const fx = await t.db<
      {
        id: string;
        round: number;
        home_team_id: string;
        away_team_id: string;
        status: string;
        outcome: string | null;
        walkover_team_id: string | null;
        matches: number;
        jobs: number;
      }[]
    >`
      select f.id, f.round, f.home_team_id, f.away_team_id, f.status, f.outcome, f.walkover_team_id,
        (select count(*)::int from matches m where m.fixture_id = f.id) as matches,
        (select count(*)::int from jobs j where j.payload->>'fixtureId' = f.id::text) as jobs
      from fixtures f where f.season_id = ${s1} order by f.round, f.id`;
    expect(fx.every((f) => f.status === "completed")).toBe(true);
    const gone = new Map([
      [first, 4],
      [second, 5],
    ]);
    for (const f of fx) {
      const ff = forfeitOf(f, gone);
      if (!ff) {
        expect([f.outcome, f.matches]).toEqual([null, 1]);
        continue;
      }
      // No match row, so no events, lineups, goals or replay; no match or manager jobs either.
      expect([f.outcome, f.walkover_team_id, f.matches, f.jobs]).toEqual([ff.kind, ff.awardedTo, 0, 0]);
    }
    expect(fx.filter((f) => f.outcome === "walkover")).toHaveLength(3);
    expect(fx.filter((f) => f.outcome === "void").map((f) => f.round)).toEqual([6]);
    const [replays] = await t.db<{ n: number }[]>`
      select count(*)::int as n from replay_artifacts r join matches m on m.id = r.match_id
      join fixtures f on f.id = m.fixture_id where f.season_id = ${s1} and f.outcome is not null`;
    expect(replays!.n).toBe(0);
  });

  it("the table: walkovers are 3 points with no goals, withdrawn clubs last, ineligible for the title", async () => {
    const { rows } = await standingRows(t.db, s1);
    expect(new Map(rows.slice(-2).map((r) => [r.team.id, r.withdrawn]))).toEqual(
      new Map([
        [first, { round: 4 }],
        [second, { round: 5 }],
      ]),
    );
    expect(rows.slice(0, 2).every((r) => r.withdrawn === null)).toBe(true);
    for (const r of rows) expect(r.played).toBe(r.team.id === first || r.team.id === second ? 5 : 6);
    // Goals only come from matches that were played.
    const [g] = await t.db<{ gf: number }[]>`
      select coalesce(sum(m.home_score + m.away_score), 0)::int as gf from matches m join fixtures f on f.id = m.fixture_id
      where f.season_id = ${s1}`;
    expect(rows.reduce((s, r) => s + r.goalsFor, 0)).toBe(g!.gf);
    // Round 4: one walkover; round 5: two; round 6: the two withdrawn clubs meet (void).
    expect(rows.reduce((s, r) => s + (r.walkovers ?? 0), 0)).toBe(3);
    expect(rows.find((r) => r.team.id === first)!.forfeits).toBe(2);
    const api = await get(`/seasons/season-1/standings`, StandingsResponse);
    expect(api.race.clinched?.id).toBe(rows[0]!.team.id);
    expect(api.withdrawals?.map((w) => [w.team.id, w.round])).toEqual([
      [first, 4],
      [second, 5],
    ]);
  });

  it("money: wages stop from the withdrawal round, no prize for withdrawn clubs, prizes once for the rest", async () => {
    const pay = await t.db<{ team_id: string; rounds: number[] }[]>`
      select team_id, array_agg(round order by round) as rounds from club_ledger
      where season_id = ${s1} and kind = 'payroll' group by team_id`;
    const rounds = new Map(pay.map((p) => [p.team_id, p.rounds]));
    expect(rounds.get(first)).toEqual([1, 2, 3]);
    expect(rounds.get(second)).toEqual([1, 2, 3, 4]);
    const prizes = await t.db<{ team_id: string; amount: string; basis: { position: number } }[]>`
      select team_id, amount::text, basis from club_ledger where season_id = ${s1} and kind = 'prize' order by amount desc`;
    expect(prizes.map((p) => p.team_id)).not.toContain(first);
    expect(prizes.map((p) => p.team_id)).not.toContain(second);
    expect(prizes.map((p) => [Number(p.amount), p.basis.position])).toEqual([
      [RULES.prize[0], 1],
      [RULES.prize[1], 2],
    ]);
    // No result income for a walkover.
    const [wo] = await t.db<{ n: number }[]>`
      select count(*)::int as n from club_ledger l join fixtures f on f.id = (l.basis->>'fixtureId')::uuid
      where l.kind = 'result' and f.outcome is not null`;
    expect(wo!.n).toBe(0);
    expect(await settleFinances(t.db, s1)).toBe(0);
  });

  it("Matchday and fixtures show the forfeit: who withdrew, why, and who is awarded the walkover", async () => {
    const fixtures = await get(`/seasons/season-1/fixtures`, FixturesResponse);
    const wo = fixtures.rounds.flatMap((r) => r.fixtures).find((f) => f.forfeit?.kind === "walkover")!;
    expect(wo.matchId).toBeNull();
    expect(wo.score).toBeNull();
    const story = await get(`/fixtures/${wo.id}/story`, FixtureStory);
    expect(story.stage).toBe("forfeited");
    expect(story.match).toBeNull();
    expect(story.forfeit?.awardedTo?.id).toBe(wo.forfeit!.awardedTo);
    expect(story.forfeit?.withdrawn[0]?.reason).toMatch(/^Couldn't pay round/);
  });

  it("a takeover rescues each club once for the next season: recapitalised and renamed, slot and slug kept", async () => {
    const teams = await t.db<{ id: string; slug: string; name: string; short_name: string }[]>`
      select id, slug, name, short_name from teams where id in (${first}, ${second})`;
    for (const team of teams) {
      expect(team.name).not.toBe(before[team.slug]!.name);
      expect(team.name.endsWith(" Phoenix")).toBe(true);
      const [{ b }] = (await t.db<{ b: string }[]>`
        select sum(amount)::text as b from club_ledger where team_id = ${team.id}`) as unknown as [{ b: string }];
      // Back to the opening balance before the window (no deals here: the test season has no window yet).
      const [w] = await t.db<{ n: number }[]>`
        select count(*)::int as n from transfer_bids where status = 'completed' and ${team.id}::uuid in (buyer_team_id, seller_team_id)`;
      if (!w!.n) expect(Number(b)).toBe(RULES.opening);
    }
    const [st] = await t.db<{ n: number }[]>`
      select count(*)::int as n from season_teams where season_id = ${s2} and team_id in (${first}, ${second})`;
    expect(st!.n).toBe(2);
    expect(await rescueClubs(t.db, s1, s2)).toEqual([]);
    const [l] = await t.db<{ n: number }[]>`select count(*)::int as n from club_ledger where kind = 'takeover'`;
    expect(l!.n).toBe(2);
    // History keeps the old names; today's pages use the new ones.
    const old = await seasonTeams(t.db, s1);
    expect(old.get(first)!.name).toBe(before["harbour-city"]!.name);
    expect((await seasonTeams(t.db, s2)).get(first)!.name).toBe(teams.find((x) => x.id === first)!.name);
    const detail = await get(`/teams/harbour-city`, TeamDetailResponse);
    expect(detail.team.name).toBe(teams.find((x) => x.id === first)!.name);
    expect(detail.identities?.map((i) => [i.name, i.reason, i.fromSeason?.slug ?? null])).toEqual([
      [before["harbour-city"]!.name, "founding", null],
      [detail.team.name, "takeover", "season-2"],
    ]);
    expect(detail.history[0]).toMatchObject({
      season: { slug: "season-1" },
      champion: false,
      name: before["harbour-city"]!.name,
      withdrawn: { round: 4 },
    });
    // Facts and match pages about Season 1 use the name the club had then.
    const [r6] = await t.db<{ id: string; match_id: string | null }[]>`
      select f.id, m.id as match_id from fixtures f left join matches m on m.fixture_id = f.id
      where f.season_id = ${s1} and f.round = 3 and ${first}::uuid in (f.home_team_id, f.away_team_id)`;
    const statements = (await prematchFacts(t.db, r6!.id)).facts.map((x) => x.statement).join("\n");
    expect(statements).toContain(before["harbour-city"]!.name);
    expect(statements).not.toContain(detail.team.name);
    const res = await app().request(`/api/v1/matches/${r6!.match_id}`);
    expect(JSON.stringify(await res.json())).not.toContain(detail.team.name);
    const fin = await get(`/teams/harbour-city/finances`, ClubFinancesResponse);
    expect(fin.seasons.find((s) => s.season.slug === "season-2")?.bySource.takeover).toBeGreaterThan(0);
  });

  it("the rescued club plays the next season under its new name", async () => {
    await play(s2, 1);
    const [f] = await t.db<{ outcome: string | null; matches: number }[]>`
      select f.outcome, (select count(*)::int from matches m where m.fixture_id = f.id) as matches
      from fixtures f where f.season_id = ${s2} and f.round = 1 and ${first}::uuid in (f.home_team_id, f.away_team_id)`;
    expect(f).toEqual({ outcome: null, matches: 1 });
    expect(await t.db`select 1 from club_withdrawals where season_id = ${s2}`).toHaveLength(0);
  });

  it("the league desk reports the champions, both bankruptcies, the takeovers, the window and the money, once each", async () => {
    await seedJournalists(t.db, MODEL);
    const deps = { db: t.db, llm: offlineEditorialLlm(MODEL) };
    const subjects: NewsSubject[] = [
      { topic: "champions", seasonId: s1 },
      { topic: "withdrawal", seasonId: s1, teamId: first },
      { topic: "withdrawal", seasonId: s1, teamId: second },
      { topic: "takeover", seasonId: s2, teamId: first },
      { topic: "takeover", seasonId: s2, teamId: second },
      { topic: "transfers", seasonId: s2 },
      { topic: "finances", seasonId: s2 },
    ];
    // The sweep finds every one of them (plus league changes, which the job decides on), idempotently.
    await enqueueNews(t.db);
    await enqueueNews(t.db);
    const keys = await t.db`select idempotency_key from jobs where kind = 'article.news'`;
    expect(keys).toHaveLength(subjects.length + 2); // plus league changes and retirements
    for (const s of subjects) expect(await writeNews(deps, s)).toMatchObject({ status: "published" });
    for (const s of subjects) expect(await writeNews(deps, s)).toEqual({ status: "already-done" });
    // Same clubs and rules as last season: nothing to announce.
    expect(await writeNews(deps, { topic: "league", seasonId: s2 })).toEqual({ status: "no-story" });

    const news = await t.db<
      { slug: string; topic: string; priority: number; headline: string; body: string; role: string }[]
    >`
      select a.slug, a.topic, a.priority, a.headline, a.body, e.role from articles a
      join editorial_agents e on e.id = a.editorial_agent_id where a.kind = 'news' and a.status = 'published'`;
    expect(news).toHaveLength(subjects.length);
    expect(new Set(news.map((n) => n.role))).toEqual(new Set(["correspondent"]));
    const by = (topic: string) => news.filter((n) => n.topic === topic);
    expect(by("champions")[0]!.priority).toBe(NEWS_PRIORITY.champions);
    // Bankruptcy is reported under the name the club had that season, with the reason on record.
    const oldName = before["harbour-city"]!.name;
    const bust = by("withdrawal").find((n) => n.body.includes(`${oldName} have been declared bankrupt`))!;
    expect(bust.body).toContain("before round 4");
    expect(bust.body).toContain("Couldn't pay round 4 wages");
    expect(bust.body).toMatch(/walkovers?: each opponent is awarded 3 points/);
    const [now] = await t.db<{ name: string }[]>`select name from teams where id = ${first}`;
    const rescue = by("takeover").find((n) => n.body.includes(`as ${now!.name}`))!;
    expect(rescue.body).toContain(`${oldName} have been taken over by new owners`);
    expect(rescue.body).toMatch(/fresh capital/);
    expect(by("transfers")[0]!.body).toMatch(/transfer window has closed/);
    expect(by("finances")[0]!.body).toMatch(/a wage bill of .+ a round/);
    // Told from inside the league, never as release notes.
    for (const n of news)
      expect(`${n.headline}\n${n.body}`).not.toMatch(
        /\b(patch|update|release|feature|version|insolvency\/1|finance\/1)\b/i,
      );

    // Served to readers with topic and priority; the homepage ranking is biggest story first (fading with age).
    const list = await get("/articles?limit=50&sort=priority", ArticleListResponse);
    const rank = (a: (typeof list.items)[number]) =>
      (a.priority ?? 0) - ((Date.now() - Date.parse(a.publishedAt!)) / 3_600_000) * 8;
    const ranks = list.items.map(rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    expect(list.items.filter((a) => a.kind === "news").every((a) => a.author.role === "correspondent")).toBe(true);
    const detail = await get(`/articles/${bust.slug}`, ArticleDetailResponse);
    expect(detail.article).toMatchObject({ kind: "news", topic: "withdrawal", priority: NEWS_PRIORITY.withdrawal });
  });

  it("the club page explains the takeover, and Matchday tells the rescued club's story (#80)", async () => {
    const team = await get("/teams/harbour-city", TeamDetailResponse);
    const [tk] = team.takeovers!;
    expect(tk).toMatchObject({
      from: before["harbour-city"]!.name,
      to: team.team.name,
      withdrew: { season: { slug: "season-1" }, round: 4 },
      returned: { slug: "season-2" },
    });
    expect(tk!.capital).toBeGreaterThan(0);
    expect(tk!.basis.wages).toBeGreaterThan(tk!.basis.available!);
    expect(tk!.withdrew.reason).toContain("Couldn't pay round 4 wages");
    const [f] = await t.db<{ id: string }[]>`
      select id from fixtures where season_id = ${s2} and round = 1 and ${first}::uuid in (home_team_id, away_team_id)`;
    const story = await get(`/fixtures/${f!.id}/story`, FixtureStory);
    const line = story.prematch.lines.find((l) => l.kind === "takeover")!;
    expect(line.source).toBe("record");
    expect(line.text).toContain(`${team.team.name} are playing their first season under new owners`);
  });
});
