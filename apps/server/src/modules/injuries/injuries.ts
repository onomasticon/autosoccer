/**
 * injury/1: players can be hurt in matches and miss the following rounds. When a club can't field
 * a full side, or has no fit goalkeeper, it calls up temporary emergency players for the match.
 *
 * - After each official result, every starter has a small seeded chance of injury (higher for
 *   players over 29). An injury rules them out of the next 1–4 rounds of that season; the break
 *   between seasons heals everyone.
 * - When a fixture's lineup is built, each injured starter is replaced by the best fit squad player
 *   (same position first; a goalkeeper only by a goalkeeper). The change is recorded.
 * - Only when the squad has no one left (or no fit keeper) is an emergency player called up: a
 *   temporary player, weaker than the squad, registered with the club for that season only and
 *   never part of its squad. One is reused for later matches while still needed.
 *
 * Deterministic and exactly once: rolls are seeded by the match and player, one roll per match
 * (injury_checks), one change row per fixture and player, and emergency players are keyed by club,
 * season and number.
 */
import { createHash } from "node:crypto";
import { ATTRIBUTE_NAMES, type PlayerAttributes, type Position, type TeamSize } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { playerAttributes } from "../league/attributes.ts";
import { SLOT_POSITIONS } from "../matches/lineup.ts";

export const INJURY_RULE = "injury/1";

export const INJURY = {
  version: INJURY_RULE,
  /** Chance a starter is hurt in a match… */
  chance: 0.02,
  /** …plus this much for each year over 29. */
  ageFrom: 30,
  perYear: 0.004,
  /** Rounds missed, with their weights. */
  durations: [
    [1, 0.55],
    [2, 0.28],
    [3, 0.12],
    [4, 0.05],
  ] as Array<[number, number]>,
  emergency: { deficit: 10, shirtFrom: 90, age: { min: 20, max: 31 } },
} as const;

const unit = (key: string, byte = 0) => createHash("sha256").update(`injury:${key}`).digest()[byte]! / 255;

/**
 * Whether a starter is hurt in a match, and for how many rounds (0: not hurt). Seeded by the
 * fixture's seed (itself derived from the season seed) and the player's name, so the same league
 * produces the same injuries in any database.
 */
export function injuryRoll(fixtureSeed: number | string, playerName: string, age: number | null): number {
  const chance = INJURY.chance + Math.max(0, (age ?? 0) - (INJURY.ageFrom - 1)) * INJURY.perYear;
  if (unit(`hurt:${fixtureSeed}:${playerName}`) >= chance) return 0;
  let x = unit(`length:${fixtureSeed}:${playerName}`, 1);
  for (const [rounds, w] of INJURY.durations) {
    if (x < w) return rounds;
    x -= w;
  }
  return INJURY.durations.at(-1)![0];
}

/**
 * Rolls injuries for every completed match of a season that hasn't been checked yet (one roll per
 * match, ever). Returns the injuries written.
 */
export async function settleInjuries(db: Db, seasonId: string): Promise<number> {
  const [s] = await db<{ injury_rule: string | null; slug: string }[]>`
    select injury_rule, slug from seasons where id = ${seasonId}`;
  if (!s?.injury_rule) return 0;
  const seasonNo = Number(/(\d+)$/.exec(s.slug)?.[1] ?? Number.NaN);
  const matches = await db<
    {
      id: string;
      round: number;
      seed: string;
      home_team_id: string;
      away_team_id: string;
      request: Record<"home" | "away", { starters: Array<{ playerId: string }> }>;
    }[]
  >`
    select m.id, f.round, f.seed::text as seed, f.home_team_id, f.away_team_id, m.request from matches m join fixtures f on f.id = m.fixture_id
    where f.season_id = ${seasonId} and m.status = 'completed'
      and not exists (select 1 from injury_checks c where c.match_id = m.id)
    order by f.round, f.id`;
  let written = 0;
  for (const m of matches) {
    await db.begin(async (tx) => {
      const [claimed] = await tx`
        insert into injury_checks (match_id, injuries) values (${m.id}, 0) on conflict do nothing returning match_id`;
      if (!claimed) return; // another worker rolled it
      let n = 0;
      for (const side of ["home", "away"] as const) {
        const teamId = side === "home" ? m.home_team_id : m.away_team_id;
        for (const { playerId } of m.request[side].starters) {
          const [p] = await tx<{ name: string; born_season: number | null; emergency: boolean }[]>`
            select name, born_season, emergency_season_id is not null as emergency from players where id = ${playerId}`;
          if (!p || p.emergency) continue;
          const age = Number.isFinite(seasonNo) && p.born_season != null ? seasonNo - p.born_season : null;
          const rounds = injuryRoll(m.seed, p.name, age);
          if (!rounds) continue;
          await tx`
            insert into player_injuries (player_id, team_id, season_id, match_id, injured_round, out_from_round, out_until_round, rule)
            values (${playerId}, ${teamId}, ${seasonId}, ${m.id}, ${m.round}, ${m.round + 1}, ${m.round + rounds}, ${s.injury_rule})
            on conflict do nothing`;
          n++;
        }
      }
      await tx`update injury_checks set injuries = ${n} where match_id = ${m.id}`;
      written += n;
    });
  }
  return written;
}

/** Players ruled out of a round, with the last round they miss. */
export async function injuredFor(
  db: Db,
  seasonId: string,
  teamId: string,
  round: number,
): Promise<Map<string, number>> {
  const rows = await db<{ player_id: string; until: number }[]>`
    select player_id, max(out_until_round)::int as until from player_injuries
    where season_id = ${seasonId} and team_id = ${teamId} and ${round} between out_from_round and out_until_round
    group by player_id`;
  return new Map(rows.map((r) => [r.player_id, r.until]));
}

export interface SquadPlayer {
  id: string;
  position: Position;
  overall: number;
  shirtNumber: number;
}

export interface Replacement {
  playerId: string;
  /** A squad player, or null when an emergency call-up of `position` is needed. */
  replacedBy: string | null;
  position: Position;
}

/**
 * Who starts in each injured starter's place: the best fit player not already starting, same
 * position first, a keeper only for a keeper; null when nobody is left (an emergency call-up).
 * Pure and deterministic (ties by shirt number).
 */
export function replacements(
  starters: string[],
  squad: SquadPlayer[],
  injured: ReadonlySet<string>,
  size: TeamSize,
): Replacement[] {
  const slots = SLOT_POSITIONS[size];
  const used = new Set(starters.filter((id) => !injured.has(id)));
  const fit = squad
    .filter((p) => !injured.has(p.id))
    .sort((a, b) => b.overall - a.overall || a.shirtNumber - b.shirtNumber);
  const out: Replacement[] = [];
  starters.forEach((id, i) => {
    if (!injured.has(id)) return;
    const position = squad.find((p) => p.id === id)?.position ?? slots[i] ?? "MF";
    const keeper = position === "GK" || slots[i] === "GK";
    const pick =
      fit.find((p) => !used.has(p.id) && p.position === position) ??
      (keeper ? undefined : fit.find((p) => !used.has(p.id) && p.position !== "GK"));
    if (pick) used.add(pick.id);
    out.push({ playerId: id, replacedBy: pick?.id ?? null, position: keeper ? "GK" : position });
  });
  return out;
}

const FIRST = ["Remi", "Sasha", "Toni", "Kit", "Jules", "Alex", "Robin", "Noa", "Eli", "Sam", "Ari", "Dani"];
const LAST = [
  "Marlow",
  "Quill",
  "Ashby",
  "Penn",
  "Calder",
  "Ferris",
  "Lowry",
  "Hart",
  "Briar",
  "Stone",
  "Vale",
  "Rook",
];

/**
 * An emergency player for a club and season: reuses one already called up this season (of the
 * position) who isn't in `exclude`, else registers a new one. Keyed by club, season and number.
 */
export async function emergencyPlayer(
  db: Db,
  teamId: string,
  seasonId: string,
  position: Position,
  exclude: ReadonlySet<string>,
): Promise<{ id: string; name: string; shirtNumber: number; created: boolean }> {
  const existing = await db<{ id: string; name: string; shirt_number: number }[]>`
    select id, name, shirt_number from players
    where team_id = ${teamId} and emergency_season_id = ${seasonId} and position = ${position} order by shirt_number`;
  const reuse = existing.find((p) => !exclude.has(p.id));
  if (reuse) return { id: reuse.id, name: reuse.name, shirtNumber: reuse.shirt_number, created: false };
  const [{ n }] = (await db<{ n: number }[]>`
    select count(*)::int as n from players where team_id = ${teamId} and emergency_season_id = ${seasonId}`) as unknown as [
    { n: number },
  ];
  const shirt = INJURY.emergency.shirtFrom + n;
  const [key] = await db<{ k: string }[]>`
    select t.slug || ':' || s.slug as k from teams t, seasons s where t.id = ${teamId} and s.id = ${seasonId}`;
  const h = createHash("sha256")
    .update(`emergency:${key?.k ?? teamId}:${n}`)
    .digest();
  let name = `${FIRST[h[0]! % FIRST.length]} ${LAST[h[1]! % LAST.length]}`;
  for (let i = 2; (await db`select 1 from players where name = ${name}`).length; i++)
    name = `${FIRST[h[i % 32]! % FIRST.length]} ${LAST[h[(i + 7) % 32]! % LAST.length]}`;
  const base = playerAttributes({ name, shirtNumber: shirt, position });
  const attributes = Object.fromEntries(
    ATTRIBUTE_NAMES.map((a) => [
      a,
      a === "goalkeeping" && position !== "GK" ? base[a] : Math.max(25, base[a] - INJURY.emergency.deficit),
    ]),
  ) as PlayerAttributes;
  const [s] = await db<{ slug: string }[]>`select slug from seasons where id = ${seasonId}`;
  const seasonNo = Number(/(\d+)$/.exec(s?.slug ?? "")?.[1] ?? Number.NaN);
  const { min, max } = INJURY.emergency.age;
  const age = min + (h[2]! % (max - min + 1));
  const [row] = await db<{ id: string }[]>`
    insert into players (team_id, name, shirt_number, position, born_season, base_attributes, emergency_season_id, retired_season_id)
    values (${teamId}, ${name}, ${shirt}, ${position}, ${Number.isFinite(seasonNo) ? seasonNo - age : null},
      ${db.json(attributes as never)}, ${seasonId}, ${seasonId})
    returning id`;
  await db`insert into player_registrations (season_id, player_id, team_id) values (${seasonId}, ${row!.id}, ${teamId})
    on conflict do nothing`;
  return { id: row!.id, name, shirtNumber: shirt, created: true };
}

/** Injuries still running in a season: anyone out for its next unplayed round or later. */
export async function currentInjuries(
  db: Db,
  seasonId: string,
  teamId?: string,
): Promise<Array<{ playerId: string; teamId: string; injuredRound: number; untilRound: number }>> {
  const rows = await db<{ player_id: string; team_id: string; injured_round: number; until: number }[]>`
    select player_id, team_id, max(injured_round)::int as injured_round, max(out_until_round)::int as until
    from player_injuries i
    where season_id = ${seasonId} and (${teamId ?? null}::uuid is null or team_id = ${teamId ?? null}::uuid)
      and out_until_round >= coalesce(
        (select min(round) from fixtures f where f.season_id = ${seasonId} and f.status <> 'completed'),
        (select max(round) + 1 from fixtures f where f.season_id = ${seasonId}))
    group by player_id, team_id`;
  return rows.map((r) => ({
    playerId: r.player_id,
    teamId: r.team_id,
    injuredRound: r.injured_round,
    untilRound: r.until,
  }));
}

/** The injured starters who missed a fixture, and who played instead. */
export async function absencesFor(db: Db, fixtureId: string) {
  const rows = await db<
    { team_id: string; player_id: string; player: string; by_id: string; by: string; emergency: boolean }[]
  >`
    select c.team_id, c.player_id, p.name as player, c.replaced_by as by_id, b.name as by, c.emergency
    from lineup_changes c join players p on p.id = c.player_id join players b on b.id = c.replaced_by
    where c.fixture_id = ${fixtureId} order by c.team_id, p.shirt_number`;
  return rows.map((r) => ({
    teamId: r.team_id,
    player: { id: r.player_id, name: r.player },
    replacedBy: { id: r.by_id, name: r.by },
    reason: "injured" as const,
    emergency: r.emergency,
  }));
}
