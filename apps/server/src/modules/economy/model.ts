/**
 * The economy harness's world (#98): clubs, players, a ledger and the rules that move money,
 * entirely in memory, so 100+ seasons run in seconds. Money is whole credits (cr), the league's
 * fictional currency, never real USD.
 */
import type { PlayerAttributes, Position } from "@autosoccer/contracts";
import type { FinanceRules } from "../finance/rules.ts";

/** A seeded uniform generator (mulberry32): the whole run is a function of its seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Knuth's Poisson sampler, for synthetic goals. */
export function poisson(rand: () => number, lambda: number): number {
  const l = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > l && k < 20);
  return k - 1;
}

export interface HPlayer {
  id: string;
  position: Position;
  attrs: PlayerAttributes;
  overall: number;
  age: number;
  /** Hidden development rate (ageing/1). */
  rate: number;
  /** Club id, or null for an unattached player (free agent / talent pool). */
  club: string | null;
  /** Per-round wage this season (ruleset decides: rating-based or contracted). */
  wage: number;
  /** Last season number of the player's contract (rulesets without contracts: Infinity). */
  contractUntil: number;
  goalsLastSeason: number;
  retired: boolean;
}

export type PolicyName = "conservative" | "aggressive" | "trader" | "adaptive" | "opportunist";
export const POLICIES: PolicyName[] = ["conservative", "aggressive", "trader", "adaptive", "opportunist"];

export interface Loan {
  id: string;
  kind: "secured" | "emergency" | "support";
  principal: number;
  /** Outstanding balance including accrued interest. */
  balance: number;
  /** Season by which it must be repaid. */
  dueSeason: number;
  /** Player ids pledged as collateral. */
  collateral: string[];
  openedSeason: number;
}

export interface HClub {
  id: string;
  name: string;
  policy: PolicyName;
  /** Ledger total, kept in step with the ledger (reconciled by the invariants). */
  cash: number;
  loans: Loan[];
  /** Round from which the club withdrew this season (forfeit rulesets only). */
  withdrawnFrom: number | null;
  /** Under administration: discretionary spending restricted, transfer embargo. */
  administration: boolean;
  /** Seasons spent in distress (cash below a round of wages or in administration), for recovery stats. */
  distressSince: number | null;
}

export type LedgerKind =
  | "opening"
  | "distribution"
  | "result"
  | "prize"
  | "payroll"
  | "transfer"
  | "takeover"
  | "signing"
  | "loan"
  | "repayment"
  | "interest"
  | "auction"
  | "support"
  | "operating";

export interface LedgerEntry {
  key: string;
  club: string;
  season: number;
  round: number | null;
  kind: LedgerKind;
  amount: number;
}

export interface SquadRules {
  /** Players registered per club at the start (and the target the policies keep). */
  target: number;
  /** Fewest a club may be left with (starting side + reserves). */
  min: number;
  max: number;
  goalkeepers: number;
  /** Players per side. */
  side: number;
}

export interface LenderRules {
  /** Fraction of collateral value that can be borrowed. */
  ltv: number;
  /** Interest per season on the outstanding balance. */
  interestPerSeason: number;
  /** Seasons to repay a secured loan. */
  termSeasons: number;
  /** Emergency financing: covers essential obligations only, at a penalty rate. */
  emergencyInterestPerSeason: number;
  /** Most a club may owe, in seasons of its wage bill. */
  maxDebtSeasons: number;
}

/**
 * A ruleset: the economic rules a league runs under. `legacy` is finance/2 + transfer/1 +
 * insolvency/1 as production runs them today; candidates (#97) replace the forfeit with loans,
 * forced sales and administration.
 */
export interface Ruleset {
  name: string;
  /** Production finance table for a season of `rounds`. */
  finance(rounds: number): FinanceRules;
  /** Per-round wage for a player at a rating (legacy: production wageFor). */
  wage(overall: number, fr: FinanceRules): number;
  /** Production transfer guide fee. */
  guideFee(overall: number, goals: number): number;
  minFee: number;
  maxBids: number;
  squad: SquadRules;
  /** What happens when a club can't pay a round's wages. */
  insolvency: "forfeit" | "recovery";
  /** Rescue capital brings cash back to this after a forfeit season (legacy takeover). */
  takeoverTo?: number;
  lender?: LenderRules;
  /** Contracts (seasons) for new signings; null: no contracts, players stay until sold or retired. */
  contractSeasons: { min: number; max: number } | null;
  /** Replacement supply for retirees: academy graduates join the club, or unattached players join the pool. */
  replacement: "academy" | "pool";
  /** Unattached players generated per club each offseason (pool replacement only). */
  poolPerClub: number;
  /** The ruleset promises every fixture is played (no financial walkovers). */
  noForfeits: boolean;
  /** Running costs per club per season, paid in equal shares each round. */
  operatingPerSeason?: number;
  /** Plus this share of the club's earned income last season (finance/3 operatingShare). */
  operatingShare?: number;
  /** Contract wages priced by the market at signing/renewal (contract rulesets only). */
  wageMarket?: { alpha: number; min: number; max: number };
  contractYears?: { young: number; prime: number; veteran: number };
}

/** Synthetic match model: goals ~ Poisson(exp(base + k × strength difference)). */
export interface MatchModel {
  /** Mean goals per side between equal teams. */
  goalsPerSide: number;
  /** Log-rate change per overall point of difference in the starting side's mean. */
  strengthSlope: number;
  homeAdvantage: number;
}

/**
 * Calibrated against the real simulator (docs/platform/economy-surrogate.md): about 3 goals a match
 * and no home advantage (the simulator has none). The strength slope can't be identified from
 * evenly matched squads, so it stays an explicit assumption: 0.06 per rating point, about +6% goals
 * per point of difference in the starting sevens' mean.
 */
export const DEFAULT_MATCH: MatchModel = { goalsPerSide: 1.5, strengthSlope: 0.06, homeAdvantage: 0 };

export interface Scenario {
  name: string;
  description: string;
  /** Override the opening balance. */
  opening?: number;
  /** Starting age range for the founding squads. */
  ages?: { min: number; max: number };
  /** Force every club onto one policy. */
  policy?: PolicyName;
  /** Chance a club's manager is unavailable for a decision (provider downtime). */
  downtime?: number;
  /** Override market liquidity. */
  minFee?: number;
  maxBids?: number;
}
