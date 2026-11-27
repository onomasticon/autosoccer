/**
 * Rulesets the harness can run. `legacy` is exactly what production runs today (finance/2,
 * transfer/1, insolvency/1, ageing/1), built from the production rule functions rather than copies
 * of their numbers, so a change to production rules changes the harness baseline too.
 */
import { RULES, rulesFor, wageFor } from "../finance/rules.ts";
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

export const RULESETS: Record<string, Ruleset> = { legacy: LEGACY };

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
