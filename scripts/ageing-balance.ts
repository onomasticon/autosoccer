/**
 * Ageing balance (ageing/1): rolls the league over many seasons on a throwaway database (no
 * matches, so only age moves ratings) and prints, per season, the squads' average age and overall,
 * how many players retired, and the age spread. Checks the league neither withers nor inflates.
 *
 *   bun scripts/ageing-balance.ts [--seasons 12] [--clubs 10]
 */
import { createTestDatabase } from "@autosoccer/db/testing";
import { rolloverSeason } from "../apps/server/src/modules/league/rollover.ts";
import { SEED_TEAMS } from "../apps/server/src/modules/league/seed-data.ts";
import { createSeason, seedTeams } from "../apps/server/src/modules/league/service.ts";

const arg = (n: string, d: string) =>
  process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1]! : d;
const SEASONS = Number(arg("seasons", "12"));
const CLUBS = Number(arg("clubs", "10"));
const MODEL = "claude-opus-5-5";

const t = await createTestDatabase();
const db = t.db;
await seedTeams(db);
let { seasonId } = await createSeason(db, {
  slug: "season-1",
  name: "Season 1",
  seed: 1,
  budgetPerTeamMicroUsd: 1_000_000,
  teamSlugs: SEED_TEAMS.map((x) => x.slug),
  startsAt: new Date("2026-01-01T00:00:00Z"),
  roundIntervalMinutes: 240,
  playersPerTeam: 7,
});
const rows: Array<Record<string, string | number>> = [];
for (let n = 2; n <= SEASONS; n++) {
  await db`update seasons set status = 'completed', completed_at = now() where id = ${seasonId}`;
  const slug = await rolloverSeason(db, { managerModel: MODEL, editorialModel: MODEL, clubs: CLUBS });
  seasonId = (await db<{ id: string }[]>`select id from seasons where slug = ${slug}`)[0]!.id;
  const [s] = await db<
    { age: number; overall: number; min: number; max: number; retired: number; u21: number; o30: number }[]
  >`
    select avg(${n} - p.born_season)::float as age, avg(r.overall)::float as overall,
      min(${n} - p.born_season)::int as min, max(${n} - p.born_season)::int as max,
      (select count(*)::int from players q where q.academy_season_id = (
        select id from seasons where created_at < (select created_at from seasons where id = ${seasonId}) order by created_at desc limit 1)) as retired,
      count(*) filter (where ${n} - p.born_season <= 21)::int as u21, count(*) filter (where ${n} - p.born_season >= 30)::int as o30
    from players p join player_ratings r on r.player_id = p.id and r.season_id = ${seasonId}
    where p.retired_season_id is null`;
  rows.push({
    season: n,
    "avg age": s!.age.toFixed(1),
    "age range": `${s!.min}–${s!.max}`,
    "≤21": s!.u21,
    "≥30": s!.o30,
    "avg overall": s!.overall.toFixed(1),
    retired: s!.retired,
  });
}
console.table(rows);
await t.drop();
