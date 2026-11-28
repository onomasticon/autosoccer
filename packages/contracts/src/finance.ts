/**
 * Club finances ("club-finances/1"): a club's fictional treasury in whole credits (Ȼ). Separate from
 * the real AI compute budget (#24). Every entry comes from the ledger the league settles under a
 * versioned rule (finance/1); see docs/platform/finances.md.
 */
import { z } from "zod";
import { Slug, Timestamp } from "./common.ts";
import { Team } from "./domain.ts";

export const FINANCES_CONTRACT = "club-finances/1";

export const LedgerKind = z.enum([
  "opening",
  "distribution",
  "result",
  "prize",
  "payroll",
  "transfer",
  "takeover",
  // Phase 2 (finance/3, insolvency/2, recruit/1)
  "operating",
  "loan",
  "repayment",
  "auction",
  "recruitment",
]);
export type LedgerKind = z.infer<typeof LedgerKind>;

export const FinanceSeason = z.object({
  season: z.object({ slug: Slug, name: z.string() }),
  /** Income and spending by source (credits; spending negative). */
  bySource: z.object({
    distribution: z.number().int(),
    results: z.number().int(),
    prize: z.number().int(),
    payroll: z.number().int(),
    /** Transfer fees received minus fees paid (transfer/1); 0 in seasons without a window. */
    transfers: z.number().int().default(0),
    /** New owners' capital after a bankruptcy (insolvency/1); 0 otherwise. */
    takeover: z.number().int().default(0),
    /** Running costs (finance/3); 0 otherwise. */
    operating: z.number().int().default(0),
    /** Loans received minus repayments (insolvency/2); 0 otherwise. */
    borrowing: z.number().int().default(0),
    /** Forced auction proceeds minus purchases (insolvency/2); 0 otherwise. */
    auctions: z.number().int().default(0),
    /** Safety-net assignment fees (recruit/1); 0 otherwise. */
    recruitment: z.number().int().default(0),
  }),
  net: z.number().int(),
});
export type FinanceSeason = z.infer<typeof FinanceSeason>;

const SeasonRef = z.object({ slug: Slug, name: z.string() });

/** A loan from the league lender (insolvency/2), as the official record shows it. */
export const ClubLoan = z.object({
  kind: z.enum(["secured", "emergency", "support"]),
  principal: z.number().int(),
  /** Still owed: principal plus interest, minus repayments. */
  balance: z.number().int(),
  repaid: z.number().int(),
  interest: z.number().int(),
  opened: z.object({ season: SeasonRef, round: z.number().int().nullable() }),
  dueSeason: z.number().int(),
  status: z.enum(["active", "repaid"]),
  /** Players pledged as collateral (names, as public record), still pledged. */
  pledged: z.array(z.string()),
});

/** Debt and recovery (insolvency/2): only for clubs that have been in a season with the league lender. */
export const ClubDebt = z.object({
  rule: z.literal("insolvency/2"),
  total: z.number().int(),
  loans: z.array(ClubLoan),
  administration: z
    .object({
      since: z.object({ season: SeasonRef, round: z.number().int().nullable() }),
      debtAtEntry: z.number().int(),
      reason: z.string(),
      exited: SeasonRef.nullable(),
    })
    .nullable(),
  /** Rounds where the club couldn't meet its obligations, and what the lender did. Newest first. */
  events: z.array(
    z.object({
      season: SeasonRef,
      round: z.number().int(),
      outcome: z.enum(["emergency", "default"]),
      shortfall: z.number().int(),
      /** Players the lender auctioned that round. */
      auctioned: z.number().int().nonnegative(),
    }),
  ),
  /** Forced auctions the club was part of (as seller or buyer). Sealed bids stay private: only the count. */
  auctions: z.array(
    z.object({
      season: SeasonRef,
      round: z.number().int(),
      player: z.object({ id: z.string(), name: z.string() }),
      role: z.enum(["sold", "bought", "unsold"]),
      counterparty: Team.nullable(),
      amount: z.number().int().nullable(),
      reserve: z.number().int(),
      bidders: z.number().int().nonnegative(),
    }),
  ),
});
export type ClubDebt = z.infer<typeof ClubDebt>;

export const ClubFinancesResponse = z.object({
  contract: z.literal(FINANCES_CONTRACT),
  team: Team,
  /** False until the club has played a season with club finances. */
  active: z.boolean(),
  rule: z.string().nullable(),
  balance: z.number().int(),
  /** Wages now: per round, and still to pay in the current season (rounds not yet released). */
  payroll: z.object({
    perRound: z.number().int(),
    players: z.number().int().nonnegative(),
    roundsToPay: z.number().int().nonnegative(),
    remaining: z.number().int(),
  }),
  /** Cash left after the wages still due this season, before any income still to come. */
  headroom: z.number().int(),
  /** Oldest finance season first. */
  seasons: z.array(FinanceSeason),
  /** The latest entries, newest first. */
  entries: z.array(
    z.object({
      kind: LedgerKind,
      season: z.object({ slug: Slug, name: z.string() }).nullable(),
      round: z.number().int().nullable(),
      amount: z.number().int(),
      memo: z.string(),
      at: Timestamp,
    }),
  ),
  /** Debt and recovery under insolvency/2; null for clubs that never played under the lender. */
  debt: ClubDebt.nullable().default(null),
  /** The rule's numbers, for "how the money works". */
  rules: z.object({
    opening: z.number().int(),
    distribution: z.number().int(),
    result: z.object({ win: z.number().int(), draw: z.number().int(), loss: z.number().int() }),
    prize: z.array(z.number().int()),
    wage: z.object({
      base: z.number().int(),
      perPoint: z.number().int(),
      floor: z.number().int(),
      min: z.number().int(),
    }),
  }),
});
export type ClubFinancesResponse = z.infer<typeof ClubFinancesResponse>;
