import { type PlayerAttributes, PlayerCareersResponse } from "@autosoccer/contracts";
import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore, requestHash } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { buildHandlers } from "../../jobs/handlers.ts";
import { createWorker } from "../../jobs/worker.ts";
import { managerFacts } from "../agents/facts.ts";
import { offlineManagerLlm } from "../agents/offline.ts";
import { managerRoundHook, seedManagers } from "../agents/service.ts";
import { buildMatchRequest } from "../matches/service.ts";
import { overallRating, playerAttributes } from "./attributes.ts";
import { DEVELOP_RULE, develop, developSeason, GROWTH_CEILING, MAX_STEP, seasonRatings } from "./careers.ts";
import { rolloverSeason } from "./rollover.ts";
import { SEED_TEAMS } from "./seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "./service.ts";

const flat = (v: number): PlayerAttributes => ({
  pace: v,
  acceleration: v,
  agility: v,
  stamina: v,
  control: v,
  passing: v,
  shooting: v,
  power: v,
  tackling: v,
  goalkeeping: v,
});
const total = (a: PlayerAttributes) => Object.values(a).reduce((s, x) => s + x, 0);
const nonVariation = (d: ReturnType<typeof develop>) =>
  d.changes.filter((c) => !(c.reasons.length === 1 && c.reasons[0] === "seasonal variation"));

describe("develop/1", () => {
  it("is deterministic and only moves ratings by small, bounded steps", () => {
    const a = develop(flat(60), "MF", { teamMatches: 6, starts: 6, goals: 3 }, "p1:season-2");
    expect(develop(flat(60), "MF", { teamMatches: 6, starts: 6, goals: 3 }, "p1:season-2")).toEqual(a);
    for (const c of a.changes) expect(Math.abs(c.delta)).toBeLessThanOrEqual(MAX_STEP);
    expect(Math.abs(total(a.attributes) - total(flat(60)))).toBeLessThanOrEqual(5);
  });

  it("a regular starter grows in the position's key ratings; a scorer's shooting too", () => {
    const d = develop(flat(60), "FW", { teamMatches: 6, starts: 5, goals: 4 }, "x");
    const grown = Object.fromEntries(nonVariation(d).map((c) => [c.attribute, c.delta]));
    expect(grown).toMatchObject({ control: 1 });
    expect(d.attributes.shooting - 60).toBeGreaterThanOrEqual(1); // key rating + scorer, capped at MAX_STEP
    expect(d.attributes.shooting - 60).toBeLessThanOrEqual(MAX_STEP + 1);
  });

  it("zero appearances: a little rust, never growth; a late debut (no previous season) develops nothing", () => {
    const d = develop(flat(60), "DF", { teamMatches: 6, starts: 0, goals: 0 }, "x");
    expect(nonVariation(d).map((c) => [c.attribute, c.delta])).toEqual(
      expect.arrayContaining([
        ["tackling", -1],
        ["stamina", -1],
      ]),
    );
    const none = develop(flat(60), "DF", { teamMatches: 0, starts: 0, goals: 0 }, "x");
    expect(nonVariation(none)).toEqual([]);
  });

  it("no runaway: ratings at the ceiling stop growing and the very best drift back", () => {
    const star = { ...flat(70), shooting: 92, control: GROWTH_CEILING };
    const d = develop(star, "FW", { teamMatches: 6, starts: 6, goals: 6 }, "x");
    expect(d.attributes.shooting).toBeLessThan(92 + 1); // reverting, and no growth at the top
    expect(d.attributes.control).toBeLessThanOrEqual(GROWTH_CEILING + 1); // only seasonal variation could add one
  });
});

describe("player careers across a rollover", () => {
  let t: TestDatabase;
  let first: string;
  let second: string;
  let frozen: Array<{ id: string; request: unknown; request_hash: string }>;
  beforeAll(async () => {
    t = await createTestDatabase();
    await seedTeams(t.db);
    ({ seasonId: first } = await createSeason(t.db, {
      slug: "season-1",
      name: "Season 1",
      seed: 70,
      budgetPerTeamMicroUsd: 1_000_000,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      playersPerTeam: 7,
    }));
    await seedManagers(t.db, first, "claude-opus-5-5");
    const worker = createWorker({
      db: t.db,
      handlers: buildHandlers({
        db: t.db,
        store: new MemoryReplayStore(),
        llm: offlineManagerLlm("claude-opus-5-5"),
        halfDurationSec: 15,
      }),
    });
    const hook = managerRoundHook(t.db);
    for (let i = 0; i < 100; i++) {
      const a = await advanceSeason(t.db, first, { beforeRound: hook });
      if (a.state === "completed") break;
      await worker.drain();
    }
    frozen = await t.db`select id, request, request_hash from matches order by id`;
    const slug = await rolloverSeason(t.db, {
      managerModel: "claude-opus-5-5",
      editorialModel: "claude-opus-5-5",
      clubs: 4,
      now: new Date("2026-12-01T00:00:00Z"),
    });
    const [row] = await t.db<{ id: string }[]>`select id from seasons where slug = ${slug}`;
    second = row!.id;
  }, 300_000);
  afterAll(async () => {
    await t.drop();
  });

  it("writes one snapshot per player for the new season, developed from the record, exactly once", async () => {
    const rows = await t.db<{ rule: string; basis: { record: { starts: number } | null } }[]>`
      select rule, basis from player_ratings where season_id = ${second}`;
    const [players] = await t.db<{ n: number }[]>`select count(*)::int as n from players`;
    const n = players!.n;
    expect(rows).toHaveLength(n);
    expect(rows.filter((r) => r.rule === DEVELOP_RULE).length).toBeGreaterThan(0);
    // Retries and repeated rollovers never develop anyone twice.
    expect(await developSeason(t.db, second, first)).toBe(0);
    const again = await rolloverSeason(t.db, { managerModel: "m", editorialModel: "m", clubs: 4 });
    expect(again).toBeNull();
    const [snaps] = await t.db<{ m: number }[]>`select count(*)::int as m from player_ratings`;
    expect(snaps!.m).toBe(n);
  });

  it("is forward-only: played matches keep their frozen requests; new fixtures and managers use the new snapshot", async () => {
    const now = await t.db<{ id: string; request: unknown; request_hash: string }[]>`
      select id, request, request_hash from matches order by id`;
    expect(now).toEqual(frozen);
    for (const m of now) expect(requestHash(m.request as never)).toBe(m.request_hash);
    const snap = await seasonRatings(t.db, second);
    const [f] = await t.db<{ id: string; home_team_id: string }[]>`
      select id, home_team_id from fixtures where season_id = ${second} order by round, id limit 1`;
    const req = await buildMatchRequest({ db: t.db } as never, f!.id);
    for (const s of req.home.starters) expect(s.attributes).toEqual(snap.get(s.playerId));
    const [ctx] = await t.db`select f.*, ${second}::uuid as season_id from fixtures f where f.id = ${f!.id}`;
    const [mgr] = await t.db`select * from manager_agents where team_id = ${f!.home_team_id}`;
    const facts = await managerFacts(t.db, ctx as never, f!.home_team_id, mgr as never, { includeRound: false });
    const [p] = await t.db<{ id: string; name: string }[]>`
      select id, name from players where team_id = ${f!.home_team_id} order by shirt_number limit 1`;
    expect(facts.squad.find((x) => x.name === p!.name)!.attributes).toEqual(snap.get(p!.id));
  });

  it("serves careers: the baseline for the season before snapshots, then the developed one, with the record", async () => {
    const app = createApp({ db: t.db, store: new MemoryReplayStore() });
    const res = await app.request("/api/v1/teams/harbour-city/careers");
    expect(res.status).toBe(200);
    const body = PlayerCareersResponse.parse(await res.json());
    const starts1 = body.players.reduce((s, p) => s + p.seasons[0]!.starts, 0);
    expect(starts1).toBe(6 * 7); // six matches, seven starters, from the frozen lineups
    for (const p of body.players) {
      expect(p.seasons.map((s) => [s.season.slug, s.source])).toEqual([
        ["season-1", "baseline"],
        ["season-2", "snapshot"],
      ]);
      const [s1, s2] = p.seasons as [(typeof p.seasons)[0], (typeof p.seasons)[0]];
      for (const c of s2.changes) expect(s2.attributes[c.attribute] - s1.attributes[c.attribute]).toBe(c.delta);
      expect(s2.overall).toBe(overallRating(s2.attributes, p.position));
    }
    expect((await app.request("/api/v1/teams/nobody/careers")).status).toBe(404);
  });

  it("keeps the clubs balanced: no club's first seven move more than a point and a half relative to the rest", async () => {
    const snap = await seasonRatings(t.db, second);
    const drift: number[] = [];
    for (const club of SEED_TEAMS) {
      const ps = await t.db<{ id: string; name: string; shirt_number: number; position: "GK" | "DF" | "MF" | "FW" }[]>`
        select p.id, p.name, p.shirt_number, p.position from players p join teams x on x.id = p.team_id
        where x.slug = ${club.slug} order by p.shirt_number limit 7`;
      const avg = (f: (p: (typeof ps)[number]) => PlayerAttributes) =>
        ps.reduce((s, p) => s + overallRating(f(p), p.position), 0) / ps.length;
      drift.push(
        avg((p) => snap.get(p.id)!) -
          avg((p) => playerAttributes({ name: p.name, shirtNumber: p.shirt_number, position: p.position })),
      );
    }
    expect(Math.max(...drift) - Math.min(...drift)).toBeLessThan(1.5);
  });
});
