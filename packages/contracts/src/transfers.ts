/**
 * Transfer window ("transfer-window/1"): the market between two seasons (transfer/1). Listings,
 * every bid with its fee, status and both clubs' stated reasons, and the deals that settled. Fees
 * are fictional credits (Ȼ) from the club treasury (club-finances/1).
 */
import { z } from "zod";
import { Id, Position, Slug, Timestamp } from "./common.ts";
import { Team } from "./domain.ts";

export const TRANSFERS_CONTRACT = "transfer-window/1";

export const TransferPhase = z.enum(["listing", "bidding", "replying", "closed"]);
export const BidStatus = z.enum(["pending", "accepted", "rejected", "lapsed", "outbid", "completed", "failed"]);
export type BidStatus = z.infer<typeof BidStatus>;

const PlayerRef = z.object({ id: Id, name: z.string(), position: Position, overall: z.number().int() });

export const TransferBid = z.object({
  id: Id,
  player: PlayerRef,
  seller: Team,
  buyer: Team,
  fee: z.number().int().positive(),
  /** The player's wage per round at the buying club (finance rules, at this season's rating). */
  wage: z.number().int().nonnegative(),
  status: BidStatus,
  /** The buying manager's stated reason. */
  buyerReason: z.string(),
  /** The selling manager's stated reason, once decided (or why it lapsed). */
  sellerReason: z.string().nullable(),
  /** How a tie was resolved, or why a settlement failed. */
  outcome: z.string().nullable(),
  createdAt: Timestamp,
  settledAt: Timestamp.nullable(),
});
export type TransferBid = z.infer<typeof TransferBid>;

export const TransferWindowResponse = z.object({
  contract: z.literal(TRANSFERS_CONTRACT),
  /** The latest window (or the one for ?season=), null before any. */
  window: z
    .object({
      season: z.object({ slug: Slug, name: z.string() }),
      rule: z.string(),
      phase: TransferPhase,
      opensAt: Timestamp,
      deadline: Timestamp,
      phaseEndsAt: Timestamp,
      closedAt: Timestamp.nullable(),
    })
    .nullable(),
  listings: z.array(
    z.object({ player: PlayerRef, team: Team, askingFee: z.number().int().nullable(), reason: z.string() }),
  ),
  /** Every bid, deals first, then by fee. */
  bids: z.array(TransferBid),
  rules: z.object({
    maxListings: z.number().int(),
    maxBids: z.number().int(),
    minFee: z.number().int(),
    minSquad: z.number().int(),
    maxSquad: z.number().int(),
    goalkeepers: z.number().int(),
    closeBeforeKickoffMin: z.number().int(),
  }),
});
export type TransferWindowResponse = z.infer<typeof TransferWindowResponse>;
