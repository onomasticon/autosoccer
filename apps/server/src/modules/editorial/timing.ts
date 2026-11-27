/**
 * The news cycle. Every article gets a place in the league's timeline, derived from the schedule
 * rather than from when a worker happened to write it, so pieces about the same moment are
 * staggered and read in a sensible order:
 *
 *   kickoff → full time (MATCH_MINUTES) → match reports, a few minutes apart → the round piece →
 *   (after the final round) the champions story → the next season's league news and takeovers →
 *   the transfer window round-up → the club finances piece → previews in the hours before kickoff.
 *
 * Offsets scale with the gap between rounds (a league playing every hour has a tighter cycle than
 * one playing weekly), and an article whose time is still to come is held back until then
 * (published_at > now is never served). Pure functions plus a couple of schedule lookups.
 */
import type { Db } from "@autosoccer/db";

/** League time from kickoff to the final whistle. */
export const MATCH_MINUTES = 10;
const MIN = 60_000;

/** How much of the full (4-hour) news cycle a season's round gap allows: 0.1–1. */
export const cycleScale = (gapMinutes: number) => Math.min(1, Math.max(0.1, gapMinutes / 240));

const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * MIN);

/** The i-th match report of a round (fixtures in id order): just after full time, four minutes apart. */
export const reportAt = (kickoff: Date, index: number, gap: number) =>
  at(kickoff, MATCH_MINUTES + (5 + 4 * index) * cycleScale(gap));

/** The round's analysis or column, once the reports are in. */
export const roundPieceAt = (lastKickoff: Date, gap: number) => at(lastKickoff, MATCH_MINUTES + 40 * cycleScale(gap));

/** The champions story, after the final round's piece. */
export const championsAt = (lastKickoff: Date, gap: number) => at(lastKickoff, MATCH_MINUTES + 60 * cycleScale(gap));

/**
 * Previews of a round: spread across the run-up to kickoff, from an hour after the previous round
 * (or 2½ hours before kickoff, whichever is later) to just before it.
 */
export function previewAt(prevEnd: Date | null, kickoff: Date, index: number, count: number, gap: number): Date {
  const s = cycleScale(gap);
  const hi = at(kickoff, -5 * s).getTime();
  let lo = Math.max(prevEnd ? at(prevEnd, 50 * s).getTime() : -Infinity, at(kickoff, -150 * s).getTime());
  if (!(lo < hi)) lo = hi - count * 2 * MIN;
  const step = count > 1 ? (hi - lo) / count : 0;
  return new Date(Math.round(lo + step * index));
}

/** `offset` minutes (scaled) after a moment in league time, or `fallback` when there's no schedule. */
export const inCycle = (anchor: Date | null, offsetMinutes: number, gap: number, fallback: Date) =>
  anchor ? at(anchor, offsetMinutes * cycleScale(gap)) : fallback;

/** Something that happened at `happened`, but no earlier in the cycle than `notBefore` + `offset`. */
export function newsAt(happened: Date, notBefore: Date | null, offsetMinutes: number, gap: number): Date {
  const floor = notBefore ? at(notBefore, offsetMinutes * cycleScale(gap)).getTime() : -Infinity;
  return new Date(Math.max(happened.getTime(), floor));
}

export interface SeasonClock {
  /** Minutes between rounds (240 when there's only one round or no schedule). */
  gap: number;
  /** Each round's first kickoff. */
  kickoffs: Map<number, Date>;
  lastRound: number;
}

export async function seasonClock(db: Db, seasonId: string): Promise<SeasonClock> {
  const rows = await db<{ round: number; kickoff: Date | null }[]>`
    select round, min(scheduled_at) as kickoff from fixtures where season_id = ${seasonId} group by round order by round`;
  const times = rows.filter((r) => r.kickoff).map((r) => r.kickoff!.getTime());
  const gap =
    times.length > 1 ? Math.max(5, (Math.max(...times) - Math.min(...times)) / MIN / (times.length - 1)) : 240;
  return {
    gap,
    kickoffs: new Map(rows.filter((r) => r.kickoff).map((r) => [r.round, r.kickoff!])),
    lastRound: rows.at(-1)?.round ?? 0,
  };
}

/**
 * True when a season (or the one before it) is being played ahead of its calendar: a match started
 * more than a minute before its kickoff (demos, ops replays, tests). Its news cycle can't follow
 * the calendar, so articles are dated when they're written instead of being held back.
 */
export async function aheadOfSchedule(db: Db, seasonId: string): Promise<boolean> {
  const [r] = await db<{ ahead: boolean }[]>`
    select exists (
      select 1 from matches m join fixtures f on f.id = m.fixture_id
      where f.season_id in (${seasonId}, (
          select p.id from seasons p where p.created_at < (select created_at from seasons where id = ${seasonId})
            and p.league_id = (select league_id from seasons where id = ${seasonId})
          order by p.created_at desc limit 1))
        and m.started_at < f.scheduled_at - interval '1 minute'
    ) or exists (
      select 1 from fixtures f where f.season_id = ${seasonId} and f.status <> 'scheduled'
        and f.scheduled_at > now() + interval '1 minute'
    ) as ahead`;
  return r!.ahead;
}

/** When a season's last match ended in league time (null without a schedule). */
export async function seasonEnd(db: Db, seasonId: string): Promise<Date | null> {
  const c = await seasonClock(db, seasonId);
  const k = c.kickoffs.get(c.lastRound);
  return k ? at(k, MATCH_MINUTES) : null;
}
