import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LeagueDetailResponse, LeagueListResponse, SeasonListResponse, StandingsResponse } from "@autosoccer/contracts";
import { createDb, type Db, listMigrations, MIGRATIONS_DIR, migrate } from "@autosoccer/db";

import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { createWorker } from "../../jobs/worker.ts";
import { insertTeam } from "../../testing/fixtures.ts";
import { MATCH_JOB, matchJobHandler } from "../matches/service.ts";
import { schedulerTick } from "../ops/scheduler.ts";
import {
  apply,
  concludeIfFinal,
  inventory,
  leagueBySlug,
  PlanRefused,
  planArchive,
  planConclude,
  planEndSeason,
  planFor,
  verifyArchive,
} from "./leagues.ts";
import { rolloverSeason } from "./rollover.ts";
import { SEED_TEAMS } from "./seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "./service.ts";

const MODELS = { clubs: 4, ageing: false, managerModel: "offline", editorialModel: "offline" };

async function play(db: Db, seasonId: string, store: MemoryReplayStore) {
  const worker = createWorker({ db, handlers: { [MATCH_JOB]: matchJobHandler({ db, store, halfDurationSec: 10 }) } });
  for (let i = 0; i < 50; i++) {
    if ((await advanceSeason(db, seasonId)).state === "completed") return;
    await worker.drain();
  }
  throw new Error("season did not finish");
}

describe("backfill of an existing database (0016)", () => {
  let db: Db;
  let name: string;
  beforeAll(async () => {
    name = `autosoccer_test_${Math.random().toString(16).slice(2, 12)}`;
    const admin = createDb(TEST_DATABASE_URL, { max: 1 });
    await admin.unsafe(`create database ${name}`);
    await admin.end();
    const u = new URL(TEST_DATABASE_URL);
    u.pathname = `/${name}`;
    db = createDb(u.toString(), { max: 2 });
    // The schema as production had it before leagues: every migration up to 0015.
    const dir = mkdtempSync(join(tmpdir(), "autosoccer-pre-leagues-"));
    for (const m of listMigrations().filter((m) => m.version < 16))
      cpSync(join(MIGRATIONS_DIR, `${m.name}.sql`), join(dir, `${m.name}.sql`));
    await migrate(db, dir);
  });
  afterAll(async () => {
    await db.end();
    const a = createDb(TEST_DATABASE_URL, { max: 1 });
    await a.unsafe(`drop database if exists ${name} with (force)`);
    await a.end();
  });

  it("files every existing season under the original league without changing ids or slugs", async () => {
    const [s1] = await db<{ id: string }[]>`
      insert into seasons (slug, name, status, seed, sim_version, budget_per_team_micro_usd, completed_at)
      values ('season-1', 'Season 1', 'completed', 1, 'v', 0, now()) returning id`;
    const [s2] = await db<{ id: string }[]>`
      insert into seasons (slug, name, status, seed, sim_version, budget_per_team_micro_usd)
      values ('season-2', 'Season 2', 'active', 2, 'v', 0) returning id`;
    await migrate(db);
    const rows = await db<{ id: string; slug: string; status: string; league: string }[]>`
      select s.id, s.slug, s.status, l.slug as league from seasons s join leagues l on l.id = s.league_id order by s.slug`;
    expect(rows).toEqual([
      { id: s1!.id, slug: "season-1", status: "completed", league: "original" },
      { id: s2!.id, slug: "season-2", status: "active", league: "original" },
    ]);
    const [l] = await db`select status, is_default, rollover from leagues`;
    expect(l).toEqual({ status: "active", is_default: true, rollover: "legacy" });
  });

  it("still accepts seasons from code that doesn't know about leagues (rollback safety)", async () => {
    await db`insert into seasons (slug, name, status, seed, sim_version, budget_per_team_micro_usd)
      values ('season-3', 'Season 3', 'scheduled', 3, 'v', 0)`;
    const [r] = await db`select l.slug from seasons s join leagues l on l.id = s.league_id where s.slug = 'season-3'`;
    expect(r!.slug).toBe("original");
  });
});

describe("league lifecycle: conclude, archive and a second league", () => {
  let t: TestDatabase;
  let store: MemoryReplayStore;
  let s1: string;
  let original: string;
  const snapshots = new Map<string, unknown>();
  const PATHS = ["/api/v1/seasons/season-1/standings", "/api/v1/seasons/season-1/fixtures", "/api/v1/records"];

  beforeAll(async () => {
    t = await createTestDatabase();
    store = new MemoryReplayStore();
    await seedTeams(t.db);
    ({ seasonId: s1 } = await createSeason(t.db, {
      slug: "season-1",
      name: "Season 1",
      seed: 20261109,
      budgetPerTeamMicroUsd: 0,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      roundIntervalMinutes: 1,
      startsAt: new Date("2026-01-01T00:00:00Z"),
    }));
    await play(t.db, s1, store);
    original = (await leagueBySlug(t.db, "original"))!.id;
    const app = createApp({ db: t.db, store });
    for (const p of PATHS) snapshots.set(p, await (await app.request(p)).json());
    const [m] = await t.db<{ id: string }[]>`select id from matches order by id limit 1`;
    snapshots.set("match", m!.id);
    snapshots.set(`/api/v1/matches/${m!.id}`, await (await app.request(`/api/v1/matches/${m!.id}`)).json());
  }, 180_000);
  afterAll(async () => {
    await t.drop();
  });

  it("creates new seasons in the original league by default", async () => {
    const [s] = await t.db`select league_id from seasons where id = ${s1}`;
    expect(s!.league_id).toBe(original);
  });

  it("dry runs never change anything", async () => {
    const before = await t.db`select * from leagues order by slug`;
    const p = await planFor(t.db, "create", { slug: "founders", confirm: "", name: "The Founders League" });
    expect(p.ok).toBe(true);
    expect((await planConclude(t.db, "original")).ok).toBe(true); // season-1 is complete, nothing rolled over
    expect(await t.db`select * from leagues order by slug`).toEqual(before);
  });

  it("refuses to apply without the league's slug as confirmation", async () => {
    await expect(apply(t.db, "create", { slug: "founders", confirm: "yes", name: "x" })).rejects.toThrow(
      /--confirm founders/,
    );
  });

  it("a draft league's season is invisible and isn't played", async () => {
    await apply(t.db, "create", { slug: "founders", confirm: "founders", name: "The Founders League" });
    const founders = (await leagueBySlug(t.db, "founders"))!;
    for (const slug of ["ironbridge", "coldwater"]) await insertTeam(t.db, slug);
    // A founding club can't also play in the original league's unfinished season.
    const { seasonId } = await createSeason(t.db, {
      slug: "founders-season-1",
      name: "Season 1",
      seed: 7,
      budgetPerTeamMicroUsd: 0,
      teamSlugs: ["ironbridge", "coldwater"],
      leagueId: founders.id,
      financeRule: null,
      startsAt: new Date("2026-01-01T00:00:00Z"),
    });
    const tick = await schedulerTick(t.db, { respectSchedule: false });
    expect(tick.seasons.map((s) => s.slug)).not.toContain("founders-season-1");
    const [s] = await t.db`select status from seasons where id = ${seasonId}`;
    expect(s!.status).toBe("scheduled");
    const app = createApp({ db: t.db, store });
    const seasons = SeasonListResponse.parse(await (await app.request("/api/v1/seasons")).json());
    expect(seasons.items.map((x) => x.season.slug)).toEqual(["season-1"]);
    const leagues = LeagueListResponse.parse(await (await app.request("/api/v1/leagues")).json());
    expect(leagues.items.map((l) => l.slug)).toEqual(["original"]);
    expect((await app.request("/api/v1/leagues/founders")).status).toBe(404);
  });

  it("keeps a club in one league at a time", async () => {
    const founders = (await leagueBySlug(t.db, "founders"))!;
    await expect(
      createSeason(t.db, {
        slug: "founders-season-x",
        name: "x",
        seed: 1,
        budgetPerTeamMicroUsd: 0,
        teamSlugs: ["ironbridge", SEED_TEAMS[0]!.slug],
        leagueId: founders.id,
        financeRule: null,
      }),
    ).resolves.toBeTruthy(); // the original league's season is finished: that club is free
    await t.db`delete from seasons where slug = 'founders-season-x'`;
    await t.db`update seasons set status = 'active' where id = ${s1}`; // pretend season-1 is still running
    await expect(
      createSeason(t.db, {
        slug: "founders-season-y",
        name: "y",
        seed: 1,
        budgetPerTeamMicroUsd: 0,
        teamSlugs: ["coldwater", SEED_TEAMS[0]!.slug],
        leagueId: founders.id,
        financeRule: null,
      }),
    ).rejects.toThrow(/another league/);
    await t.db`update seasons set status = 'completed' where id = ${s1}`;
  });

  it("concludes at the announced final season instead of rolling over", async () => {
    // Without a final season the legacy league rolls over…
    const before = await t.db`select count(*)::int as n from seasons where league_id = ${original}`;
    await apply(t.db, "final-season", { slug: "original", confirm: "original", season: "season-1" });
    expect(await rolloverSeason(t.db, MODELS)).toBeNull();
    expect((await leagueBySlug(t.db, "original"))!.status).toBe("concluded");
    // …idempotently: another tick changes nothing.
    expect(await rolloverSeason(t.db, MODELS)).toBeNull();
    expect(await concludeIfFinal(t.db, original, s1)).toBe(true);
    expect(await t.db`select count(*)::int as n from seasons where league_id = ${original}`).toEqual(before);
    // A concluded league takes no new seasons.
    await expect(
      createSeason(t.db, {
        slug: "season-2",
        name: "Season 2",
        seed: 1,
        budgetPerTeamMicroUsd: 0,
        teamSlugs: SEED_TEAMS.map((x) => x.slug),
        leagueId: original,
      }),
    ).rejects.toThrow(/no new seasons/);
  });

  it("won't archive the default league or without a backup reference", async () => {
    const p = await planArchive(t.db, "original");
    expect(p.ok).toBe(false);
    expect(p.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual([
      "not the default league",
      "backup reference recorded",
    ]);
    await expect(
      apply(t.db, "archive", { slug: "original", confirm: "original", backupRef: "db/x.dump" }),
    ).rejects.toBeInstanceOf(PlanRefused);
  });

  it("moves the default to an activated league, then archives the original read-only", async () => {
    await apply(t.db, "activate", { slug: "founders", confirm: "founders" });
    await apply(t.db, "set-default", { slug: "founders", confirm: "founders" });
    const inv = await inventory(t.db, original);
    expect(inv).toMatchObject({ seasons: 1, fixtures: 12, completedFixtures: 12, matches: 12 });
    const p = await apply(t.db, "archive", { slug: "original", confirm: "original", backupRef: "db/2026-12-01.dump" });
    expect(p.inventory).toEqual(inv);
    expect((await leagueBySlug(t.db, "original"))!).toMatchObject({
      status: "archived",
      archive_backup_ref: "db/2026-12-01.dump",
    });
  });

  it("rejects writes to archived history at the database", async () => {
    const [team] = await t.db<{ id: string }[]>`select team_id as id from season_teams where season_id = ${s1} limit 1`;
    await expect(
      t.db`insert into club_ledger (team_id, season_id, kind, amount, key, rule, memo)
        values (${team!.id}, ${s1}, 'prize', 1, 'x', 'finance/2', 'x')`,
    ).rejects.toThrow(/archived/);
    await expect(t.db`update fixtures set status = 'scheduled' where season_id = ${s1}`).rejects.toThrow(/archived/);
    await expect(t.db`update matches set home_score = 9`).rejects.toThrow(/archived/);
    await expect(t.db`update seasons set status = 'active' where id = ${s1}`).rejects.toThrow(/archived/);
    await expect(t.db`delete from player_registrations where season_id = ${s1}`).rejects.toThrow(/archived/);
    expect((await verifyArchive(t.db, "original")).ok).toBe(true);
  });

  it("the scheduler and rollover leave the archived league alone", async () => {
    await schedulerTick(t.db, { respectSchedule: false, rollover: MODELS });
    expect((await verifyArchive(t.db, "original")).ok).toBe(true);
    const [n] = await t.db`select count(*)::int as n from seasons where league_id = ${original}`;
    expect(n!.n).toBe(1);
  });

  it("old pages, counts and links survive the change of default league", async () => {
    const app = createApp({ db: t.db, store });
    for (const p of PATHS.filter((x) => !x.endsWith("/records")))
      expect(await (await app.request(p)).json()).toEqual(snapshots.get(p));
    const m = snapshots.get("match") as string;
    expect(await (await app.request(`/api/v1/matches/${m}`)).json()).toEqual(snapshots.get(`/api/v1/matches/${m}`));
    expect((await app.request(`/api/v1/matches/${m}/replay`)).status).toBe(200);
    const standings = StandingsResponse.parse(snapshots.get(PATHS[0]!));
    expect(standings.rows).toHaveLength(4);
    // The roll of honour now shows the new league; the original is one link away, intact.
    const seasons = SeasonListResponse.parse(await (await app.request("/api/v1/seasons")).json());
    expect(seasons.items.map((x) => x.season.slug)).toEqual(["founders-season-1"]);
    const detail = LeagueDetailResponse.parse(await (await app.request("/api/v1/leagues/original")).json());
    expect(detail.league).toMatchObject({ status: "archived", isDefault: false, seasons: 1 });
    expect(detail.seasons.map((x) => x.season.slug)).toEqual(["season-1"]);
    expect(detail.seasons[0]!.leader!.team.id).toBe(standings.rows[0]!.team.id);
  });

  it("an archive can be rolled back", async () => {
    await apply(t.db, "unarchive", { slug: "original", confirm: "original" });
    expect((await leagueBySlug(t.db, "original"))!.status).toBe("concluded");
    // Writable again: an operator could now correct or re-archive it.
    const [team] = await t.db<{ id: string }[]>`select team_id as id from season_teams where season_id = ${s1} limit 1`;
    await t.db`insert into club_ledger (team_id, season_id, kind, amount, key, rule, memo)
      values (${team!.id}, ${s1}, 'prize', 1, 'test:unarchived', 'finance/2', 'x')`;
    expect((await verifyArchive(t.db, "original")).ok).toBe(false);
  });
});

describe("ending a season early (the original league stops for the new one)", () => {
  let t: TestDatabase;
  let store: MemoryReplayStore;
  let s1: string;
  let worker: ReturnType<typeof createWorker>;

  beforeAll(async () => {
    t = await createTestDatabase();
    store = new MemoryReplayStore();
    worker = createWorker({
      db: t.db,
      handlers: { [MATCH_JOB]: matchJobHandler({ db: t.db, store, halfDurationSec: 10 }) },
    });
    await seedTeams(t.db);
    ({ seasonId: s1 } = await createSeason(t.db, {
      slug: "season-1",
      name: "Season 1",
      seed: 20261128,
      budgetPerTeamMicroUsd: 0,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      roundIntervalMinutes: 60,
      startsAt: new Date("2026-01-01T00:00:00Z"),
    }));
    // Round 1 is played; round 2 is released to the match queue but not played yet.
    await advanceSeason(t.db, s1);
    await worker.drain();
    await advanceSeason(t.db, s1);
  }, 180_000);
  afterAll(async () => {
    await t.drop();
  });

  it("won't stop a season while one of its matches is being played", async () => {
    const p = await planEndSeason(t.db, "original", "season-1");
    expect(p.ok).toBe(false);
    expect(p.checks.find((c) => c.name === "no match being played")?.ok).toBe(false);
    // Let round 2's matches finish; round 3 stays unreleased.
    await worker.drain();
  }, 60_000);

  it("plans it: how far the season got, what goes, and the league concluding", async () => {
    const p = await planEndSeason(t.db, "original", "season-1");
    expect(p.ok).toBe(true);
    expect(p.changes[0]).toMatch(/^season-1 ends early after round 2 of 6: its 4 played matches stay on record/);
    expect(p.changes[1]).toMatch(/remove its 8 unplayed fixtures/);
    expect((await planEndSeason(t.db, "original", "season-9")).ok).toBe(false);
  });

  it("keeps the played matches, removes the rest, and concludes the league with no champion", async () => {
    const [f] = await t.db<{ id: string }[]>`
      select id from fixtures where season_id = ${s1} and round = 3 order by id limit 1`;
    await t.db`insert into jobs (kind, idempotency_key, payload) values ('agent.pre_match', 'test:round3', ${t.db.json({ fixtureId: f!.id })})`;
    const matches = await t.db`select id, home_score, away_score from matches order by id`;

    await apply(t.db, "end-season", { slug: "original", confirm: "original", season: "season-1" });

    const [s] =
      await t.db`select status, ended_after_round, planned_rounds, completed_at is not null as done from seasons where id = ${s1}`;
    expect(s).toEqual({ status: "ended_early", ended_after_round: 2, planned_rounds: 6, done: true });
    const left = await t.db<{ round: number; status: string }[]>`
      select distinct round, status from fixtures where season_id = ${s1} order by round`;
    expect(left).toEqual([
      { round: 1, status: "completed" },
      { round: 2, status: "completed" },
    ]);
    expect(await t.db`select id, home_score, away_score from matches order by id`).toEqual(matches);
    const [job] = await t.db`select status, last_error from jobs where idempotency_key = 'test:round3'`;
    expect(job).toEqual({ status: "failed", last_error: "season ended early" });
    const l = (await leagueBySlug(t.db, "original"))!;
    expect(l.status).toBe("concluded");
    expect(l.final_season_id).toBe(s1);
  });

  it("is never played, rolled over or counted as a completed season afterwards", async () => {
    expect(await rolloverSeason(t.db, MODELS)).toBeNull();
    await schedulerTick(t.db, { respectSchedule: false, rollover: MODELS });
    expect(await t.db`select count(*)::int as n from seasons`).toEqual([{ n: 1 }]);
    expect(await t.db`select count(*)::int as n from fixtures where season_id = ${s1}`).toEqual([{ n: 4 }]);
    // Doing it twice is refused, not repeated.
    await expect(
      apply(t.db, "end-season", { slug: "original", confirm: "original", season: "season-1" }),
    ).rejects.toThrow(PlanRefused);
  });

  it("shows on the API as ended early, and sets no records", async () => {
    const app = createApp({ db: t.db, store });
    const st = StandingsResponse.parse(await (await app.request("/api/v1/seasons/season-1/standings")).json());
    expect(st.season.status).toBe("ended_early");
    expect(st.season.endedEarly).toEqual({ afterRound: 2, plannedRounds: 6 });
    expect(st.afterRound).toBe(2);
    const list = SeasonListResponse.parse(await (await app.request("/api/v1/seasons")).json());
    expect(list.items[0]!.season.status).toBe("ended_early");
    const records = await (await app.request("/api/v1/records")).json();
    expect(records).toEqual({ mostPoints: [], perfectSeasons: [], mostGoalsInSeason: [], biggestWin: [] });
  });
});
