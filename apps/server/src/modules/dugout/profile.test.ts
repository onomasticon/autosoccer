import {
  type DugoutChapter,
  ManagerProfile,
  type ManagerStory,
  type TacticalConfigV1,
  type Team,
} from "@autosoccer/contracts";
import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { buildHandlers } from "../../jobs/handlers.ts";
import { createWorker } from "../../jobs/worker.ts";
import { offlineManagerLlm } from "../agents/offline.ts";
import { managerRoundHook, seedManagers } from "../agents/service.ts";
import { SEED_TEAMS } from "../league/seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "../league/service.ts";
import { buildProfile, MIN_DECISIONS, type SeasonStory } from "./profile.ts";

const team = (slug: string, i: number): Team => ({
  id: `00000000-0000-4000-8000-00000000000${i}`,
  slug,
  name: slug,
  shortName: slug.slice(0, 3).toUpperCase(),
  city: "x",
  colors: { primary: "#245EFF", secondary: "#FFFFFF" },
  crest: { shape: "shield", glyph: slug[0]!.toUpperCase() },
});
const US = team("us", 1);
const THEM = team("them", 2);
const base: TacticalConfigV1 = {
  formation: "2-3-1",
  lineHeight: "mid",
  width: "balanced",
  pressing: "mid",
  tempo: "balanced",
  passingRisk: "balanced",
  shooting: "balanced",
  dribbling: "sometimes",
  keeperDistribution: "short",
};
let seq = 0;
/** One played chapter: outcome, and whether (and how) the manager changed the setup for it. */
function chapter(
  outcome: "W" | "D" | "L",
  opts: { status?: DugoutChapter["decision"]["status"]; change?: Partial<TacticalConfigV1>; lineupIn?: number } = {},
): DugoutChapter {
  seq++;
  const status = opts.status ?? (opts.change ? "new" : "kept");
  const tactics = { ...base, ...opts.change };
  const changes = Object.entries(opts.change ?? {}).map(([field, to]) => ({
    field: field as keyof TacticalConfigV1,
    label: field,
    from: String(base[field as keyof TacticalConfigV1]),
    to: String(to),
  }));
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  return {
    fixtureId: id,
    round: seq,
    venue: "home",
    opponent: THEM,
    scheduledAt: null,
    status: "completed",
    decision: {
      status,
      revisionVersion: seq,
      tactics,
      summary: "x",
      changes,
      lineupIn: Array.from({ length: opts.lineupIn ?? 0 }, (_, k) => ({
        id: `00000000-0000-4000-9000-00000000000${k}`,
        name: `p${k}`,
        shirtNumber: k + 2,
        position: "MF",
      })),
      lineupOut: [],
      rationale: opts.change ? "We need more bite." : null,
      decidedAt: status === "new" || status === "kept" ? "2026-11-15T00:00:00.000Z" : null,
    },
    result: {
      matchId: id,
      goalsFor: outcome === "W" ? 2 : 0,
      goalsAgainst: outcome === "L" ? 2 : 0,
      outcome,
      possession: 0.5,
      shots: 3,
      shotsAgainst: 3,
    },
    reflection: { status: "reviewed", lesson: `lesson ${seq}`, summary: null, reviewedAt: null },
  };
}
const stories = (...seasons: DugoutChapter[][]): SeasonStory[] =>
  seasons.map((chapters, i) => ({
    season: { slug: `season-${i + 1}`, name: `Season ${i + 1}` },
    story: {
      team: US,
      manager: { slug: "coach", name: "Coach", philosophy: "x" },
      chapters,
      seasonComplete: true,
    } satisfies ManagerStory,
  }));

describe("manager profile rules", () => {
  it("says it's too early, with no traits, until the manager has made enough decisions", () => {
    const p = buildProfile(US, stories([chapter("L", { change: { formation: "3-2-1" } }), chapter("L")]));
    expect(ManagerProfile.parse(p).verdict).toBe("too_early");
    expect(p.counts.decisions).toBeLessThan(MIN_DECISIONS);
    expect(p.traits).toEqual([]);
  });

  it("budget skips, failed runs and the opening plan are never counted as the manager's decisions", () => {
    const p = buildProfile(
      US,
      stories([
        chapter("L", { status: "opening" }),
        chapter("L", { status: "skipped_budget" }),
        chapter("L", { status: "failed" }),
        chapter("L", { status: "skipped_budget" }),
        chapter("W"),
      ]),
    );
    expect(p.counts).toMatchObject({ matches: 5, decisions: 1, opening: 1, skippedBudget: 2, failedOrRejected: 1 });
    expect(p.verdict).toBe("too_early");
  });

  it("a tinkerer who reacts to defeat, with the matches that show it", () => {
    const s = [
      chapter("L"),
      chapter("L", { change: { formation: "3-2-1" } }),
      chapter("W", { change: { pressing: "high" } }),
      chapter("W"),
      chapter("L", { change: { tempo: "direct" } }),
      chapter("D", { change: { formation: "2-2-2", lineHeight: "high" } }),
    ];
    const p = buildProfile(US, stories(s));
    const keys = p.traits.map((t) => t.key);
    expect(keys).toContain("tinkerer");
    expect(keys).toContain("reacts_to_defeat");
    for (const t of p.traits) {
      expect(t.evidence.length).toBeGreaterThanOrEqual(2);
      // Evidence is always this manager's own recorded matches.
      for (const e of t.evidence) expect(s.map((c) => c.fixtureId)).toContain(e.fixtureId);
    }
    const reacts = p.traits.find((t) => t.key === "reacts_to_defeat")!;
    // Every cited decision came right after a defeat and changed the setup.
    for (const e of reacts.evidence) {
      const i = s.findIndex((c) => c.fixtureId === e.fixtureId);
      expect(s[i - 1]!.result!.outcome).toBe("L");
      expect(s[i]!.decision.changes.length).toBeGreaterThan(0);
    }
    // Notable decisions: formation changes first, each with what came before and the stated reason.
    // Weighted: formation changes (+3), the number of changes, and coming right after a defeat (+1).
    expect(p.notable.map((d) => d.at.round)).toEqual([s[1]!.round, s[2]!.round, s[5]!.round]);
    expect(p.notable[0]).toMatchObject({
      before: { round: s[0]!.round, outcome: "L" },
      rationale: "We need more bite.",
    });
    expect(p.current.lesson).toBe(`lesson ${s[5]!.round}`);
  });

  it("the summary follows the official history: the same results with a kept setup make a settled manager", () => {
    const p = buildProfile(US, stories([chapter("L"), chapter("L"), chapter("W"), chapter("L"), chapter("D")]));
    expect(p.traits.map((t) => t.key)).toEqual(["settled", "holds_after_defeat"]);
    expect(p.notable).toEqual([]);
  });

  it("looks across seasons, but never treats a new season's first match as a reaction to last season", () => {
    const p = buildProfile(
      US,
      stories(
        [chapter("W"), chapter("L"), chapter("L", { change: { pressing: "high" } })],
        [chapter("W", { change: { formation: "3-1-2" } }), chapter("W"), chapter("D")],
      ),
    );
    expect(p.seasons.map((s) => s.slug)).toEqual(["season-1", "season-2"]);
    expect(p.counts.afterDefeat.decisions).toBe(1); // round 3 of season 1, not the season-2 opener
    expect(p.counts.matches).toBe(6);
  });
});

describe("manager profile API over a seeded league", () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase();
    await seedTeams(t.db);
    const { seasonId } = await createSeason(t.db, {
      slug: "season-1",
      name: "Season 1",
      seed: 515,
      budgetPerTeamMicroUsd: 1_000_000,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      playersPerTeam: 7,
    });
    await seedManagers(t.db, seasonId, "claude-opus-5-5");
    const worker = createWorker({
      db: t.db,
      handlers: buildHandlers({
        db: t.db,
        store: new MemoryReplayStore(),
        llm: offlineManagerLlm("claude-opus-5-5"),
        halfDurationSec: 20,
      }),
    });
    const hook = managerRoundHook(t.db);
    for (let i = 0; i < 100; i++) {
      const a = await advanceSeason(t.db, seasonId, { beforeRound: hook });
      if (a.state === "completed") break;
      await worker.drain();
    }
  }, 300_000);
  afterAll(async () => {
    await t.drop();
  });

  it("profiles every manager from their recorded decisions, each trait backed by at least two matches", async () => {
    const app = createApp({ db: t.db, store: new MemoryReplayStore() });
    const keys = new Set<string>();
    for (const club of SEED_TEAMS) {
      const res = await app.request(`/api/v1/teams/${club.slug}/manager-profile`);
      expect(res.status).toBe(200);
      const p = ManagerProfile.parse(await res.json());
      expect(p.counts.matches, JSON.stringify(p.counts)).toBe(6);
      expect(p.verdict).toBe(p.counts.decisions >= MIN_DECISIONS ? "profiled" : "too_early");
      const fixtures = new Set(
        (
          await t.db<{ id: string }[]>`
          select f.id from fixtures f join teams x on x.id in (f.home_team_id, f.away_team_id) where x.slug = ${club.slug}`
        ).map((r) => r.id),
      );
      for (const tr of p.traits) {
        keys.add(tr.key);
        expect(tr.evidence.length).toBeGreaterThanOrEqual(2);
        for (const e of tr.evidence) expect(fixtures.has(e.fixtureId)).toBe(true);
      }
      for (const d of p.notable) {
        expect(fixtures.has(d.at.fixtureId)).toBe(true);
        // The revision cited is the one that played in that match.
        const [m] = await t.db<{ v: number }[]>`
          select r.version as v from matches m join tactical_revisions r
            on r.id = case when (select slug from teams where id = (select home_team_id from fixtures where id = m.fixture_id)) = ${club.slug}
              then m.home_revision_id else m.away_revision_id end
          where m.fixture_id = ${d.at.fixtureId}`;
        expect(m!.v).toBe(d.at.revisionVersion);
      }
    }
    expect((await app.request("/api/v1/teams/nobody/manager-profile")).status).toBe(404);
    expect((await app.request("/api/v1/teams/harbour-city/manager-profile?season=season-9")).status).toBe(404);
    const scoped = ManagerProfile.parse(
      await (await app.request("/api/v1/teams/harbour-city/manager-profile?season=season-1")).json(),
    );
    expect(scoped.seasons).toEqual([{ slug: "season-1", name: "Season 1" }]);
  });
});
