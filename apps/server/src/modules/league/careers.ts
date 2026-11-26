/**
 * Player careers (#70): season-by-season ratings snapshots, developed by a small, fixed and
 * deterministic rule from what the official record shows each player did, plus career stats.
 *
 * - A snapshot is written once per player per season, when the season is created (rollover), from
 *   the previous season's snapshot (or the deterministic baseline) and that season's record. It's
 *   idempotent: re-running never develops a player twice.
 * - Forward-only: new fixtures read their season's snapshot; a played match's frozen request keeps
 *   the ratings it was played with, and seasons from before snapshots use the baseline.
 * - Only recorded facts drive it: starts (from each match's frozen lineup) and goals (official
 *   events). No ages, injuries, moods or invented statistics.
 */

import { createHash } from "node:crypto";
import {
  ATTRIBUTE_NAMES,
  type AttributeName,
  CAREERS_CONTRACT,
  type CareerSeason,
  type Player,
  type PlayerAttributes,
  type PlayerCareersResponse,
  type Position,
  type Team,
} from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { type PlayerRow, type TeamRow, toPlayer, toTeam } from "../mappers.ts";
import { overallRating, playerAttributes } from "./attributes.ts";

export const DEVELOP_RULE = "develop/1";

/** The two ratings each position develops through regular play. */
export const KEY_ATTRIBUTES: Record<Position, [AttributeName, AttributeName]> = {
  GK: ["goalkeeping", "agility"],
  DF: ["tackling", "stamina"],
  MF: ["passing", "control"],
  FW: ["shooting", "control"],
};
/** Ratings at or above this don't grow further from playing time or goals. */
export const GROWTH_CEILING = 85;
/** Ratings at or above this drift back by a point a season (no runaway stars). */
export const REVERSION_FROM = 88;
/** No rating moves more than this in one season. */
export const MAX_STEP = 2;

export interface SeasonRecord {
  /** Matches the player's club played in the season. */
  teamMatches: number;
  starts: number;
  goals: number;
}

export interface Development {
  attributes: PlayerAttributes;
  /** Non-zero changes, with the reasons that produced them. */
  changes: Array<{ attribute: AttributeName; delta: number; reasons: string[] }>;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * develop/1: one season's development, from the previous ratings and the season's record.
 *  1. Regular starter (≥ half the club's matches): +1 to the position's two key ratings.
 *  2. Didn't start at all (while the club played): −1 stamina and −1 to the main key rating.
 *  3. Outfield scorer (≥ 2 goals and ≥ 0.4 a start): +1 shooting.
 *  4. Growth stops at GROWTH_CEILING; ratings ≥ REVERSION_FROM fall back by 1.
 *  5. One seeded ±1 on one rating (from the player and season ids: transparent, not luck-driven
 *     by club or name).
 *  Each rating moves at most MAX_STEP a season and stays within 25–95.
 */
export function develop(prev: PlayerAttributes, position: Position, rec: SeasonRecord, seed: string): Development {
  const delta = new Map<AttributeName, { d: number; reasons: string[] }>();
  const add = (a: AttributeName, d: number, why: string) => {
    const cur = delta.get(a) ?? { d: 0, reasons: [] };
    delta.set(a, { d: cur.d + d, reasons: [...cur.reasons, why] });
  };
  const [k1, k2] = KEY_ATTRIBUTES[position];
  const share = rec.teamMatches ? rec.starts / rec.teamMatches : 0;
  if (rec.teamMatches > 0 && share >= 0.5) {
    for (const a of [k1, k2])
      if (prev[a] < GROWTH_CEILING) add(a, 1, `regular starter (${rec.starts}/${rec.teamMatches})`);
  } else if (rec.teamMatches > 0 && rec.starts === 0) {
    add("stamina", -1, "no starts");
    add(k1, -1, "no starts");
  }
  if (position !== "GK" && rec.goals >= 2 && rec.goals >= 0.4 * rec.starts && prev.shooting < GROWTH_CEILING)
    add("shooting", 1, `${rec.goals} goals in ${rec.starts} starts`);
  for (const a of ATTRIBUTE_NAMES) if (prev[a] >= REVERSION_FROM) add(a, -1, "reverting from the top of the scale");
  const h = createHash("sha256").update(`career:${seed}`).digest();
  add(ATTRIBUTE_NAMES[h[0]! % ATTRIBUTE_NAMES.length]!, h[1]! % 2 ? 1 : -1, "seasonal variation");

  const attributes = { ...prev };
  const changes: Development["changes"] = [];
  for (const [a, { d, reasons }] of delta) {
    const next = clamp(prev[a] + clamp(d, -MAX_STEP, MAX_STEP), 25, 95);
    attributes[a] = next;
    if (next !== prev[a]) changes.push({ attribute: a, delta: next - prev[a], reasons });
  }
  changes.sort((x, y) => ATTRIBUTE_NAMES.indexOf(x.attribute) - ATTRIBUTE_NAMES.indexOf(y.attribute));
  return { attributes, changes };
}

/** Each player's starts and goals in a season, and their club's matches, from the official record. */
export async function seasonRecords(db: Db, seasonId: string): Promise<Map<string, SeasonRecord>> {
  const matches = await db<
    {
      home_team_id: string;
      away_team_id: string;
      request: { home: { starters: Array<{ playerId: string }> }; away: { starters: Array<{ playerId: string }> } };
      events: Array<{ type: string; scorerId?: string | null; ownGoal?: boolean }>;
    }[]
  >`
    select f.home_team_id, f.away_team_id, m.request, m.events from matches m join fixtures f on f.id = m.fixture_id
    where f.season_id = ${seasonId} and m.status = 'completed'`;
  const teamMatches = new Map<string, number>();
  for (const m of matches)
    for (const t of [m.home_team_id, m.away_team_id]) teamMatches.set(t, (teamMatches.get(t) ?? 0) + 1);
  // The club each player represented that season: their registration (transfers only happen between
  // seasons), else their current club for seasons without registrations.
  const players = await db<{ id: string; team_id: string }[]>`
    select p.id, coalesce(r.team_id, p.team_id) as team_id from players p
    left join player_registrations r on r.player_id = p.id and r.season_id = ${seasonId}
    join season_teams st on st.team_id = coalesce(r.team_id, p.team_id) and st.season_id = ${seasonId}`;
  const out = new Map<string, SeasonRecord>(
    players.map((p) => [p.id, { teamMatches: teamMatches.get(p.team_id) ?? 0, starts: 0, goals: 0 }]),
  );
  for (const m of matches) {
    for (const s of [...m.request.home.starters, ...m.request.away.starters]) {
      const r = out.get(s.playerId);
      if (r) r.starts++;
    }
    for (const e of m.events) {
      if (e.type !== "goal" || e.ownGoal || !e.scorerId) continue;
      const r = out.get(e.scorerId);
      if (r) r.goals++;
    }
  }
  return out;
}

/** The ratings snapshot for each player in a season (empty for seasons from before snapshots). */
export async function seasonRatings(db: Db, seasonId: string): Promise<Map<string, PlayerAttributes>> {
  const rows = await db<{ player_id: string; attributes: PlayerAttributes }[]>`
    select player_id, attributes from player_ratings where season_id = ${seasonId}`;
  return new Map(rows.map((r) => [r.player_id, r.attributes]));
}

/** Players as of a season: its snapshot where there is one, else the deterministic baseline. */
export function ratedPlayer(row: PlayerRow, snapshot: ReadonlyMap<string, PlayerAttributes>): Player {
  const p = toPlayer(row);
  const a = snapshot.get(row.id);
  return a ? { ...p, attributes: a, overall: overallRating(a, row.position) } : p;
}

/**
 * Writes the season's ratings snapshots: developed from `fromSeasonId` (its snapshot, or the
 * baseline) and that season's record, or the baseline when there's no previous season or the
 * player is new. Idempotent: existing snapshots are never rewritten. Returns how many were written.
 */
export async function developSeason(db: Db, toSeasonId: string, fromSeasonId: string | null): Promise<number> {
  const players = await db<(PlayerRow & { season_slug: string })[]>`
    select p.*, s.slug as season_slug from players p
    join season_teams st on st.team_id = p.team_id join seasons s on s.id = st.season_id
    where st.season_id = ${toSeasonId} order by p.team_id, p.shirt_number`;
  const prev = fromSeasonId ? await seasonRatings(db, fromSeasonId) : new Map<string, PlayerAttributes>();
  const records = fromSeasonId ? await seasonRecords(db, fromSeasonId) : new Map<string, SeasonRecord>();
  let written = 0;
  for (const p of players) {
    const base =
      prev.get(p.id) ?? playerAttributes({ name: p.name, shirtNumber: p.shirt_number, position: p.position });
    const rec = records.get(p.id);
    const dev = rec && rec.teamMatches > 0 ? develop(base, p.position, rec, `${p.id}:${p.season_slug}`) : null;
    const attributes = dev?.attributes ?? base;
    const basis = dev
      ? { from: fromSeasonId, fromSnapshot: prev.has(p.id), record: rec, changes: dev.changes }
      : { from: fromSeasonId, record: rec ?? null, changes: [] };
    const r = await db`
      insert into player_ratings (player_id, season_id, attributes, overall, rule, basis)
      values (${p.id}, ${toSeasonId}, ${db.json(attributes as never)}, ${overallRating(attributes, p.position)},
        ${dev ? DEVELOP_RULE : "baseline"}, ${db.json(basis as never)})
      on conflict (player_id, season_id) do nothing`;
    written += r.count;
  }
  return written;
}

/**
 * Every player's career for a club's current squad (player-careers/1): ratings per season
 * (snapshot, else the baseline), the rule's changes, starts and goals from the record, the club
 * represented each season, and recent form this season. A player who joined from another club keeps
 * the seasons (and goals) from there, attributed to that club.
 */
export async function teamCareers(db: Db, team: Team): Promise<PlayerCareersResponse> {
  const players = await db<PlayerRow[]>`select * from players where team_id = ${team.id} order by shirt_number`;
  const teamSeasons = await db<{ id: string; slug: string; name: string }[]>`
    select s.id, s.slug, s.name from seasons s join season_teams st on st.season_id = s.id
    where st.team_id = ${team.id} and s.status <> 'draft'
    order by coalesce(s.starts_at, s.created_at), s.created_at`;
  // Each player's seasons: wherever they were registered; without registrations, the club's seasons.
  const regs = await db<{ player_id: string; season_id: string; slug: string; name: string; team: TeamRow }[]>`
    select r.player_id, s.id as season_id, s.slug, s.name,
      to_jsonb(t.*) || jsonb_build_object('name', team_name_as_of(t.id, s.id)) as team
    from player_registrations r join seasons s on s.id = r.season_id join teams t on t.id = r.team_id
    where r.player_id = any(${players.map((p) => p.id)}) and s.status <> 'draft'
    order by coalesce(s.starts_at, s.created_at), s.created_at`;
  const seasonsOf = new Map<string, Array<{ id: string; slug: string; name: string; team: Team }>>();
  for (const r of regs)
    seasonsOf.set(r.player_id, [
      ...(seasonsOf.get(r.player_id) ?? []),
      { id: r.season_id, slug: r.slug, name: r.name, team: toTeam(r.team) },
    ]);
  const seasons = [
    ...new Map(
      [...teamSeasons, ...regs.map((r) => ({ id: r.season_id, slug: r.slug, name: r.name }))].map((s) => [s.id, s]),
    ).values(),
  ];
  const snaps = await db<
    {
      player_id: string;
      season_id: string;
      attributes: PlayerAttributes;
      overall: number;
      rule: string;
      basis: { changes?: CareerSeason["changes"] };
    }[]
  >`select r.* from player_ratings r where r.player_id = any(${players.map((p) => p.id)})`;
  const snap = new Map(snaps.map((s) => [`${s.player_id}:${s.season_id}`, s]));
  const records = new Map<string, Map<string, SeasonRecord>>();
  for (const s of seasons) records.set(s.id, await seasonRecords(db, s.id));
  const current = teamSeasons.at(-1);
  // Recent form: the club's last five matches in the current season.
  const recent = current
    ? await db<
        {
          match_id: string;
          round: number;
          side: "home" | "away";
          request: Record<"home" | "away", { starters: Array<{ playerId: string }> }>;
          events: Array<{ type: string; side?: string; scorerId?: string | null; ownGoal?: boolean }>;
        }[]
      >`
        select m.id as match_id, f.round, case when f.home_team_id = ${team.id} then 'home' else 'away' end as side, m.request, m.events
        from matches m join fixtures f on f.id = m.fixture_id
        where f.season_id = ${current.id} and m.status = 'completed' and ${team.id}::uuid in (f.home_team_id, f.away_team_id)
        order by f.round desc limit 5`
    : [];
  return {
    contract: CAREERS_CONTRACT,
    team,
    players: players.map((p) => {
      const baseline = playerAttributes({ name: p.name, shirtNumber: p.shirt_number, position: p.position });
      return {
        playerId: p.id,
        name: p.name,
        shirtNumber: p.shirt_number,
        position: p.position,
        seasons: (seasonsOf.get(p.id) ?? teamSeasons.map((s) => ({ ...s, team }))).map((s) => {
          const r = snap.get(`${p.id}:${s.id}`);
          const rec = records.get(s.id)?.get(p.id) ?? { teamMatches: 0, starts: 0, goals: 0 };
          const attributes = r?.attributes ?? baseline;
          return {
            season: { slug: s.slug, name: s.name },
            team: s.team,
            source: r ? ("snapshot" as const) : ("baseline" as const),
            rule: r?.rule ?? null,
            overall: r?.overall ?? overallRating(attributes, p.position),
            attributes,
            changes: r?.basis.changes ?? [],
            ...rec,
          };
        }),
        form: [...recent].reverse().map((m) => ({
          matchId: m.match_id,
          round: m.round,
          started: m.request[m.side].starters.some((s) => s.playerId === p.id),
          goals: m.events.filter((e) => e.type === "goal" && !e.ownGoal && e.side === m.side && e.scorerId === p.id)
            .length,
        })),
      };
    }),
  };
}
