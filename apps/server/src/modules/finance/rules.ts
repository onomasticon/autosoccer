/**
 * finance/1: the league's fictional economy, in whole credits (cr). Every number a club earns or
 * pays comes from this table, so balancing is a matter of editing it and bumping the version.
 * Fan-facing explanation: docs/platform/finances.md.
 */
export const FINANCE_RULE = "finance/1";

export interface FinanceRules {
  version: string;
  /** Paid once to each club when it first plays a finance season. */
  opening: number;
  /** Paid to every club when a season kicks off (its first round is released). */
  distribution: number;
  /** Paid after each official result. */
  result: { win: number; draw: number; loss: number };
  /** Paid when the season completes, by finishing position (last entry repeats for larger leagues). */
  prize: number[];
  /** Wages per player per round: base + perPoint × (overall − floor), floored at `min`. */
  wage: { base: number; perPoint: number; floor: number; min: number };
}

export const RULES: FinanceRules = {
  version: FINANCE_RULE,
  opening: 12_000_000,
  distribution: 6_000_000,
  result: { win: 600_000, draw: 250_000, loss: 0 },
  prize: [4_000_000, 2_500_000, 1_500_000, 800_000],
  wage: { base: 30_000, perPoint: 3_000, floor: 45, min: 20_000 },
};

/** One player's wage for one round, from their overall rating that season. Rounded to 1,000 cr. */
export function wageFor(overall: number, r: FinanceRules = RULES): number {
  return Math.max(r.wage.min, Math.round((r.wage.base + r.wage.perPoint * (overall - r.wage.floor)) / 1000) * 1000);
}

export function prizeFor(position: number, r: FinanceRules = RULES): number {
  return r.prize[Math.min(position, r.prize.length) - 1] ?? 0;
}

export function resultIncome(goalsFor: number, goalsAgainst: number, r: FinanceRules = RULES): number {
  return goalsFor > goalsAgainst ? r.result.win : goalsFor === goalsAgainst ? r.result.draw : r.result.loss;
}

/** "1.25m cr", "450k cr", "−300k cr". */
export function formatCredits(n: number): string {
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}m cr`;
  if (a >= 1_000) return `${sign}${Math.round(a / 1_000)}k cr`;
  return `${sign}${a} cr`;
}
