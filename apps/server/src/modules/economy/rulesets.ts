/**
 * Rulesets the harness can run. `legacy` is exactly what production runs today (finance/2,
 * transfer/1, insolvency/1, ageing/1), built from the production rule functions rather than copies
 * of their numbers, so a change to production rules changes the harness baseline too.
 */
import { FINANCE_3, finance3, RULES, rulesFor, wageFor } from "../finance/rules.ts";
import { INSOLVENCY_2 } from "../insolvency/recovery.ts";
import { INSOLVENCY } from "../insolvency/rules.ts";
import { guideFee, TRANSFER, TRANSFER_2 } from "../transfers/rules.ts";
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
 * compulsory auctions and administration instead of forfeits), with 14-player squads, contracted
 * wages (1–4 seasons) and Ȼ1m of running costs a season (the calibrated sink; see recovery.md).
 */
export const CANDIDATE: Ruleset = {
  ...LEGACY,
  name: "candidate",
  finance: (rounds) => finance3(rounds),
  squad: { ...LEGACY.squad, target: 14, max: 16 },
  contractSeasons: { min: 1, max: 4 },
  operatingPerSeason: FINANCE_3.operatingPerSeason,
  operatingShare: FINANCE_3.operatingShare,
  wageMarket: FINANCE_3.wageMarket,
  contractYears: FINANCE_3.contractYears,
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
const variant = (name: string, over: Partial<typeof FINANCE_3>, base: Ruleset = CANDIDATE): Ruleset => {
  const f = { ...FINANCE_3, ...over };
  return {
    ...base,
    name,
    finance: (rounds) => finance3(rounds, f),
    operatingPerSeason: f.operatingPerSeason,
    operatingShare: f.operatingShare,
    wageMarket: f.wageMarket,
    contractYears: f.contractYears,
  };
};

/** The candidate before calibration: no contracts and no running costs (kept for comparison). */
const UNCALIBRATED: Ruleset = { ...CANDIDATE, name: "candidate-v0", contractSeasons: null, operatingPerSeason: 0 };
/** The contract candidate, the base of the calibration grid. */
const CONTRACTS: Ruleset = CANDIDATE;

/** Calibration grid for the money sink: running costs × how strongly wages follow the money. */
const GRID: Record<string, Partial<typeof FINANCE_3>> = {
  "c-ops0-a0": { operatingPerSeason: 0, wageMarket: { alpha: 0, min: 1, max: 1 } },
  "c-ops1-a0": { operatingPerSeason: 1_000_000, wageMarket: { alpha: 0, min: 1, max: 1 } },
  "c-ops0-a05": { operatingPerSeason: 0, wageMarket: { alpha: 0.5, min: 0.8, max: 3 } },
  "c-ops05-a05": { operatingPerSeason: 500_000, wageMarket: { alpha: 0.5, min: 0.8, max: 3 } },
  "c-ops1-a05": { operatingPerSeason: 1_000_000, wageMarket: { alpha: 0.5, min: 0.8, max: 3 } },
  "c-ops0-a1": { operatingPerSeason: 0, wageMarket: { alpha: 1, min: 0.8, max: 3 } },
  "c-ops05-a1": { operatingPerSeason: 500_000, wageMarket: { alpha: 1, min: 0.8, max: 3 } },
  "c-ops05-s10": { operatingPerSeason: 500_000, operatingShare: 0.1, wageMarket: { alpha: 0, min: 1, max: 1 } },
  "c-ops05-s15": { operatingPerSeason: 500_000, operatingShare: 0.15, wageMarket: { alpha: 0, min: 1, max: 1 } },
  "c-ops0-s15": { operatingPerSeason: 0, operatingShare: 0.15, wageMarket: { alpha: 0, min: 1, max: 1 } },
  "c-ops0-s20": { operatingPerSeason: 0, operatingShare: 0.2, wageMarket: { alpha: 0, min: 1, max: 1 } },
  "c-ops11-a0": { operatingPerSeason: 1_100_000, wageMarket: { alpha: 0, min: 1, max: 1 } },
  "c-ops1-s02": { operatingPerSeason: 1_000_000, operatingShare: 0.02, wageMarket: { alpha: 0, min: 1, max: 1 } },
  "c-ops1-s04": { operatingPerSeason: 1_000_000, operatingShare: 0.04, wageMarket: { alpha: 0, min: 1, max: 1 } },
  "c-ops12-a0": { operatingPerSeason: 1_200_000, wageMarket: { alpha: 0, min: 1, max: 1 } },
  "c-ops15-a0": { operatingPerSeason: 1_500_000, wageMarket: { alpha: 0, min: 1, max: 1 } },
};

/** transfer/2 on top of the calibrated candidate: free agency, binding listings, a midseason window. */
const withMarket = (base: Ruleset, name: string, over: Partial<NonNullable<Ruleset["market"]>> = {}): Ruleset => ({
  ...base,
  name,
  maxBids: TRANSFER_2.maxBids,
  market: {
    freeAgency: TRANSFER_2.freeAgency,
    bindingListings: TRANSFER_2.bindingListings,
    midseasonWindow: TRANSFER_2.midseasonWindow,
    listingAsk: TRANSFER_2.listingAsk,
    maxListings: TRANSFER_2.maxListings,
    renewal: { ...TRANSFER_2.renewal },
    ...over,
  },
});

export const RULESETS: Record<string, Ruleset> = {
  legacy: LEGACY,
  candidate: CANDIDATE,
  "candidate-t2": withMarket(CANDIDATE, "candidate-t2"),
  "t2-no-mid": withMarket(CANDIDATE, "t2-no-mid", { midseasonWindow: false }),
  "t2-no-fa": withMarket(CANDIDATE, "t2-no-fa", { freeAgency: false }),
  "t2-binding": withMarket(CANDIDATE, "t2-binding", { bindingListings: true }),
  "t2-ask75": withMarket(CANDIDATE, "t2-ask75", { bindingListings: true, listingAsk: 0.75 }),
  "t2-keep8": withMarket(CANDIDATE, "t2-keep8", { renewal: { keepBest: 8, keepYoungUpTo: 23 } }),
  // Gate 8 (held-out inflation) on transfer/2: one careful step on the running-cost sink.
  "t2-ops11": withMarket(variant("ops11", { operatingPerSeason: 1_100_000 }), "t2-ops11"),
  "t2-ops12": withMarket(variant("ops12", { operatingPerSeason: 1_200_000 }), "t2-ops12"),
  "t2-ops1-s02": withMarket(variant("ops1-s02", { operatingShare: 0.02 }), "t2-ops1-s02"),
  "t2-ops1-s04": withMarket(variant("ops1-s04", { operatingShare: 0.04 }), "t2-ops1-s04"),
  "candidate-v0": UNCALIBRATED,
  // Pinned at the Ȼ1m running costs it was calibrated with (its regression test is about keepers).
  "candidate-lean": variant("candidate-lean", { distribution: 4_000_000, operatingPerSeason: 1_000_000 }),
  // Lean income with the launch's Ȼ1.1m running costs: a chronically weak club's debt passes the
  // bounded-debt invariant (a known risk, recovery.md); kept so the harness keeps measuring it.
  "lean-ops11": variant("lean-ops11", { distribution: 4_000_000 }),
  "candidate-rich": variant("candidate-rich", { distribution: 5_000_000 }),
  "candidate-flat": variant("candidate-flat", { curve: 1 }),
  ...Object.fromEntries(Object.entries(GRID).map(([k, v]) => [k, variant(k, v, CONTRACTS)])),
};

export const SCENARIOS: Record<string, Scenario> = {
  baseline: { name: "baseline", description: "Equal opening balance, a mix of policies, every manager available." },
  "low-liquidity": {
    name: "low-liquidity",
    description: "A thin market: one bid per club and a Ȼ1m minimum fee.",
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
