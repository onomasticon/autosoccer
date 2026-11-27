/**
 * insolvency/2 (#97, candidate): financial failure never forfeits a season. A club that can't pay
 * borrows, sells or is administered, and every club plays every fixture. Supersedes insolvency/1's
 * walkovers and takeovers for new-league rules only. Past seasons keep insolvency/1 (pinned per
 * season), so old walkovers stay exactly as they were.
 *
 * Deterministic pure rules, shared by the economy harness (#98) and, once integrated, by settlement.
 * Money is whole credits (cr), never real USD. The numbers are a starting point for calibration in
 * the harness, not final values.
 *
 * The league lender is the league itself: one deterministic counterparty with three facilities.
 *  - secured: an ordinary loan against contracted players (their registration and transfer
 *    proceeds), at a conservative loan-to-value; repaid in instalments every round.
 *  - emergency: restricted financing for essential obligations (wages) when cash runs short; senior,
 *    dearer, and while it is outstanding the club can't make discretionary signings.
 *  - support: in administration, repayable senior support that keeps wages paid and fixtures played.
 *    Never a gift: it carries interest and is repaid before anything else.
 * At default the lender realises collateral through a compulsory sealed-bid auction open to every
 * eligible club, applies the proceeds through a waterfall (support, then emergency, then secured),
 * and returns any surplus to the club. A club whose debt still exceeds its cap enters administration:
 * a deterministic administrator sells surplus players, a transfer embargo applies and income sweeps
 * to the lender, while the club's own manager keeps sporting control.
 */
export const INSOLVENCY_2_RULE = "insolvency/2";

export const INSOLVENCY_2 = {
  version: INSOLVENCY_2_RULE,
  secured: {
    /** Lend up to this share of pledged players' conservative value. */
    ltv: 0.5,
    interestPerSeason: 0.08,
    termSeasons: 3,
  },
  emergency: { interestPerSeason: 0.15, termSeasons: 2 },
  support: { interestPerSeason: 0.05 },
  /** Total debt (all facilities) a club may carry before default: this many seasons of its wage bill. */
  debtCapSeasons: 0.75,
  /** Collateral is valued at this share of the guide fee (conservative), and never past contract expiry. */
  collateralHaircut: 0.6,
  auction: {
    /** Lowest acceptable bid: this share of the player's guide fee. */
    reserve: 0.4,
  },
  administration: {
    /** Leave administration when debt is at most this share of the cap and cash covers `cashRounds` of wages. */
    exitDebtShare: 0.5,
    cashRounds: 3,
    /** Share of every season's surplus cash swept to the lender while administered. */
    sweep: 1,
  },
} as const;

export type Facility = "secured" | "emergency" | "support";

/** Repayment order: the most senior first. */
export const SENIORITY: Facility[] = ["support", "emergency", "secured"];

export interface LoanLike {
  id: string;
  kind: Facility;
  balance: number;
  /** Season the loan must be repaid by (inclusive). */
  dueSeason: number;
  collateral: string[];
}

export const interestFor = (kind: Facility) =>
  kind === "secured"
    ? INSOLVENCY_2.secured.interestPerSeason
    : kind === "emergency"
      ? INSOLVENCY_2.emergency.interestPerSeason
      : INSOLVENCY_2.support.interestPerSeason;

/** A season's wage bill → the most the club may owe in total. */
export const debtCap = (seasonWageBill: number) => Math.round(INSOLVENCY_2.debtCapSeasons * seasonWageBill);

/**
 * What a player is worth as collateral for a loan running to `untilSeason`: a haircut of the guide
 * fee, and nothing if the player's contract ends first (no pledge beyond expiry) or if already pledged.
 */
export function collateralValue(
  p: { guideFee: number; contractUntil: number; pledged: boolean },
  untilSeason: number,
): number {
  if (p.pledged || p.contractUntil < untilSeason) return 0;
  return Math.floor(p.guideFee * INSOLVENCY_2.collateralHaircut);
}

/** The most a club can borrow on a secured loan against `collateral`, within its debt cap. */
export function securedCapacity(collateralTotal: number, debt: number, seasonWageBill: number): number {
  return Math.max(0, Math.min(Math.floor(collateralTotal * INSOLVENCY_2.secured.ltv), debtCap(seasonWageBill) - debt));
}

/** Instalment due this round on a loan: what's left spread over the rounds until it's due. */
export function instalment(
  loan: LoanLike,
  season: number,
  roundsLeftThisSeason: number,
  roundsPerSeason: number,
): number {
  const rounds = Math.max(1, roundsLeftThisSeason + Math.max(0, loan.dueSeason - season) * roundsPerSeason);
  return Math.min(loan.balance, Math.ceil(loan.balance / rounds));
}

/**
 * Emergency financing for a payroll shortfall: the shortfall itself, if it fits under the cap and
 * the club isn't already administered. Otherwise null (default).
 */
export function emergencyFinancing(shortfall: number, debt: number, seasonWageBill: number, administered: boolean) {
  if (shortfall <= 0) return 0;
  if (administered || debt + shortfall > debtCap(seasonWageBill)) return null;
  return shortfall;
}

/** Applies money to loans most-senior first. Returns what each loan receives and the surplus. */
export function waterfall(
  amount: number,
  loans: LoanLike[],
): { repaid: Array<{ id: string; amount: number }>; surplus: number } {
  let left = Math.max(0, amount);
  const repaid: Array<{ id: string; amount: number }> = [];
  const ordered = [...loans].sort(
    (a, b) => SENIORITY.indexOf(a.kind) - SENIORITY.indexOf(b.kind) || a.id.localeCompare(b.id),
  );
  for (const l of ordered) {
    if (left <= 0) break;
    const pay = Math.min(left, l.balance);
    if (pay > 0) repaid.push({ id: l.id, amount: pay });
    left -= pay;
  }
  return { repaid, surplus: left };
}

/**
 * The compulsory sealed-bid auction: every eligible club may submit one bid; the highest at or above
 * the reserve wins; ties go to the earlier-registered club (lowest id), never to whoever answered
 * first. Returns null when the auction fails (no valid bid).
 */
export function auctionWinner(
  bids: Array<{ club: string; amount: number }>,
  guideFee: number,
): { club: string; amount: number } | null {
  const reserve = Math.ceil(guideFee * INSOLVENCY_2.auction.reserve);
  const valid = bids.filter((b) => b.amount >= reserve && Number.isFinite(b.amount));
  valid.sort((a, b) => b.amount - a.amount || a.club.localeCompare(b.club));
  return valid[0] ?? null;
}

/** Whether a club in administration can leave it. */
export function canExitAdministration(debt: number, cash: number, roundWageBill: number, seasonWageBill: number) {
  const a = INSOLVENCY_2.administration;
  return debt <= a.exitDebtShare * debtCap(seasonWageBill) && cash >= a.cashRounds * roundWageBill;
}
