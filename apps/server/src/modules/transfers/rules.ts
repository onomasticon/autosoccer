/**
 * transfer/1: the league's transfer window, in one versioned table. Fan-facing explanation:
 * docs/platform/transfers.md. Fees are whole credits (Ȼ), the same fictional money as finance/1.
 */
import { wageFor } from "../finance/rules.ts";

export const TRANSFER_RULE = "transfer/1";

export const TRANSFER = {
  version: TRANSFER_RULE,
  /** Players a club may list (invite offers for) per window. */
  maxListings: 2,
  /** Bids a club may make per window (one per player). */
  maxBids: 2,
  /** Smallest bid. */
  minFee: 100_000,
  squad: {
    /** Fewest registered players a club may be left with: the starting side plus this many. */
    reservesAtLeast: 2,
    /** Most registered players a club may have after signing. */
    max: 18,
    /** Goalkeepers a club must keep. */
    goalkeepers: 1,
  },
  /** Guide fee: a season's wages (rounds) at the player's rating, plus a little per goal. */
  guide: { wageRounds: 24, perGoal: 100_000, goalCap: 5, roundTo: 50_000 },
  window: {
    /** The window's deadline is this many minutes before round 1 kicks off (less if it opens late). */
    closeBeforeKickoffMin: 15,
    /** Listing, bidding and replying each get an equal share of the time before the deadline. */
    phases: ["listing", "bidding", "replying"] as const,
  },
} as const;

export type WindowPhase = (typeof TRANSFER.window.phases)[number] | "closed";

/** Fewest players a squad may keep for a team size (7-a-side: 9). */
export const minSquad = (playersPerTeam: number) => playersPerTeam + TRANSFER.squad.reservesAtLeast;

/**
 * Guide fee for a player: 24 rounds of wages at their rating for the new season, plus Ȼ100k per
 * league goal last season (up to 5), rounded to Ȼ50k. Clubs may bid more or less.
 */
export function guideFee(overall: number, goalsLastSeason = 0): number {
  const g = TRANSFER.guide;
  const raw = wageFor(overall) * g.wageRounds + g.perGoal * Math.min(goalsLastSeason, g.goalCap);
  return Math.max(TRANSFER.minFee, Math.round(raw / g.roundTo) * g.roundTo);
}
