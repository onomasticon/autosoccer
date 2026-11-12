import {
  FixturesResponse,
  RecordsResponse,
  ScorersResponse,
  SeasonListResponse,
  SeasonResponse,
  StandingsResponse,
  TeamDetailResponse,
} from "@autosoccer/contracts";
import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { createWorker } from "../../jobs/worker.ts";
import { MATCH_JOB, matchJobHandler } from "../matches/service.ts";
import { SEED_TEAMS } from "./seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "./service.ts";

const HALF = 10;

async function runSeason(db: TestDatabase["db"], seed: number) {
  await seedTeams(db);
  const { seasonId } = await createSeason(db, {
    slug: "season-1",
    name: "Season 1",
    seed,
    budgetPerTeamMicroUsd: 1_000_000,
    teamSlugs: SEED_TEAMS.map((t) => t.slug),
  });
  const store = new MemoryReplayStore();
  const worker = createWorker({ db, handlers: { [MATCH_JOB]: matchJobHandler({ db, store, halfDurationSec: HALF }) } });
  const trace: number[] = [];
  for (let i = 0; i < 50; i++) {
    const a = await advanceSeason(db, seasonId);
    if (a.state === "completed") break;
    if (a.state === "playing") {
      // sequential rounds: nothing from a later round may be released yet
      const [later] =
        await db`select count(*)::int as n from fixtures where season_id = ${seasonId} and round > ${a.round} and status <> 'scheduled'`;
      expect(later!.n).toBe(0);
      trace.push(a.round);
    }
    await worker.drain();
  }
  return { seasonId, store, trace };
}

describe("league season without AI", () => {
  let t: TestDatabase;
  let seasonId: string;
  let store: MemoryReplayStore;
  let trace: number[];
  beforeAll(async () => {
    t = await createTestDatabase();
    ({ seasonId, store, trace } = await runSeason(t.db, 20261109));
  }, 120_000);
  afterAll(async () => {
    await t.drop();
  });

  it("seeds four teams with ten-player squads (idempotently)", async () => {
    await seedTeams(t.db);
    const [teams] = await t.db`select count(*)::int as n from teams`;
    const squads = await t.db<{ n: number }[]>`select count(*)::int as n from players group by team_id`;
    expect(teams!.n).toBe(4);
    expect(squads.map((s) => s.n)).toEqual([10, 10, 10, 10]);
  });

  it("creates 12 fixtures once; re-creating the season is a no-op", async () => {
    const again = await createSeason(t.db, {
      slug: "season-1",
      name: "x",
      seed: 1,
      budgetPerTeamMicroUsd: 0,
      teamSlugs: [],
    });
    expect(again).toEqual({ seasonId, created: false });
    const [n] = await t.db`select count(*)::int as n from fixtures where season_id = ${seasonId}`;
    expect(n!.n).toBe(12);
  });

  it("plays the whole season round by round with exactly one match per fixture", async () => {
    expect(trace).toEqual([1, 2, 3, 4, 5, 6]);
    const [s] = await t.db`select status, completed_at from seasons where id = ${seasonId}`;
    expect(s!.status).toBe("completed");
    const [m] =
      await t.db`select count(*)::int as n, count(distinct fixture_id)::int as d from matches where status = 'completed'`;
    expect(m).toEqual({ n: 12, d: 12 });
    const [r] = await t.db`select count(*)::int as n from replay_artifacts where verified`;
    expect(r!.n).toBe(12);
    const [j] = await t.db`select count(*)::int as n from jobs where kind = 'match.play' and status = 'succeeded'`;
    expect(j!.n).toBe(12);
    expect(store.files.size).toBe(12);
    expect(await advanceSeason(t.db, seasonId)).toEqual({ state: "completed" });
  });

  it("standings agree with the recorded results", async () => {
    const app = createApp({ db: t.db, store });
    const body = StandingsResponse.parse(await (await app.request("/api/v1/seasons/season-1/standings")).json());
    expect(body.afterRound).toBe(6);
    expect(body.rows).toHaveLength(4);
    const results = await t.db<
      { home_score: number; away_score: number }[]
    >`select home_score, away_score from matches`;
    const draws = results.filter((x) => x.home_score === x.away_score).length;
    const goals = results.reduce((s, x) => s + x.home_score + x.away_score, 0);
    expect(body.rows.reduce((s, x) => s + x.played, 0)).toBe(24);
    expect(body.rows.reduce((s, x) => s + x.points, 0)).toBe(3 * (12 - draws) + 2 * draws);
    expect(body.rows.reduce((s, x) => s + x.goalsFor, 0)).toBe(goals);
    expect(body.rows.reduce((s, x) => s + x.goalDifference, 0)).toBe(0);
    for (const row of body.rows) expect(row.won * 3 + row.drawn).toBe(row.points);
    for (let i = 1; i < body.rows.length; i++)
      expect(body.rows[i - 1]!.points).toBeGreaterThanOrEqual(body.rows[i]!.points);
  });

  it("serves season, fixtures and team pages from the read API", async () => {
    const app = createApp({ db: t.db, store });
    const season = SeasonResponse.parse(await (await app.request("/api/v1/seasons/current")).json());
    expect(season).toMatchObject({ rounds: 6, season: { slug: "season-1", status: "completed" } });
    const fx = FixturesResponse.parse(await (await app.request("/api/v1/seasons/season-1/fixtures")).json());
    expect(fx.rounds.map((r) => r.fixtures.length)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(fx.rounds.flatMap((r) => r.fixtures).every((f) => f.score && f.matchId)).toBe(true);
    const team = TeamDetailResponse.parse(await (await app.request("/api/v1/teams/harbour-city")).json());
    expect(team.players).toHaveLength(10);
    // Club history and squad goals come from the same record as the table.
    const final = StandingsResponse.parse(await (await app.request("/api/v1/seasons/season-1/standings")).json());
    const hbc = final.rows.find((r) => r.team.slug === "harbour-city")!;
    expect(team.history).toEqual([
      {
        season: { slug: "season-1", name: "Season 1" },
        position: hbc.position,
        points: hbc.points,
        played: 6,
        champion: hbc.position === 1,
      },
    ]);
    expect(team.goals).toHaveLength(10);
    expect(team.goals.reduce((n, g) => n + g.allTime, 0)).toBeLessThanOrEqual(hbc.goalsFor);
    expect(team.memoryWrittenAfter).toBeNull(); // no AI manager in this test
    expect(team.fixtures).toHaveLength(6);
    expect(team.standing?.played).toBe(6);
    const history = SeasonListResponse.parse(await (await app.request("/api/v1/seasons")).json());
    expect(history.items).toHaveLength(1);
    const s1 = history.items[0]!;
    const standings = StandingsResponse.parse(await (await app.request("/api/v1/seasons/season-1/standings")).json());
    expect(s1).toMatchObject({ roundsPlayed: 6, rounds: 6, season: { status: "completed" } });
    expect(s1.leader!.team.id).toBe(standings.rows[0]!.team.id);
    expect(s1.margin).toBe(standings.rows[0]!.points - standings.rows[1]!.points);
    const goals = standings.rows.reduce((n, r) => n + r.goalsFor, 0);
    expect(s1.goalsPerMatch).toBeCloseTo(goals / 12, 2);
    if (goals > 0) expect(s1.topScorers.length).toBeGreaterThan(0);
    const sc = ScorersResponse.parse(await (await app.request("/api/v1/seasons/season-1/scorers")).json());
    const allTime = ScorersResponse.parse(await (await app.request("/api/v1/scorers")).json());
    expect(allTime.items).toEqual(sc.items); // only one season so far
    for (const r of sc.items) expect(r.matches).toBeGreaterThan(0);
    for (let i = 1; i < sc.items.length; i++) expect(sc.items[i]!.goals).toBeLessThanOrEqual(sc.items[i - 1]!.goals);
    if (sc.items.length) expect(sc.items[0]!.goals).toBe(s1.topScorers[0]!.goals);
    // League records agree with the final table and the results.
    const rec = RecordsResponse.parse(await (await app.request("/api/v1/records")).json());
    expect(rec.mostPoints.map((r) => r.points)).toEqual(rec.mostPoints.map(() => standings.rows[0]!.points));
    expect(rec.mostPoints.map((r) => r.team.id)).toContain(standings.rows[0]!.team.id);
    expect(rec.perfectSeasons).toEqual(
      standings.rows
        .filter((r) => r.won === 6)
        .map((r) => ({ season: { slug: "season-1", name: "Season 1" }, team: r.team, won: 6 })),
    );
    const results = fx.rounds.flatMap((r) => r.fixtures).map((f) => Math.abs(f.score!.home - f.score!.away));
    if (Math.max(...results) > 0) expect(rec.biggestWin[0]!.margin).toBe(Math.max(...results));
    expect((await app.request("/api/v1/teams/nope")).status).toBe(404);
    expect((await app.request("/api/v1/seasons/nope/standings")).status).toBe(404);
  });

  it("is deterministic: the same season seed reproduces every result", async () => {
    const t2 = await createTestDatabase();
    try {
      await runSeason(t2.db, 20261109);
      const q = (db: TestDatabase["db"]) =>
        db`select h.slug as home, a.slug as away, f.round, m.home_score, m.away_score, m.final_hash
           from matches m join fixtures f on f.id = m.fixture_id join teams h on h.id = f.home_team_id join teams a on a.id = f.away_team_id
           order by f.round, h.slug`;
      expect(await q(t2.db)).toEqual(await q(t.db));
    } finally {
      await t2.drop();
    }
  }, 120_000);
});

describe("round scheduler gates", () => {
  let t: TestDatabase;
  let seasonId: string;
  beforeAll(async () => {
    t = await createTestDatabase();
    await seedTeams(t.db);
    ({ seasonId } = await createSeason(t.db, {
      slug: "gated",
      name: "Gated",
      seed: 1,
      budgetPerTeamMicroUsd: 0,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      startsAt: new Date(Date.now() + 3_600_000),
    }));
  });
  afterAll(async () => {
    await t.drop();
  });

  it("waits for the scheduled kickoff and for pre-round work", async () => {
    expect((await advanceSeason(t.db, seasonId, { respectSchedule: true })).state).toBe("waiting");
    const held = await advanceSeason(t.db, seasonId, { beforeRound: async () => false });
    expect(held.state).toBe("waiting");
    const [n] = await t.db`select count(*)::int as n from jobs`;
    expect(n!.n).toBe(0);
    let seen: string[] = [];
    const go = await advanceSeason(t.db, seasonId, {
      beforeRound: async (_r, ids) => {
        seen = ids;
        return true;
      },
    });
    expect(go).toMatchObject({ state: "playing", round: 1, enqueued: 2 });
    expect(seen).toHaveLength(2);
    // ticking again doesn't duplicate jobs
    expect(await advanceSeason(t.db, seasonId)).toMatchObject({ state: "playing", round: 1, enqueued: 0 });
  });

  it("reports a round as blocked when a match job failed permanently", async () => {
    await t.db`update jobs set status = 'failed' where id = (select id from jobs limit 1)`;
    expect((await advanceSeason(t.db, seasonId)).state).toBe("blocked");
  });
});
