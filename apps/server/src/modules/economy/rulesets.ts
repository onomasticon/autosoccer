/**
 * Rulesets the harness can run. `legacy` is exactly what production runs today (finance/2,
 * transfer/1, insolvency/1, ageing/1), built from the production rule functions rather than copies
 * of their numbers, so a change to production rules changes the harness baseline too.
 */
import { FINANCE_3, finance3, RULES, rulesFor, wageFor } from "../finance/rules.ts";
import { INSOLVENCY_2 } from "../insolvency/recovery.ts";
import { INSOLVENCY } from "../insolvency/rules.ts";
import { guideFee, TRANSFER } from "../transfers/rules.ts";
import type { Ruleset, Scenario } from "./model.ts";

export const LEGACY: Ruleset = {
  name: "legacy",
  finance: (rounds) => rulesFor("finance/2", rounds),
  wage: (overall, fr) => wageFor(overall, fr),
  guideFee: (overall, goals) => guideFee(overall, goals),
  minFee: TRANSFER.minFee,
  maxBids: TRANSFER.maxBids,
  squad: { target: 16, min: 7 + TRANSFER.squad.reservesAtLeast, max: TRANSFER.squad.max, goalkeepers: 1, side: 7 },
  insolvency: "forfeit",
  takeoverTo: INSOLVENCY.takeover.capitalTo,
  contractSeasons: null,
  replacement: "academy",
  poolPerClub: 0,
  noForfeits: false,
};

/**
 * The Phase 2 candidate (#97): finance/3 (sized for 20 clubs) and insolvency/2 (the league lender,
 * compulsory auctions and administration instead of forfeits), with 14-player squads.
 */
export const CANDIDATE: Ruleset = {
  ...LEGACY,
  name: "candidate",
  finance: (rounds) => finance3(rounds),
  squad: { ...LEGACY.squad, target: 14, max: 16 },
  insolvency: "recovery",
  takeoverTo: undefined,
  lender: {
    ltv: INSOLVENCY_2.secured.ltv,
    interestPerSeason: INSOLVENCY_2.secured.interestPerSeason,
    termSeasons: INSOLVENCY_2.secured.termSeasons,
    emergencyInterestPerSeason: INSOLVENCY_2.emergency.interestPerSeason,
    maxDebtSeasons: INSOLVENCY_2.debtCapSeasons,
  },
  noForfeits: true,
};

/** finance/3 numbers to try in a grid (`--rulesets candidate,candidate-lean,…`). */
const variant = (name: string, over: Partial<typeof FINANCE_3>): Ruleset => ({
  ...CANDIDATE,
  name,
  finance: (rounds) => finance3(rounds, { ...FINANCE_3, ...over }),
});

export const RULESETS: Record<string, Ruleset> = {
  legacy: LEGACY,
  candidate: CANDIDATE,
  "candidate-lean": variant("candidate-lean", { distribution: 4_000_000 }),
  "candidate-rich": variant("candidate-rich", { distribution: 5_000_000 }),
  "candidate-flat": variant("candidate-flat", { curve: 1 }),
};

export const SCENARIOS: Record<string, Scenario> = {
  baseline: { name: "baseline", description: "Equal opening balance, a mix of policies, every manager available." },
  "low-liquidity": {
    name: "low-liquidity",
    description: "A thin market: one bid per club and a 1m cr minimum fee.",
    maxBids: 1,
    minFee: 1_000_000,
  },
  "extreme-leverage": {
    name: "extreme-leverage",
    description: "Every club runs the aggressive policy: spends to the limit on signings.",
    policy: "aggressive",
  },
  "ageing-wave": {
    name: "ageing-wave",
    description: "Founding squads aged 29–33, so a retirement wave arrives within a few seasons.",
    ages: { min: 29, max: 33 },
  },
  "simultaneous-defaults": {
    name: "simultaneous-defaults",
    description: "Every club opens with a quarter of the normal balance, so many are short at once.",
    opening: Math.round(RULES.opening / 4),
  },
  "provider-downtime": {
    name: "provider-downtime",
    description: "Each manager decision fails 30% of the time (model unavailable): the club does nothing.",
    downtime: 0.3,
  },
};
