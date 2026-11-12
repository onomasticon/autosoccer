/** Builds manager facts strictly from persisted official records. */
import {
  type ControllerDeployment,
  describeTactics,
  type Lineup,
  TacticalConfigV1,
  type TeamMatchStats,
} from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { seasonTeamSize, standingRows } from "../league/read.ts";
import { type PlayerRow, toPlayer } from "../mappers.ts";
import { defaultLineup } from "../matches/lineup.ts";
import { latestValidRevision } from "../tactics/service.ts";
import type { ManagerFacts, MatchSummaryFact, PostMatchFacts } from "./prompts.ts";

export interface ManagerRow {
  id: string;
  team_id: string;
  slug: string;
  name: string;
  persona: string;
  philosophy: string;
  model: string;
  memory: { summary: string; notes: string[]; updatedAt: string | null };
}

export interface FixtureCtx {
  id: string;
  season_id: string;
  round: number;
  home_team_id: string;
  away_team_id: string;
}

const tacticsText = (d: ControllerDeployment | undefined) => {
  if (!d || d.kind !== "tactical" || Object.keys(d.config).length === 0) return "league baseline";
  const t = TacticalConfigV1.safeParse(d.config);
  return t.success ? describeTactics(t.data) : "unknown";
};

interface MatchJoin {
  round: number;
  home_team_id: string;
  away_team_id: string;
  home_name: string;
  away_name: string;
  home_score: number;
  away_score: number;
  stats: { home: TeamMatchStats; away: TeamMatchStats };
  request: { home: { deployment: ControllerDeployment }; away: { deployment: ControllerDeployment } };
  events: Array<{
    type: string;
    side?: string;
    scorerId?: string | null;
    ownGoal?: boolean;
    period?: string;
    clockSec?: number;
  }>;
}

export function matchFact(m: MatchJoin, teamId: string): MatchSummaryFact {
  const home = m.home_team_id === teamId;
  const us = home ? m.stats.home : m.stats.away;
  const them = home ? m.stats.away : m.stats.home;
  const gf = home ? m.home_score : m.away_score;
  const ga = home ? m.away_score : m.home_score;
  return {
    round: m.round,
    opponent: home ? m.away_name : m.home_name,
    venue: home ? "home" : "away",
    goalsFor: gf,
    goalsAgainst: ga,
    result: gf > ga ? "W" : gf === ga ? "D" : "L",
    possession: us.possession,
    shots: us.shots,
    shotsAgainst: them.shots,
    passesCompleted: us.passesCompleted,
    avgTeamHeight: us.avgTeamHeight,
    tactics: tacticsText(home ? m.request.home.deployment : m.request.away.deployment),
    opponentTactics: tacticsText(home ? m.request.away.deployment : m.request.home.deployment),
  };
}

async function completedMatches(
  db: Db,
  seasonId: string,
  teamId: string,
  upToRound: number,
  limit = 3,
): Promise<MatchJoin[]> {
  return db<MatchJoin[]>`
    select f.round, f.home_team_id, f.away_team_id, h.name as home_name, a.name as away_name,
      m.home_score, m.away_score, m.stats, m.request, m.events
    from fixtures f join matches m on m.fixture_id = f.id
    join teams h on h.id = f.home_team_id join teams a on a.id = f.away_team_id
    where f.season_id = ${seasonId} and m.status = 'completed' and f.round <= ${upToRound}
      and ${teamId}::uuid in (f.home_team_id, f.away_team_id)
    order by f.round desc limit ${limit}`;
}

export async function managerFacts(
  db: Db,
  fixture: FixtureCtx,
  teamId: string,
  manager: ManagerRow,
  opts: { includeRound: boolean },
): Promise<ManagerFacts> {
  const home = fixture.home_team_id === teamId;
  const oppId = home ? fixture.away_team_id : fixture.home_team_id;
  const [team] = await db<{ name: string }[]>`select name from teams where id = ${teamId}`;
  const [opp] = await db<{ name: string }[]>`select name from teams where id = ${oppId}`;
  const squad = (await db<PlayerRow[]>`select * from players where team_id = ${teamId} order by shirt_number`).map(
    toPlayer,
  );
  const rev = await latestValidRevision(db, teamId, fixture.season_id);
  const size = await seasonTeamSize(db, fixture.season_id);
  const lineup: Lineup = rev?.lineup ?? defaultLineup(squad, size);
  const shirt = new Map(squad.map((p) => [p.id, p.shirtNumber]));
  const parsed = rev && rev.deployment.kind === "tactical" ? TacticalConfigV1.safeParse(rev.deployment.config) : null;
  const upTo = opts.includeRound ? fixture.round : fixture.round - 1;
  const { rows } = await standingRows(db, fixture.season_id);
  return {
    manager: { name: manager.name, persona: manager.persona, philosophy: manager.philosophy, memory: manager.memory },
    team: { name: team!.name },
    format: { playersPerTeam: size },
    fixture: { round: fixture.round, venue: home ? "home" : "away", opponent: opp!.name },
    squad: squad.map((p) => ({ shirt: p.shirtNumber, name: p.name, position: p.position })),
    current: { tactics: parsed?.success ? parsed.data : null, starters: lineup.starters.map((id) => shirt.get(id)!) },
    table: rows.map((r) => ({
      position: r.position,
      team: r.team.name,
      played: r.played,
      points: r.points,
      goalDifference: r.goalDifference,
    })),
    recent: (await completedMatches(db, fixture.season_id, teamId, upTo)).map((m) => matchFact(m, teamId)),
    opponentRecent: (await completedMatches(db, fixture.season_id, oppId, upTo)).map((m) => matchFact(m, oppId)),
  };
}

export async function postMatchFacts(
  db: Db,
  fixture: FixtureCtx,
  teamId: string,
  manager: ManagerRow,
): Promise<PostMatchFacts> {
  const base = await managerFacts(db, fixture, teamId, manager, { includeRound: true });
  const [m] = await db<MatchJoin[]>`
    select f.round, f.home_team_id, f.away_team_id, h.name as home_name, a.name as away_name,
      m.home_score, m.away_score, m.stats, m.request, m.events
    from fixtures f join matches m on m.fixture_id = f.id
    join teams h on h.id = f.home_team_id join teams a on a.id = f.away_team_id
    where f.id = ${fixture.id} and m.status = 'completed'`;
  if (!m) throw new Error(`fixture ${fixture.id} has no completed match`);
  const names = new Map(
    (
      await db<
        { id: string; name: string }[]
      >`select id, name from players where team_id in (${fixture.home_team_id}, ${fixture.away_team_id})`
    ).map((p) => [p.id, p.name]),
  );
  const goals = m.events
    .filter((e) => e.type === "goal")
    .map((e) => {
      const side = e.side === "home" ? m.home_name : m.away_name;
      const who = e.scorerId ? (names.get(e.scorerId) ?? "unknown") : "unknown";
      const clock = `${e.period === "firstHalf" ? "1H" : "2H"} ${Math.floor((e.clockSec ?? 0) / 60)}:${String(Math.floor((e.clockSec ?? 0) % 60)).padStart(2, "0")}`;
      return `${clock} ${side}${e.ownGoal ? ` (own goal by ${who})` : ` — ${who}`}`;
    });
  return {
    ...base,
    recent: base.recent.filter((r) => r.round !== fixture.round),
    match: { ...matchFact(m, teamId), goals },
  };
}
