/**
 * What the harness measures each season. Units: whole credits (Ȼ), clubs, players, deals.
 */
import { squadOf, type World } from "./engine.ts";
import type { LedgerKind, PolicyName } from "./model.ts";

export interface SeasonStats {
  season: number;
  champion: string;
  /** Final positions, champion first. */
  table: string[];
  cash: Record<string, number>;
  totalCash: number;
  /** Gini coefficient of cash across clubs (0 = equal, 1 = one club has everything). */
  gini: number;
  /** Share of all cash held by the richest quarter of clubs. */
  topQuarterShare: number;
  /** Money in and out this season, by kind (signed totals across all clubs). */
  flows: Partial<Record<LedgerKind, number>>;
  avgWagePerRound: number;
  maxWagePerRound: number;
  deals: number;
  fees: number;
  avgFee: number;
  market: { bids: number; accepted: number; rejected: number; failed: number; unavailable: number };
  withdrawals: number;
  takeovers: number;
  takeoverCapital: number;
  defaults: number;
  forcedSales: number;
  emergencies: number;
  administrations: number;
  recoveries: number;
  borrowing: number;
  /** Clubs in distress at the end of the season (cash below three rounds of wages, or in administration). */
  distressed: number;
  debt: number;
  retirements: number;
  newPlayers: number;
  unattached: number;
  squadMin: number;
  squadMax: number;
  avgOverall: number;
  /** Spearman correlation of this season's final positions with last season's (1: nobody moved). */
  mobility: number | null;
  /** Cash change by policy, mean per club. */
  profitByPolicy: Partial<Record<PolicyName, number>>;
}

export function gini(xs: number[]): number {
  const v = xs.map((x) => Math.max(0, x)).sort((a, b) => a - b);
  const n = v.length;
  const sum = v.reduce((s, x) => s + x, 0);
  if (!n || sum === 0) return 0;
  let acc = 0;
  v.forEach((x, i) => {
    acc += (2 * (i + 1) - n - 1) * x;
  });
  return acc / (n * sum);
}

export function spearman(a: string[], b: string[]): number {
  const n = a.length;
  const pos = new Map(b.map((id, i) => [id, i]));
  let d2 = 0;
  a.forEach((id, i) => {
    d2 += (i - (pos.get(id) ?? i)) ** 2;
  });
  return n < 2 ? 1 : 1 - (6 * d2) / (n * (n * n - 1));
}

export function seasonStats(w: World, ledgerFrom: number, prev?: SeasonStats): SeasonStats {
  const clubs = [...w.clubs.values()];
  const cash = Object.fromEntries(clubs.map((c) => [c.id, c.cash]));
  const sorted = Object.values(cash).sort((a, b) => b - a);
  const total = sorted.reduce((s, x) => s + x, 0);
  const flows: Partial<Record<LedgerKind, number>> = {};
  for (const e of w.ledger.slice(ledgerFrom)) flows[e.kind] = (flows[e.kind] ?? 0) + e.amount;
  const active = [...w.players.values()].filter((p) => p.club && !p.retired);
  const wages = active.map((p) => p.wage);
  const deals = w.deals.filter((d) => d.season === w.season);
  const events = w.events.filter((e) => e.season === w.season);
  const sizes = clubs.map((c) => squadOf(w, c.id).length);
  const table = w.tables.get(w.season)!;
  const profit: Partial<Record<PolicyName, number[]>> = {};
  for (const c of clubs) {
    profit[c.policy] = profit[c.policy] ?? [];
    profit[c.policy]!.push(c.cash - (prev?.cash[c.id] ?? 0));
  }
  return {
    season: w.season,
    champion: table[0]!,
    table,
    cash,
    totalCash: total,
    gini: round(gini(Object.values(cash)), 3),
    topQuarterShare:
      total > 0
        ? round(sorted.slice(0, Math.max(1, Math.round(clubs.length / 4))).reduce((s, x) => s + x, 0) / total, 3)
        : 0,
    flows,
    avgWagePerRound: Math.round(wages.reduce((s, x) => s + x, 0) / Math.max(1, wages.length)),
    maxWagePerRound: Math.max(0, ...wages),
    deals: deals.length,
    fees: deals.reduce((s, d) => s + d.fee, 0),
    avgFee: deals.length ? Math.round(deals.reduce((s, d) => s + d.fee, 0) / deals.length) : 0,
    market: { ...w.market },
    withdrawals: events.filter((e) => e.kind === "withdrawal").length,
    takeovers: events.filter((e) => e.kind === "takeover").length,
    takeoverCapital: events.filter((e) => e.kind === "takeover").reduce((s, e) => s + (e.amount ?? 0), 0),
    defaults: events.filter((e) => e.kind === "default").length,
    forcedSales: events.filter((e) => e.kind === "forced_sale").length,
    emergencies: events.filter((e) => e.kind === "emergency").length,
    administrations: events.filter((e) => e.kind === "administration").length,
    recoveries: events.filter((e) => e.kind === "recovery").length,
    borrowing: events.filter((e) => e.kind === "borrow").reduce((s, e) => s + (e.amount ?? 0), 0),
    distressed: clubs.filter((c) => c.administration || c.cash < squadOf(w, c.id).reduce((s, p) => s + p.wage, 0) * 3)
      .length,
    debt: clubs.reduce((s, c) => s + c.loans.reduce((t, l) => t + l.balance, 0), 0),
    retirements: w.retiredThisSeason,
    newPlayers: w.joinedThisSeason,
    unattached: [...w.players.values()].filter((p) => !p.club && !p.retired).length,
    squadMin: Math.min(...sizes),
    squadMax: Math.max(...sizes),
    avgOverall: round(active.reduce((s, p) => s + p.overall, 0) / Math.max(1, active.length), 1),
    mobility: prev ? round(spearman(table, prev.table), 3) : null,
    profitByPolicy: Object.fromEntries(
      Object.entries(profit).map(([k, v]) => [k, Math.round(v!.reduce((s, x) => s + x, 0) / v!.length)]),
    ),
  };
}

const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp;
