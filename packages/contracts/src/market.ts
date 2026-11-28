/**
 * A season's player market ("market/1"), as the public record shows it: the inaugural recruitment
 * rounds, renewals and releases, free-agent signings, the safety net and the lender's forced auctions
 * (transfer/2, recruit/1, insolvency/2). Only official outcomes: an offer that didn't sign and the
 * clubs' sealed auction bids stay private (an auction shows how many clubs bid, not what they bid).
 */
import { z } from "zod";
import { Slug, Timestamp } from "./common.ts";
import { Team } from "./domain.ts";

export const MARKET_CONTRACT = "market/1";

export const MarketWindowKind = z.enum(["recruitment", "preseason", "midseason"]);

const PlayerRef = z.object({ id: z.string(), name: z.string(), position: z.enum(["GK", "DF", "MF", "FW"]) });

export const MarketMove = z.object({
  window: z.object({ kind: MarketWindowKind, round: z.number().int() }).nullable(),
  type: z.enum(["recruited", "signed", "renewed", "released", "safety-net"]),
  player: PlayerRef,
  team: Team,
  /** The signed contract's wage and length (public terms); null for a release. */
  wagePerSeason: z.number().int().nullable(),
  years: z.number().int().nullable(),
  /** Safety-net assignments: the stated fee the club paid. */
  fee: z.number().int().nullable(),
  /** The manager's stated reason, when there is one (a default decision has none). */
  reason: z.string().nullable(),
  /** 'default': nobody decided by the deadline, so the league's safe default applied. */
  source: z.enum(["manager", "default", "league"]),
});
export type MarketMove = z.infer<typeof MarketMove>;

export const MarketAuction = z.object({
  round: z.number().int(),
  player: PlayerRef,
  seller: Team,
  buyer: Team.nullable(),
  amount: z.number().int().nullable(),
  reserve: z.number().int(),
  bidders: z.number().int().nonnegative(),
});
export type MarketAuction = z.infer<typeof MarketAuction>;

export const SeasonMarketResponse = z.object({
  contract: z.literal(MARKET_CONTRACT),
  season: z.object({ slug: Slug, name: z.string() }),
  rule: z.string().nullable(),
  windows: z.array(
    z.object({
      kind: MarketWindowKind,
      round: z.number().int(),
      phase: z.enum(["renewals", "free_agency", "closed"]),
      opensAt: Timestamp,
      deadline: Timestamp,
      /** The league round the window's moves take effect from. */
      effectiveRound: z.number().int(),
    }),
  ),
  moves: z.array(MarketMove),
  auctions: z.array(MarketAuction),
});
export type SeasonMarketResponse = z.infer<typeof SeasonMarketResponse>;
