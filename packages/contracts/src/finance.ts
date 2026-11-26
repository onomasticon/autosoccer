/**
 * Club finances ("club-finances/1"): a club's fictional treasury in whole credits (cr). Separate from
 * the real AI compute budget (#24). Every entry comes from the ledger the league settles under a
 * versioned rule (finance/1); see docs/platform/finances.md.
 */
import { z } from "zod";
import { Slug, Timestamp } from "./common.ts";
import { Team } from "./domain.ts";

export const FINANCES_CONTRACT = "club-finances/1";

export const LedgerKind = z.enum(["opening", "distribution", "result", "prize", "payroll"]);
export type LedgerKind = z.infer<typeof LedgerKind>;

export const FinanceSeason = z.object({
  season: z.object({ slug: Slug, name: z.string() }),
  /** Income and spending by source (credits; spending negative). */
  bySource: z.object({
    distribution: z.number().int(),
    results: z.number().int(),
    prize: z.number().int(),
    payroll: z.number().int(),
  }),
  net: z.number().int(),
});
export type FinanceSeason = z.infer<typeof FinanceSeason>;

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
