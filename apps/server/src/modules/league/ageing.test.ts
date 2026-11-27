import { PlayerCareersResponse, PlayerProfileResponse, TeamDetailResponse } from "@autosoccer/contracts";
import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { newsStory } from "../editorial/news.ts";
import { AGEING, ageDeltas, ageEffect, developmentRate, retireAndPromote, retires, startingAge } from "./ageing.ts";
import { develop, MAX_STEP } from "./careers.ts";
import { rolloverSeason } from "./rollover.ts";
import { SEED_TEAMS } from "./seed-data.ts";
import { createSeason, seedTeams } from "./service.ts";

const MODEL = "claude-opus-5-5";
const attrs = (v: number) =>
  ({
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
  }) as const;

describe("ageing/1 rules", () => {
  it("starting ages are 18–33 and hidden rates 0.6–1.4 (graduates up to 1.6), both from who the player is", () => {
    const names = SEED_TEAMS.flatMap((t) => t.players.map((p) => p.name));
    const ages = names.map(startingAge);
    expect(Math.min(...ages)).toBeGreaterThanOrEqual(18);
    expect(Math.max(...ages)).toBeLessThanOrEqual(33);
    expect(new Set(ages).size).toBeGreaterThan(8);
    for (const n of names) expect(developmentRate(n)).toBeGreaterThanOrEqual(0.6);
    for (const n of names) expect(developmentRate(n)).toBeLessThanOrEqual(1.4);
    expect(developmentRate("Ada Okafor", true)).toBeLessThanOrEqual(1.6);
    expect(startingAge("Ada Okafor")).toBe(startingAge("Ada Okafor"));
  });

  it("the young improve, the peak holds, and from 30 the physical ratings fall, faster each year", () => {
    expect(ageEffect(19, "MF").every((e) => e.base > 0)).toBe(true);
    expect(ageEffect(27, "MF")).toEqual([]);
    expect(ageEffect(31, "FW").map((e) => e.attribute)).toEqual(["pace", "acceleration"]);
    const sum = (age: number) => ageEffect(age, "FW").reduce((a, e) => a + e.base, 0);
    expect(sum(35)).toBeLessThan(sum(32));
    expect(sum(32)).toBeLessThan(sum(30));
    // The hidden rate scales it: a fast developer gains more than a slow one, on average.
    const total = (rate: number) =>
      Array.from({ length: 40 }, (_, i) => ageDeltas(19, "MF", rate, `p${i}`).reduce((a, d) => a + d.delta, 0)).reduce(
        (a, b) => a + b,
      );
    expect(total(1.4)).toBeGreaterThan(total(0.6));
  });

  it("develop/2: a season of age on top of the record, never more than two points a rating", () => {
    const young = develop(attrs(60), "MF", { teamMatches: 6, starts: 6, goals: 0 }, "y", { age: 19, rate: 1.5 });
    expect(young.attributes.passing).toBeGreaterThan(60);
    const old = develop(attrs(70), "FW", { teamMatches: 6, starts: 0, goals: 0 }, "o", { age: 35, rate: 1.5 });
    expect(old.attributes.pace).toBeLessThan(70);
    for (const c of [...young.changes, ...old.changes]) expect(Math.abs(c.delta)).toBeLessThanOrEqual(MAX_STEP);
    expect(old.changes.find((c) => c.attribute === "pace")!.reasons).toContain("ageing at 35");
  });

  it("retirement: never before 33, always at 36, likelier for weaker players in between", () => {
    expect(retires(32, 50, "a")).toBe(false);
    expect(retires(AGEING.retire.always, 90, "a")).toBe(true);
    const share = (overall: number) =>
      Array.from({ length: 200 }, (_, i) => retires(34, overall, `s${i}`)).filter(Boolean).length;
    expect(share(55)).toBeGreaterThan(share(75));
  });
});

describe("ageing through the season lifecycle", () => {
  let t: TestDatabase;
  const seasons: string[] = [];
  const app = () => createApp({ db: t.db, store: new MemoryReplayStore() });
  const get = async <T>(path: string, schema: { parse: (x: unknown) => T }) => {
    const res = await app().request(`/api/v1${path}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    // The development rate is hidden: never served, under any name.
    expect(text).not.toMatch(/development_?rate|developmentRate/i);
    return schema.parse(JSON.parse(text));
  };
  const rollover = async () => {
    const id = seasons.at(-1)!;
    await t.db`update seasons set status = 'completed', completed_at = now() where id = ${id}`;
    const slug = await rolloverSeason(t.db, { managerModel: MODEL, editorialModel: MODEL, clubs: 4 });
    seasons.push((await t.db<{ id: string }[]>`select id from seasons where slug = ${slug}`)[0]!.id);
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedTeams(t.db);
    const { seasonId } = await createSeason(t.db, {
      slug: "season-1",
      name: "Season 1",
      seed: 20261126,
      budgetPerTeamMicroUsd: 1_000_000,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      startsAt: new Date("2026-11-20T04:00:00Z"),
      roundIntervalMinutes: 240,
      playersPerTeam: 7,
    });
    seasons.push(seasonId);
    await rollover(); // season 2
    await rollover(); // season 3
  }, 120_000);
  afterAll(async () => {
    await t.drop();
  });

  it("every player has an age; retirees leave and a graduate of the same position takes their shirt", async () => {
    const [none] = await t.db<{ n: number }[]>`select count(*)::int as n from players where born_season is null`;
    expect(none!.n).toBe(0);
    const gone = await t.db<
      { id: string; team_id: string; position: string; shirt_number: number; born_season: number }[]
    >`
      select id, team_id, position, shirt_number, born_season from players where retired_season_id is not null`;
    expect(gone.length).toBeGreaterThan(0);
    for (const r of gone) {
      expect(2 - r.born_season).toBeGreaterThanOrEqual(AGEING.retire.from); // at least 33 at the season they'd have played
      const [g] = await t.db<{ born_season: number; academy: string | null }[]>`
        select born_season, academy_season_id as academy from players
        where team_id = ${r.team_id} and shirt_number = ${r.shirt_number} and retired_season_id is null`;
      expect(g?.academy).toBeTruthy();
    }
    // Squads keep their size, and only active players are registered for the new season.
    const squads = await t.db<{ n: number }[]>`
      select count(*)::int as n from players where retired_season_id is null group by team_id`;
    expect(squads.map((s) => s.n)).toEqual([16, 16, 16, 16]);
    const [reg] = await t.db<{ n: number }[]>`
      select count(*)::int as n from player_registrations r join players p on p.id = r.player_id
      where r.season_id = ${seasons[2]!} and p.retired_season_id is not null`;
    expect(reg!.n).toBe(0);
  });

  it("graduates start below the baseline, aged 17–19, with their own ratings", async () => {
    const grads = await t.db<{ born_season: number; base: Record<string, number> | null }[]>`
      select born_season, base_attributes as base from players where academy_season_id is not null`;
    expect(grads.length).toBeGreaterThan(0);
    for (const g of grads) {
      expect(g.base).toBeTruthy();
      const age = 3 - g.born_season;
      expect(age).toBeGreaterThanOrEqual(AGEING.graduateAge.min);
      expect(age).toBeLessThanOrEqual(AGEING.graduateAge.max + 1);
    }
  });

  it("season 3 ratings: the young improved, the old declined (develop/2, with the age on record)", async () => {
    const rows = await t.db<
      {
        born_season: number;
        prev: Record<string, number>;
        next: Record<string, number>;
        rule: string;
        basis: { age: number };
      }[]
    >`
      select p.born_season, a.attributes as prev, b.attributes as next, b.rule, b.basis
      from players p join player_ratings a on a.player_id = p.id and a.season_id = ${seasons[1]!}
      join player_ratings b on b.player_id = p.id and b.season_id = ${seasons[2]!}
      where p.retired_season_id is null`;
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.every((r) => r.rule === "develop/2" && r.basis.age === 3 - r.born_season)).toBe(true);
    const sum = (a: Record<string, number>) => Object.values(a).reduce((x, y) => x + y, 0);
    const young = rows.filter((r) => 3 - r.born_season <= 21);
    const old = rows.filter((r) => 3 - r.born_season >= 32);
    expect(young.length).toBeGreaterThan(0);
    expect(old.length).toBeGreaterThan(0);
    const avg = (xs: Array<(typeof rows)[number]>) => xs.reduce((a, r) => a + sum(r.next) - sum(r.prev), 0) / xs.length;
    expect(avg(young)).toBeGreaterThan(0.5);
    expect(avg(old)).toBeLessThan(-0.5);
  });

  it("runs once per season: repeating it retires nobody else and promotes nobody new", async () => {
    const before = await t.db`select id from players`;
    const again = await retireAndPromote(t.db, seasons[1]!, 3);
    expect((await t.db`select id from players`).length).toBe(before.length);
    const [n] = await t.db<
      { n: number }[]
    >`select count(*)::int as n from players where retired_season_id = ${seasons[1]!}`;
    expect(again).toHaveLength(n!.n);
  });

  it("the site shows ages and retirements, and never the development rate", async () => {
    const careers = await get("/teams/harbour-city/careers", PlayerCareersResponse);
    expect(careers.players.every((p) => typeof p.age === "number" && p.retired === null)).toBe(true);
    expect(careers.players.every((p) => p.seasons.at(-1)!.age === p.age)).toBe(true);
    await get("/teams/harbour-city", TeamDetailResponse);
    const [r] = await t.db<{ id: string }[]>`select id from players where retired_season_id is not null limit 1`;
    const profile = await get(`/players/${r!.id}`, PlayerProfileResponse);
    expect(profile.career.retired).toBeTruthy();
    expect(profile.career.age).toBeNull();
    expect(profile.next).toBeNull();
  });

  it("is news: the retirements and the graduates who replace them", async () => {
    const stories = [
      await newsStory(t.db, { topic: "retirements", seasonId: seasons[1]! }),
      await newsStory(t.db, { topic: "retirements", seasonId: seasons[2]! }),
    ].filter(Boolean);
    expect(stories.length).toBeGreaterThan(0);
    const text = stories.flatMap((s) => s!.facts.map((f) => f.statement)).join("\n");
    expect(text).toMatch(/retires at 3\d after \d+ seasons? in the league, with \d+ league goals?/);
    expect(text).toMatch(/promote .+, 1[789], a (goalkeeper|defender|midfielder|forward) from their academy/);
  });
});
