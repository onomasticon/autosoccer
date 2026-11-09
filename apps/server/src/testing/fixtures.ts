/** Minimal persisted league data for server tests. */
import type { Db } from "@autosoccer/db";
import { SIM_VERSION } from "@autosoccer/sim-adapter";

const POSITIONS = ["GK", "DF", "DF", "MF", "FW", "MF", "FW"] as const;

export async function insertTeam(db: Db, slug: string, name = slug) {
  const [t] = await db<{ id: string }[]>`
    insert into teams (slug, name, short_name, city, primary_color, secondary_color, crest)
    values (${slug}, ${name}, ${slug.slice(0, 3).toUpperCase()}, ${name}, '#245EFF', '#FFFFFF', ${db.json({ shape: "shield", glyph: name[0]! })})
    returning id`;
  for (const [i, pos] of POSITIONS.entries()) {
    await db`insert into players (team_id, name, shirt_number, position) values (${t!.id}, ${`${name} P${i + 1}`}, ${i + 1}, ${pos})`;
  }
  return t!.id;
}

export async function insertSeason(db: Db, slug = "test-season", simVersion = SIM_VERSION) {
  const [s] = await db<{ id: string }[]>`
    insert into seasons (slug, name, status, seed, sim_version, budget_per_team_micro_usd)
    values (${slug}, ${slug}, 'active', 7, ${simVersion}, 1000000) returning id`;
  return s!.id;
}

export async function insertFixture(db: Db, seasonId: string, home: string, away: string, round = 1, seed = 42) {
  const [f] = await db<{ id: string }[]>`
    insert into fixtures (season_id, round, home_team_id, away_team_id, seed, status)
    values (${seasonId}, ${round}, ${home}, ${away}, ${seed}, 'ready') returning id`;
  return f!.id;
}
