/** Read-model queries shared by the league API routes (and later the editorial facts). */
import type {
  FixtureView,
  ScorerRow,
  Season,
  SeasonSummary,
  StandingRow,
  Team,
  TeamSize,
  TitleRace,
} from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { type FixtureRow, type TeamRow, toFixtureView, toTeam } from "../mappers.ts";
import { titleRace } from "./race.ts";
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

/** Top scorers for a season, or across all seasons (seasonId null). Own goals don't count. */
export async function scorers(db: Db, seasonId: string | null, limit = 10): Promise<ScorerRow[]> {
  const rows = await db<{ player_id: string; name: string; team_id: string; goals: number; matches: number }[]>`
    with done as (
      select m.* from matches m join fixtures f on f.id = m.fixture_id
      where m.status = 'completed' and (${seasonId}::uuid is null or f.season_id = ${seasonId}::uuid)
    ), goals as (
      select (g->>'scorerId')::uuid as player_id, count(*)::int as goals
      from done cross join lateral jsonb_array_elements(done.events) g
      where g->>'type' = 'goal' and coalesce((g->>'ownGoal')::boolean, false) = false and g->>'scorerId' is not null
      group by 1
    ), apps as (
      select (s->>'playerId')::uuid as player_id, count(*)::int as matches
      from done cross join lateral jsonb_array_elements((done.request->'home'->'starters') || (done.request->'away'->'starters')) s
      group by 1
    )
    select g.player_id, p.name, p.team_id, g.goals, coalesce(a.matches, 0)::int as matches
    from goals g join players p on p.id = g.player_id left join apps a on a.player_id = g.player_id
    order by g.goals desc, a.matches asc nulls last, p.name limit ${limit}`;
  const teams = new Map((await db<TeamRow[]>`select * from teams`).map((t) => [t.id, toTeam(t)]));
  let rank = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.goals !== rows[i - 1]!.goals) rank = i + 1;
    return {
      rank,
      playerId: r.player_id,
      name: r.name,
      team: teams.get(r.team_id)!,
      goals: r.goals,
      matches: r.matches,
    };
  });
}

/** The roll of honour: every non-draft season, newest first, from the official record. */
export async function seasonSummaries(db: Db): Promise<SeasonSummary[]> {
  const seasons = await db<SeasonRow[]>`
    select * from seasons where status <> 'draft' order by starts_at desc nulls last, created_at desc`;
  const out: SeasonSummary[] = [];
  for (const s of seasons) {
    const { rows, afterRound } = await standingRows(db, s.id);
    const [r] = await db<
      { n: number }[]
    >`select coalesce(max(round), 0)::int as n from fixtures where season_id = ${s.id}`;
    const goals = await db<{ scorer_id: string; team_id: string; name: string; goals: number }[]>`
      select g->>'scorerId' as scorer_id, p.team_id, p.name, count(*)::int as goals
      from matches m join fixtures f on f.id = m.fixture_id
        cross join lateral jsonb_array_elements(m.events) g
        join players p on p.id = (g->>'scorerId')::uuid
      where f.season_id = ${s.id} and m.status = 'completed' and g->>'type' = 'goal'
        and coalesce((g->>'ownGoal')::boolean, false) = false and g->>'scorerId' is not null
      group by 1, 2, 3 order by goals desc, p.name`;
    const [tot] = await db<{ matches: number; goals: number }[]>`
      select count(*)::int as matches, coalesce(sum(m.home_score + m.away_score), 0)::int as goals
      from matches m join fixtures f on f.id = m.fixture_id where f.season_id = ${s.id} and m.status = 'completed'`;
    const teams = await seasonTeams(db, s.id);
    const best = goals[0]?.goals ?? 0;
    const played = rows.some((x) => x.played > 0);
    out.push({
      season: toSeason(s),
      roundsPlayed: afterRound,
      rounds: r!.n,
      leader: played ? (rows[0] ?? null) : null,
      runnerUp: played ? (rows[1] ?? null) : null,
      margin: played && rows[1] ? rows[0]!.points - rows[1].points : null,
      topScorers: goals
        .filter((g) => g.goals === best && teams.has(g.team_id))
        .map((g) => ({ playerId: g.scorer_id, name: g.name, team: teams.get(g.team_id)!, goals: g.goals })),
      goalsPerMatch: tot!.matches ? Math.round((tot!.goals / tot!.matches) * 100) / 100 : 0,
      decidedAfterRound: played ? await decidedAfterRound(db, s.id, afterRound) : null,
    });
  }
  return out;
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

/** The title race after `afterRound`: remaining fixtures are the ones in later rounds. */
export async function seasonRace(
  db: Db,
  seasonId: string,
  rows: StandingRow[],
  afterRound: number,
): Promise<TitleRace> {
  const left = await db<{ team_id: string; n: number }[]>`
    select t.team_id, count(*)::int as n from fixtures f
      cross join lateral (values (f.home_team_id), (f.away_team_id)) as t(team_id)
    where f.season_id = ${seasonId} and f.round > ${afterRound} group by 1`;
  const [r] = await db<
    { n: number }[]
  >`select coalesce(max(round), 0)::int as n from fixtures where season_id = ${seasonId}`;
  const race = titleRace({
    rows: rows.map((x) => ({ teamId: x.team.id, points: x.points })),
    remaining: new Map(left.map((l) => [l.team_id, l.n])),
  });
  const team = new Map(rows.map((x) => [x.team.id, x.team]));
  return {
    roundsLeft: Math.max(0, r!.n - afterRound),
    contenders: race.contenders.map((id) => team.get(id)!),
    clinched: race.clinched ? team.get(race.clinched)! : null,
  };
}

/** First round after which the title was settled, or null. */
export async function decidedAfterRound(db: Db, seasonId: string, upTo: number): Promise<number | null> {
  for (let round = 1; round <= upTo; round++) {
    const { rows } = await standingRows(db, seasonId, { throughRound: round });
    if ((await seasonRace(db, seasonId, rows, round)).clinched) return round;
  }
  return null;
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
