/**
 * The transfer market as one club's manager sees it: every registered player with ability, last
 * season's record, wage and guide fee; each club's cash, wage bill and headroom; squad needs.
 * Everything comes from persisted records (ratings snapshots, official matches, the club ledger).
 */
import type { Position, TeamSize } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { RULES as FINANCE, wageFor } from "../finance/rules.ts";
import { ratedPlayer, type SeasonRecord, seasonRatings, seasonRecords } from "../league/careers.ts";
import { standingRows } from "../league/read.ts";
import type { PlayerRow } from "../mappers.ts";
import { SLOT_POSITIONS } from "../matches/lineup.ts";
import { guideFee, minSquad, TRANSFER, type WindowPhase } from "./rules.ts";

export interface WindowRow {
  id: string;
  season_id: string;
  rule: string;
  opens_at: Date;
  deadline: Date;
  phase: WindowPhase;
  phase_ends_at: Date;
  closed_at: Date | null;
  summary: Record<string, unknown>;
}

export interface MarketPlayer {
  id: string;
  /** Short stable reference used in prompts: club short name + shirt ("HBC-10"). */
  ref: string;
  name: string;
  teamId: string;
  shirt: number;
  position: Position;
  overall: number;
  /** Wage per round at this season's rating. */
  wage: number;
  guide: number;
  lastSeason: SeasonRecord | null;
}

export interface ClubState {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  /** Cash in the club ledger now. */
  cash: number;
  /** The new season's league distribution, paid when round 1 kicks off. */
  distributionDue: number;
  wagesPerRound: number;
  rounds: number;
  seasonWages: number;
  /** Cash + distribution due − the season's wages (before any result or prize income). */
  headroom: number;
  squad: MarketPlayer[];
  lastSeason: { name: string; position: number; points: number } | null;
}

export interface Market {
  window: WindowRow;
  seasonId: string;
  seasonName: string;
  previousSeasonId: string | null;
  size: TeamSize;
  clubs: Map<string, ClubState>;
  players: Map<string, MarketPlayer>;
}

export async function windowById(db: Db, id: string): Promise<WindowRow | null> {
  const [w] = await db<WindowRow[]>`select * from transfer_windows where id = ${id}`;
  return w ?? null;
}

/** The completed season before `seasonId` (by creation), if any. */
export async function previousSeason(db: Db, seasonId: string) {
  const [s] = await db<{ id: string; name: string; finance_rule: string | null; status: string }[]>`
    select p.id, p.name, p.finance_rule, p.status from seasons p, seasons s
    where s.id = ${seasonId} and p.created_at < s.created_at order by p.created_at desc limit 1`;
  return s ?? null;
}

export async function loadMarket(db: Db, window: WindowRow): Promise<Market> {
  const [season] = await db<{ id: string; name: string; players_per_team: number }[]>`
    select id, name, players_per_team from seasons where id = ${window.season_id}`;
  const size = season!.players_per_team as TeamSize;
  const prev = await previousSeason(db, window.season_id);
  const snapshot = await seasonRatings(db, window.season_id);
  const records = prev ? await seasonRecords(db, prev.id) : new Map<string, SeasonRecord>();
  const teams = await db<{ id: string; slug: string; name: string; short_name: string }[]>`
    select t.id, t.slug, t.name, t.short_name from season_teams st join teams t on t.id = st.team_id
    where st.season_id = ${window.season_id} order by t.slug`;
  const short = new Map(teams.map((t) => [t.id, t.short_name]));
  const rows = await db<PlayerRow[]>`
    select p.* from players p join season_teams st on st.team_id = p.team_id
    where st.season_id = ${window.season_id} order by p.team_id, p.shirt_number`;
  const players = new Map<string, MarketPlayer>();
  for (const row of rows) {
    const p = ratedPlayer(row, snapshot);
    const rec = records.get(p.id) ?? null;
    players.set(p.id, {
      id: p.id,
      ref: `${short.get(row.team_id)}-${p.shirtNumber}`,
      name: p.name,
      teamId: row.team_id,
      shirt: p.shirtNumber,
      position: p.position,
      overall: p.overall,
      wage: wageFor(p.overall),
      guide: guideFee(p.overall, rec?.goals ?? 0),
      lastSeason: rec,
    });
  }
  const [r] = await db<{ n: number }[]>`
    select count(distinct round)::int as n from fixtures where season_id = ${window.season_id}`;
  const rounds = r?.n ?? 0;
  const cash = new Map(
    (
      await db<{ team_id: string; b: string }[]>`
        select team_id, sum(amount)::text as b from club_ledger group by team_id`
    ).map((x) => [x.team_id, Number(x.b)]),
  );
  const [paid] =
    await db`select 1 from club_ledger where season_id = ${window.season_id} and kind = 'distribution' limit 1`;
  const table = prev?.status === "completed" ? (await standingRows(db, prev.id)).rows : [];
  const clubs = new Map<string, ClubState>();
  for (const t of teams) {
    const squad = [...players.values()].filter((p) => p.teamId === t.id);
    const wagesPerRound = squad.reduce((s, p) => s + p.wage, 0);
    const distributionDue = paid ? 0 : FINANCE.distribution;
    const c = cash.get(t.id) ?? 0;
    const row = table.find((x) => x.team.id === t.id);
    clubs.set(t.id, {
      id: t.id,
      slug: t.slug,
      name: t.name,
      shortName: t.short_name,
      cash: c,
      distributionDue,
      wagesPerRound,
      rounds,
      seasonWages: wagesPerRound * rounds,
      headroom: c + distributionDue - wagesPerRound * rounds,
      squad,
      lastSeason: row && prev ? { name: prev.name, position: row.position, points: row.points } : null,
    });
  }
  return {
    window,
    seasonId: window.season_id,
    seasonName: season!.name,
    previousSeasonId: prev?.id ?? null,
    size,
    clubs,
    players,
  };
}

/** The best player for each starting place (by overall, position-matched), in slot order. */
export function strongestSide(
  squad: MarketPlayer[],
  size: TeamSize,
): Array<{ position: Position; player: MarketPlayer | null }> {
  const used = new Set<string>();
  return SLOT_POSITIONS[size].map((position) => {
    const pick = squad
      .filter((p) => p.position === position && !used.has(p.id))
      .sort((a, b) => b.overall - a.overall || a.shirt - b.shirt)[0];
    if (pick) used.add(pick.id);
    return { position, player: pick ?? null };
  });
}

/** Can this squad lose `out` (and gain `in`) and still be registered? Returns the reason if not. */
export function squadProblem(
  squad: Array<{ id: string; position: Position }>,
  size: TeamSize,
  change: { out?: Array<{ id: string; position: Position }>; in?: number },
): string | null {
  const outIds = new Set((change.out ?? []).map((p) => p.id));
  const left = squad.filter((p) => !outIds.has(p.id));
  const total = left.length + (change.in ?? 0);
  if (total > TRANSFER.squad.max) return `squad would exceed ${TRANSFER.squad.max} players`;
  if (left.length < minSquad(size)) return `squad would fall below ${minSquad(size)} players`;
  if (left.filter((p) => p.position === "GK").length < TRANSFER.squad.goalkeepers)
    return "club would have no goalkeeper";
  return null;
}

/** Plain-language squad needs for the manager ("Weakest starting place: FW …"). */
export function squadNeeds(club: ClubState, size: TeamSize): string[] {
  const out: string[] = [];
  const side = strongestSide(club.squad, size);
  const filled = side.filter((s) => s.player) as Array<{ position: Position; player: MarketPlayer }>;
  for (const pos of ["GK", "DF", "MF", "FW"] as const) {
    const need = SLOT_POSITIONS[size].filter((p) => p === pos).length;
    const have = club.squad.filter((p) => p.position === pos).length;
    if (have < need + 1)
      out.push(`${pos}: ${have} in the squad for ${need} starting place${need === 1 ? "" : "s"} (no cover)`);
  }
  const weakest = [...filled].sort((a, b) => a.player.overall - b.player.overall)[0];
  if (weakest)
    out.push(`Weakest starting place: ${weakest.position}, ${weakest.player.name} (overall ${weakest.player.overall})`);
  const unused = club.squad.filter((p) => p.lastSeason && p.lastSeason.teamMatches > 0 && p.lastSeason.starts === 0);
  if (unused.length)
    out.push(
      `No starts last season: ${unused.map((p) => `${p.name} (${p.position}, wage ${p.wage.toLocaleString("en-GB")} cr)`).join(", ")}`,
    );
  out.push(`Squad: ${club.squad.length} registered (minimum ${minSquad(size)}, maximum ${TRANSFER.squad.max})`);
  return out;
}
