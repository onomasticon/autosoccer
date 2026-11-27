/**
 * Read models for the homepage spotlight (spotlight/1), player profiles (player-profile/1) and the
 * player list used by search. Official record only: completed matches' events and frozen lineups.
 */
import {
  PLAYER_PROFILE_CONTRACT,
  type PlayerListItem,
  type PlayerProfileResponse,
  SPOTLIGHT_CONTRACT,
  type SpotlightNext,
  type SpotlightPlayer,
  type SpotlightResponse,
  type Team,
} from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { teamCareers } from "../league/careers.ts";
import { currentSeason, seasonSummaries, seasonTeams } from "../league/read.ts";
import { type PlayerRow, type TeamRow, toTeam } from "../mappers.ts";
import { type MatchInput, ordinal, pickLead, pickMoment, SPOTLIGHT_RULE, type SpotlightContext } from "./rule.ts";

interface MatchRowLite {
  match_id: string;
  fixture_id: string;
  round: number;
  season_slug: string;
  season_name: string;
  home_team_id: string;
  away_team_id: string;
  events: MatchInput["events"];
  replay: boolean;
}

async function allTeams(db: Db): Promise<Map<string, Team>> {
  return new Map((await db<TeamRow[]>`select * from teams`).map((t) => [t.id, toTeam(t)]));
}

const toInput = (r: MatchRowLite, teams: Map<string, Team>): MatchInput | null => {
  const home = teams.get(r.home_team_id);
  const away = teams.get(r.away_team_id);
  if (!home || !away) return null;
  return {
    matchId: r.match_id,
    fixtureId: r.fixture_id,
    round: r.round,
    season: { slug: r.season_slug, name: r.season_name },
    home,
    away,
    events: r.events ?? [],
    replay: r.replay,
  };
};

const MATCH_COLUMNS = (db: Db) => db`
  m.id as match_id, f.id as fixture_id, f.round, s.slug as season_slug, s.name as season_name,
  f.home_team_id, f.away_team_id, m.events,
  exists(select 1 from replay_artifacts ra where ra.match_id = m.id) as replay`;

/** Goals (own goals excluded) and starts per player, over all seasons or one. */
export async function playerRecords(
  db: Db,
  seasonId: string | null,
): Promise<Map<string, { goals: number; starts: number }>> {
  const rows = await db<{ player_id: string; goals: number; starts: number }[]>`
    with done as (
      select m.* from matches m join fixtures f on f.id = m.fixture_id
      where m.status = 'completed' and (${seasonId}::uuid is null or f.season_id = ${seasonId}::uuid)
    ), goals as (
      select (g->>'scorerId')::uuid as player_id, count(*)::int as n
      from done cross join lateral jsonb_array_elements(done.events) g
      where g->>'type' = 'goal' and coalesce((g->>'ownGoal')::boolean, false) = false and g->>'scorerId' is not null
      group by 1
    ), starts as (
      select (s->>'playerId')::uuid as player_id, count(*)::int as n
      from done cross join lateral jsonb_array_elements((done.request->'home'->'starters') || (done.request->'away'->'starters')) s
      group by 1
    )
    select coalesce(g.player_id, s.player_id) as player_id, coalesce(g.n, 0)::int as goals, coalesce(s.n, 0)::int as starts
    from goals g full outer join starts s on s.player_id = g.player_id`;
  return new Map(rows.map((r) => [r.player_id, { goals: r.goals, starts: r.starts }]));
}

async function playerMap(db: Db): Promise<SpotlightContext["players"]> {
  const rows = await db<PlayerRow[]>`select * from players`;
  return new Map(
    rows.map((p) => [
      p.id,
      { id: p.id, name: p.name, shirtNumber: p.shirt_number, position: p.position, teamId: p.team_id },
    ]),
  ) as ReadonlyMap<string, SpotlightPlayer & { teamId: string }>;
}

/** Each club's next unfinished fixture in a season. */
async function nextFixtures(db: Db, seasonId: string | null, teams: Map<string, Team>) {
  const out = new Map<string, SpotlightNext>();
  if (!seasonId) return out;
  const rows = await db<
    { id: string; round: number; home_team_id: string; away_team_id: string; scheduled_at: Date | null }[]
  >`
    select f.id, f.round, f.home_team_id, f.away_team_id, f.scheduled_at from fixtures f
    where f.season_id = ${seasonId} and f.status <> 'completed' order by f.round, f.scheduled_at nulls last, f.id`;
  for (const r of rows)
    for (const [me, them, venue] of [
      [r.home_team_id, r.away_team_id, "home"],
      [r.away_team_id, r.home_team_id, "away"],
    ] as const) {
      const opponent = teams.get(them);
      if (out.has(me) || !opponent) continue;
      out.set(me, {
        fixtureId: r.id,
        round: r.round,
        venue,
        opponent,
        scheduledAt: r.scheduled_at?.toISOString() ?? null,
      });
    }
  return out;
}

/**
 * The latest completed round: the highest round of the current season whose every fixture is
 * completed; before the first one, the last such round of the most recent earlier season.
 */
async function latestRound(db: Db) {
  const rows = await db<{ season_id: string; slug: string; name: string; round: number }[]>`
    select s.id as season_id, s.slug, s.name, f.round from fixtures f join seasons s on s.id = f.season_id
    where s.status <> 'draft'
    group by s.id, s.slug, s.name, s.starts_at, s.created_at, f.round
    having bool_and(f.status = 'completed')
    order by coalesce(s.starts_at, s.created_at) desc, s.created_at desc, f.round desc limit 1`;
  return rows[0] ?? null;
}

async function matchesWhere(db: Db, teams: Map<string, Team>, where: ReturnType<Db>) {
  const rows = await db<MatchRowLite[]>`
    select ${MATCH_COLUMNS(db)} from matches m join fixtures f on f.id = m.fixture_id join seasons s on s.id = f.season_id
    where m.status = 'completed' and ${where}
    order by f.round, f.id`;
  return rows.map((r) => toInput(r, teams)).filter((m): m is MatchInput => !!m);
}

export async function spotlight(db: Db): Promise<SpotlightResponse> {
  const teams = await allTeams(db);
  const current = await currentSeason(db);
  const players = await playerMap(db);
  const latest = await latestRound(db);
  const [allTime, next] = await Promise.all([playerRecords(db, null), nextFixtures(db, current?.id ?? null, teams)]);
  const season = latest ? await playerRecords(db, latest.season_id) : new Map();
  const ctx: SpotlightContext = { players, allTime, season, next };
  const lead = latest
    ? pickLead(
        {
          round: latest.round,
          season: { slug: latest.slug, name: latest.name },
          matches: await matchesWhere(db, teams, db`f.season_id = ${latest.season_id} and f.round = ${latest.round}`),
        },
        ctx,
        teams,
      )
    : null;
  // Each club's latest meaningful moment: the same rule over the club's latest completed match.
  const clubTeams = current ? [...(await seasonTeams(db, current.id)).values()] : [...teams.values()];
  const clubs = [];
  for (const t of clubTeams) {
    const [m] = await db<MatchRowLite[]>`
      select ${MATCH_COLUMNS(db)} from matches m join fixtures f on f.id = m.fixture_id join seasons s on s.id = f.season_id
      where m.status = 'completed' and ${t.id}::uuid in (f.home_team_id, f.away_team_id)
      order by coalesce(s.starts_at, s.created_at) desc, s.created_at desc, f.round desc limit 1`;
    const input = m ? toInput(m, teams) : null;
    const seasonCtx = input && input.season.slug !== latest?.slug ? { ...ctx, season: new Map() } : ctx;
    clubs.push({ teamId: t.id, moment: input ? pickMoment([input], seasonCtx, { teamId: t.id }) : null });
  }
  return { contract: SPOTLIGHT_CONTRACT, rule: SPOTLIGHT_RULE, lead, clubs };
}

export async function playerList(db: Db): Promise<PlayerListItem[]> {
  const teams = await allTeams(db);
  const records = await playerRecords(db, null);
  const rows = await db<PlayerRow[]>`select * from players order by name`;
  return rows
    .filter((p) => teams.has(p.team_id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      shirtNumber: p.shirt_number,
      position: p.position,
      team: teams.get(p.team_id)!,
      goals: records.get(p.id)?.goals ?? 0,
      starts: records.get(p.id)?.starts ?? 0,
    }));
}

const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : (xs[0] ?? ""));

export async function playerProfile(db: Db, playerId: string): Promise<PlayerProfileResponse | null> {
  const [p] = await db<PlayerRow[]>`select * from players where id = ${playerId}`;
  if (!p) return null;
  const teams = await allTeams(db);
  const team = teams.get(p.team_id);
  if (!team) return null;
  const careers = await teamCareers(db, team, p.id);
  const career = careers.players.find((c) => c.playerId === p.id);
  if (!career) return null;
  const current = await currentSeason(db);
  const players = await playerMap(db);
  const allTime = await playerRecords(db, null);
  const next = await nextFixtures(db, current?.id ?? null, teams);
  const mine = allTime.get(p.id) ?? { goals: 0, starts: 0 };
  const higher = [...allTime.values()].filter((v) => v.goals > mine.goals).length;
  const rank = mine.goals > 0 ? higher + 1 : null;
  const level = [...allTime].filter(([id, v]) => id !== p.id && v.goals === mine.goals).length;

  const distinctions: string[] = [];
  if (rank === 1)
    distinctions.push(
      level
        ? `Joint all-time top scorer in the league: ${mine.goals} goals in ${mine.starts} starts.`
        : `The league's all-time top scorer: ${mine.goals} goals in ${mine.starts} starts.`,
    );
  else if (rank && rank <= 10)
    distinctions.push(
      `${level ? "Joint " : ""}${ordinal(rank)} on the league's all-time scoring list: ${mine.goals} goals in ${mine.starts} starts.`,
    );
  // Seasons as top scorer (completed seasons, from the roll of honour).
  const summaries = await seasonSummaries(db);
  const golden = summaries
    .filter((s) => s.season.status === "completed" && s.topScorers.some((x) => x.playerId === p.id))
    .map((s) => s.season.name.replace(/^Season /, ""))
    .reverse();
  if (golden.length) distinctions.push(`Top scorer in Season${golden.length === 1 ? "" : "s"} ${list(golden)}.`);
  // Share of the club's goals in the latest completed season they scored in (when it's most of them).
  for (const s of [...career.seasons].reverse()) {
    const sum = summaries.find((x) => x.season.slug === s.season.slug);
    if (!sum || sum.season.status !== "completed" || s.goals < 3) continue;
    const then = s.team ?? team; // the club represented that season
    const [club] = await db<{ n: number }[]>`
      select count(*)::int as n from matches m join fixtures f on f.id = m.fixture_id join seasons se on se.id = f.season_id
        cross join lateral jsonb_array_elements(m.events) g
      where se.slug = ${s.season.slug} and m.status = 'completed' and g->>'type' = 'goal'
        and ((g->>'side' = 'home' and f.home_team_id = ${then.id}) or (g->>'side' = 'away' and f.away_team_id = ${then.id}))`;
    if (club && club.n > 0 && s.goals / club.n >= 0.4)
      distinctions.push(
        `Scored ${s.goals} of ${possessiveTeam(then.name)} ${club.n} league goals in ${s.season.name}.`,
      );
    break;
  }
  // Titles won with each club the player represented (the club of that season's registration).
  const clubOf = new Map(career.seasons.map((s) => [s.season.slug, s.team ?? team]));
  const titlesBy = new Map<string, { name: string; seasons: string[] }>();
  for (const s of [...summaries].reverse()) {
    const club = clubOf.get(s.season.slug);
    if (s.season.status !== "completed" || !club || s.leader?.team.id !== club.id) continue;
    const t = titlesBy.get(club.id) ?? { name: club.name, seasons: [] };
    t.seasons.push(s.season.name.replace(/^Season /, ""));
    titlesBy.set(club.id, t);
  }
  for (const t of titlesBy.values())
    distinctions.push(
      `${t.seasons.length} title${t.seasons.length === 1 ? "" : "s"} with ${t.name} (Season${t.seasons.length === 1 ? "" : "s"} ${list(t.seasons)}).`,
    );
  if (!titlesBy.size) distinctions.push(`${team.name} are still waiting for a first league title.`);

  // Recent moment: the player's latest scoring match, across seasons.
  const [m] = await db<MatchRowLite[]>`
    select ${MATCH_COLUMNS(db)} from matches m join fixtures f on f.id = m.fixture_id join seasons s on s.id = f.season_id
    where m.status = 'completed' and exists (
      select 1 from jsonb_array_elements(m.events) g where g->>'type' = 'goal' and g->>'scorerId' = ${p.id}
        and coalesce((g->>'ownGoal')::boolean, false) = false)
    order by coalesce(s.starts_at, s.created_at) desc, s.created_at desc, f.round desc limit 1`;
  const input = m ? toInput(m, teams) : null;
  let recent = null;
  if (input) {
    const [sid] = await db<{ id: string }[]>`select id from seasons where slug = ${input.season.slug}`;
    const season = sid ? await playerRecords(db, sid.id) : new Map();
    recent = pickMoment([input], { players, allTime, season, next }, { teamId: team.id, playerId: p.id });
  }
  return {
    contract: PLAYER_PROFILE_CONTRACT,
    team,
    career,
    allTime: { goals: mine.goals, starts: mine.starts, rank },
    distinctions,
    recent,
    // A retired player has no next match.
    next: p.retired_season_id ? null : (next.get(team.id) ?? null),
  };
}

const possessiveTeam = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
