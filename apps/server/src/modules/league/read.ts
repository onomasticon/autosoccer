/** Read-model queries shared by the league API routes (and later the editorial facts). */
import type { FixtureView, Season, StandingRow, Team, TeamSize } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { type FixtureRow, type TeamRow, toFixtureView, toTeam } from "../mappers.ts";
import { seasonStandings } from "./service.ts";

export interface SeasonRow {
  id: string;
  slug: string;
  name: string;
  status: Season["status"];
  seed: number;
  sim_version: string;
  players_per_team: number;
  budget_per_team_micro_usd: number;
  starts_at: Date | null;
  completed_at: Date | null;
}
export const toSeason = (r: SeasonRow): Season => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  status: r.status,
  seed: r.seed,
  simVersion: r.sim_version,
  playersPerTeam: r.players_per_team === 7 ? 7 : 5,
  budgetPerTeamMicroUsd: r.budget_per_team_micro_usd,
  startsAt: r.starts_at?.toISOString() ?? null,
  completedAt: r.completed_at?.toISOString() ?? null,
});

/** Players per side in a season (5 for every season before 7-a-side). */
export async function seasonTeamSize(db: Db, seasonId: string): Promise<TeamSize> {
  const [s] = await db<{ players_per_team: number }[]>`select players_per_team from seasons where id = ${seasonId}`;
  return s?.players_per_team === 7 ? 7 : 5;
}

/** The season the site shows: the active one, else the most recently started/created. */
export async function currentSeason(db: Db): Promise<SeasonRow | null> {
  const [row] = await db<SeasonRow[]>`
    select * from seasons where status <> 'draft'
    order by (status = 'active') desc, starts_at desc nulls last, created_at desc limit 1`;
  return row ?? null;
}

export async function seasonBySlug(db: Db, slug: string): Promise<SeasonRow | null> {
  const [row] = await db<SeasonRow[]>`select * from seasons where slug = ${slug}`;
  return row ?? null;
}

export async function seasonTeams(db: Db, seasonId: string): Promise<Map<string, Team>> {
  const rows = await db<TeamRow[]>`
    select t.* from season_teams st join teams t on t.id = st.team_id where st.season_id = ${seasonId} order by t.name`;
  return new Map(rows.map((t) => [t.id, toTeam(t)]));
}

export async function fixtureViews(db: Db, seasonId: string, teamId?: string): Promise<FixtureView[]> {
  const teams = await seasonTeams(db, seasonId);
  const rows = await db<FixtureRow[]>`
    select f.*, m.id as match_id, m.home_score, m.away_score
    from fixtures f left join matches m on m.fixture_id = f.id
    where f.season_id = ${seasonId}
      and (${teamId ?? null}::uuid is null or ${teamId ?? null}::uuid in (f.home_team_id, f.away_team_id))
    order by f.round, f.scheduled_at, f.id`;
  return rows.map((r) => toFixtureView(r, teams));
}

export async function standingRows(
  db: Db,
  seasonId: string,
  opts: { throughRound?: number } = {},
): Promise<{ rows: StandingRow[]; afterRound: number }> {
  const teams = await seasonTeams(db, seasonId);
  const { rows, afterRound } = await seasonStandings(db, seasonId, opts);
  return {
    afterRound,
    rows: rows.map(({ team, ...r }) => ({ ...r, team: teams.get(team)! })),
  };
}
