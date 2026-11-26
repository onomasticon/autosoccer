/**
 * The league's fictional economy, in whole credits (cr). Every number a club earns or pays comes
 * from a versioned table, so balancing is a matter of adding a version. Each season records the
 * version it plays under (seasons.finance_rule) and is always settled by it.
 * Fan-facing explanation: docs/platform/finances.md.
 *
 *  - finance/1: the four-club, six-round league.
 *  - finance/2: any league size. Wages and result income are season amounts paid in equal shares
 *    per round (a six-round season pays exactly finance/1's per-round numbers; an 18-round season a
 *    third of them a round), so a longer season costs and earns about the same. The prize table runs
 *    to ten places.
 */
export const FINANCE_RULE = "finance/2";

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

/** finance/1, kept as it was: past seasons are settled by it, and it's the transfer guide's scale. */
export const RULES: FinanceRules = {
  version: "finance/1",
  opening: 12_000_000,
  distribution: 6_000_000,
  result: { win: 600_000, draw: 250_000, loss: 0 },
  prize: [4_000_000, 2_500_000, 1_500_000, 800_000],
  wage: { base: 30_000, perPoint: 3_000, floor: 45, min: 20_000 },
};

/** finance/2's season amounts are finance/1's per-round numbers over this many rounds. */
const REFERENCE_ROUNDS = 6;
const FINANCE_2_PRIZES = [
  4_000_000, 2_500_000, 1_500_000, 800_000, 700_000, 600_000, 500_000, 400_000, 300_000, 200_000,
];

/**
 * The concrete numbers for a season: its rule version and how many rounds it has. finance/1 is
 * fixed; finance/2 scales wages and result income to the season's length.
 */
export function rulesFor(version: string | null | undefined, rounds: number): FinanceRules {
  if (version !== "finance/2") return RULES;
  const k = REFERENCE_ROUNDS / Math.max(1, rounds);
  const r1000 = (n: number) => Math.round((n * k) / 1000) * 1000;
  return {
    version,
    opening: RULES.opening,
    distribution: RULES.distribution,
    result: { win: r1000(RULES.result.win), draw: r1000(RULES.result.draw), loss: 0 },
    prize: FINANCE_2_PRIZES,
    wage: {
      base: RULES.wage.base * k,
      perPoint: RULES.wage.perPoint * k,
      floor: RULES.wage.floor,
      min: r1000(RULES.wage.min),
    },
  };
}

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
