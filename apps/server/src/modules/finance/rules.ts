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
 * finance/3 (candidate for the Phase 2 league, #97): sized for 20 clubs rather than 10. Season
 * amounts for results; a distribution a little lower than finance/2's, because the prize table now
 * pays every place, falling steeply from the top. Calibrated in the economy harness (#98); not used
 * by any live season until a new league is created with it.
 */
export const FINANCE_3 = {
  version: "finance/3",
  opening: 12_000_000,
  distribution: 4_500_000,
  /** What a club would earn for winning (drawing) every match of a season; paid per result. */
  winSeason: 4_800_000,
  drawSeason: 1_900_000,
  /** Prizes for 1st and last; between them they fall along a curve (exponent `curve`). */
  prizeTop: 4_000_000,
  prizeBottom: 300_000,
  curve: 2,
};

/** finance/3's prize table for a league of `clubs`, rounded to 50k cr. */
export function finance3Prizes(clubs: number, f = FINANCE_3): number[] {
  return Array.from({ length: clubs }, (_, i) => {
    const x = clubs > 1 ? (clubs - 1 - i) / (clubs - 1) : 1;
    return Math.round((f.prizeBottom + (f.prizeTop - f.prizeBottom) * x ** f.curve) / 50_000) * 50_000;
  });
}

/** finance/3's numbers for a season of `rounds` (a double round robin of rounds / 2 + 1 clubs). */
export function finance3(rounds: number, f = FINANCE_3): FinanceRules {
  const k = REFERENCE_ROUNDS / Math.max(1, rounds);
  const r1000 = (n: number) => Math.round(n / 1000) * 1000;
  return {
    version: f.version,
    opening: f.opening,
    distribution: f.distribution,
    result: { win: r1000(f.winSeason / rounds), draw: r1000(f.drawSeason / rounds), loss: 0 },
    prize: finance3Prizes(Math.round(rounds / 2) + 1, f),
    wage: {
      base: RULES.wage.base * k,
      perPoint: RULES.wage.perPoint * k,
      floor: RULES.wage.floor,
      min: r1000(RULES.wage.min * k),
    },
  };
}

/**
 * The concrete numbers for a season: its rule version and how many rounds it has. finance/1 is
 * fixed; finance/2 scales wages and result income to the season's length; finance/3 also sizes the
 * prize table to the league.
 */
export function rulesFor(version: string | null | undefined, rounds: number): FinanceRules {
  if (version === "finance/3") return finance3(rounds);
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
