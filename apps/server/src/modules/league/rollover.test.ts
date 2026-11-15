import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { SIM_VERSION } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMatchRequest } from "../matches/service.ts";
import { schedulerTick } from "../ops/scheduler.ts";
import { nextSeasonSeed, refreshUpcomingSeason, rolloverSeason, seasonNumber } from "./rollover.ts";
import { SEED_TEAMS } from "./seed-data.ts";
import { createSeason, seedTeams } from "./service.ts";

const MODELS = { managerModel: "claude-opus-5-5", editorialModel: "claude-opus-5-5" };

describe("season rollover", () => {
  let t: TestDatabase;
  let first: string;
  beforeAll(async () => {
    t = await createTestDatabase();
    await seedTeams(t.db);
    ({ seasonId: first } = await createSeason(t.db, {
      slug: "season-1",
      name: "Season 1",
      seed: 20261109,
      budgetPerTeamMicroUsd: 1_000_000,
      editorialBudgetMicroUsd: 2_000_000,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      startsAt: new Date("2026-11-11T04:00:00Z"),
      roundIntervalMinutes: 60,
      playersPerTeam: 5,
    }));
  });
  afterAll(async () => {
    await t.drop();
  });

  it("does nothing while a season is still scheduled or active", async () => {
    expect(await rolloverSeason(t.db, MODELS)).toBeNull();
    await t.db`update seasons set status = 'active' where id = ${first}`;
    expect(await rolloverSeason(t.db, MODELS)).toBeNull();
  });

  it("starts the next season after the last one completes: same clubs, budgets and spacing, 11-a-side", async () => {
    await t.db`update seasons set status = 'completed', completed_at = now() where id = ${first}`;
    const now = new Date("2026-11-12T09:30:20Z");
    expect(await rolloverSeason(t.db, { ...MODELS, now })).toBe("season-2");
    const [s] = await t.db<
      {
        id: string;
        name: string;
        seed: string;
        status: string;
        players_per_team: number;
        budget_per_team_micro_usd: string;
        editorial_budget_micro_usd: string;
        starts_at: Date;
      }[]
    >`select * from seasons where slug = 'season-2'`;
    expect(s).toMatchObject({ name: "Season 2", status: "scheduled", players_per_team: 11 });
    expect(Number(s!.seed)).toBe(nextSeasonSeed(20261109));
    expect(Number(s!.budget_per_team_micro_usd)).toBe(1_000_000);
    expect(Number(s!.editorial_budget_micro_usd)).toBe(2_000_000);
    expect(s!.starts_at.toISOString()).toBe("2026-11-12T10:31:00.000Z"); // one round gap after now, on the minute
    const fixtures = await t.db<{ round: number; scheduled_at: Date }[]>`
      select round, scheduled_at from fixtures where season_id = ${s!.id} order by round`;
    expect(fixtures).toHaveLength(12);
    expect(fixtures.at(-1)!.scheduled_at.getTime() - fixtures[0]!.scheduled_at.getTime()).toBe(5 * 3_600_000);
    // Every manager gets an 11-a-side opening setup with eleven starters, from squads grown to sixteen.
    const revs = await t.db<{ lineup: { starters: string[] }; deployment: { config: { formation: string } } }[]>`
      select lineup, deployment from tactical_revisions where season_id = ${s!.id} and status = 'valid'`;
    expect(revs).toHaveLength(4);
    for (const r of revs) {
      expect(r.lineup.starters).toHaveLength(11);
      expect(["4-4-2", "4-3-3", "3-5-2", "4-2-3-1", "5-3-2"]).toContain(r.deployment.config.formation);
    }
    const squads = await t.db<{ n: number }[]>`select count(*)::int as n from players group by team_id`;
    expect(squads.map((q) => q.n)).toEqual([16, 16, 16, 16]);
  });

  it("is idempotent, and the scheduler only rolls over when asked to", async () => {
    expect(await rolloverSeason(t.db, MODELS)).toBeNull(); // season 2 is scheduled
    const [count] = await t.db<{ n: number }[]>`select count(*)::int as n from seasons`;
    expect(count!.n).toBe(2);
    await t.db`update seasons set status = 'completed', completed_at = now()`;
    expect((await schedulerTick(t.db, { respectSchedule: true })).rolledOver).toBeNull();
    expect((await schedulerTick(t.db, { respectSchedule: true, rollover: MODELS })).rolledOver).toBe("season-3");
  });

  it("at the daily pace, the next season fits in a day: a 4-hour break, then six rounds 4 hours apart", async () => {
    await t.db`update seasons set status = 'completed', completed_at = now()`;
    const now = new Date("2026-11-13T08:00:00Z");
    const slug = await rolloverSeason(t.db, { ...MODELS, roundMinutes: 240, now });
    const kicks = await t.db<{ at: Date }[]>`
      select distinct f.scheduled_at as at from fixtures f join seasons s on s.id = f.season_id
      where s.slug = ${slug} order by 1`;
    expect(kicks.map((k) => k.at.toISOString())).toEqual([
      "2026-11-13T12:00:00.000Z",
      "2026-11-13T16:00:00.000Z",
      "2026-11-13T20:00:00.000Z",
      "2026-11-14T00:00:00.000Z",
      "2026-11-14T04:00:00.000Z",
      "2026-11-14T08:00:00.000Z",
    ]);
  });

  it("moves a season that hasn't kicked off to the current format and sim, and leaves a started one alone", async () => {
    await t.db`update seasons set status = 'completed', completed_at = now()`;
    const slug = await rolloverSeason(t.db, { ...MODELS, now: new Date("2026-11-14T08:00:00Z") });
    // As if rollover had run on the previous release: 7-a-side, pinned to the earlier sim.
    await t.db`update seasons set sim_version = '0bc52c0', players_per_team = 7 where slug = ${slug}`;
    expect(await refreshUpcomingSeason(t.db, MODELS)).toBe(slug);
    const [s] = await t.db<{ id: string; sim_version: string; players_per_team: number }[]>`
      select id, sim_version, players_per_team from seasons where slug = ${slug}`;
    expect(s).toMatchObject({ sim_version: SIM_VERSION, players_per_team: 11 });
    const revs = await t.db<{ lineup: { starters: string[] } }[]>`
      select lineup from tactical_revisions where season_id = ${s!.id} and status = 'valid'`;
    expect(revs).toHaveLength(4);
    for (const r of revs) expect(r.lineup.starters).toHaveLength(11);
    expect(await refreshUpcomingSeason(t.db, MODELS)).toBeNull(); // already current

    // New seasons play with ball control.
    const [f] = await t.db<
      { id: string }[]
    >`select id from fixtures where season_id = ${s!.id} order by round, id limit 1`;
    const req = await buildMatchRequest({ db: t.db } as never, f!.id);
    expect(req.config).toMatchObject({ playersPerTeam: 11, ballControl: true });
    expect(req.home.starters).toHaveLength(11);

    // Once anything has happened in the season, it keeps the format it started with.
    await t.db`update seasons set sim_version = '0bc52c0', players_per_team = 7 where id = ${s!.id}`;
    await t.db`update fixtures set status = 'ready' where id = ${f!.id}`;
    expect(await refreshUpcomingSeason(t.db, MODELS)).toBeNull();
    const old = await buildMatchRequest({ db: t.db } as never, f!.id).catch((e: Error) => e.message);
    expect(typeof old === "string" ? old : old.config.ballControl).not.toBe(true);
  });

  it("derives season numbers and seeds deterministically", () => {
    expect(seasonNumber("season-12")).toBe(12);
    expect(seasonNumber("summer-cup")).toBeNull();
    expect(nextSeasonSeed(1)).toBe(nextSeasonSeed(1));
    expect(nextSeasonSeed(1)).not.toBe(nextSeasonSeed(2));
  });
});
