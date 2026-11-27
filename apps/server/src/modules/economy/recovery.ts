/**
 * insolvency/2 in the harness: the league lender, defaults, compulsory collateral auctions and
 * administration, driven by the production rule functions in insolvency/recovery.ts. Every club
 * plays every fixture; nothing here forfeits a match or gives money away.
 */
import {
  auctionWinner,
  canExitAdministration,
  collateralValue,
  debtCap,
  emergencyFinancing,
  INSOLVENCY_2,
  instalment,
  interestFor,
  securedCapacity,
  waterfall,
} from "../insolvency/recovery.ts";
import { credit, squadOf, startingSide, type World } from "./engine.ts";
import type { HClub, HPlayer, Loan } from "./model.ts";

const rounds = (w: World) => 2 * (w.clubs.size - 1);
export const debtOf = (c: HClub) => c.loans.reduce((s, l) => s + l.balance, 0);
const roundBill = (w: World, c: HClub) => squadOf(w, c.id).reduce((s, p) => s + p.wage, 0);
const seasonBill = (w: World, c: HClub) => roundBill(w, c) * rounds(w);

function lend(w: World, c: HClub, kind: Loan["kind"], amount: number, round: number | null, collateral: string[] = []) {
  if (amount <= 0) return;
  const id = `L${++w.nextLoan}`;
  const term =
    kind === "secured"
      ? INSOLVENCY_2.secured.termSeasons
      : kind === "emergency"
        ? INSOLVENCY_2.emergency.termSeasons
        : 3;
  c.loans.push({
    id,
    kind,
    principal: amount,
    balance: amount,
    dueSeason: w.season + term - 1,
    collateral,
    openedSeason: w.season,
  });
  credit(w, c.id, "loan", amount, `loan:${id}`, round);
}

function repay(w: World, c: HClub, amount: number, round: number | null, tag: string) {
  const { repaid } = waterfall(Math.min(amount, Math.max(0, c.cash)), c.loans);
  for (const r of repaid) {
    const l = c.loans.find((x) => x.id === r.id)!;
    l.balance -= r.amount;
    credit(w, c.id, "repayment", -r.amount, `repay:${l.id}:${w.season}:${round ?? "end"}:${tag}`, round);
  }
  releaseRepaid(c);
}

function releaseRepaid(c: HClub) {
  c.loans = c.loans.filter((l) => l.balance > 0); // a repaid loan's liens are released with it
}

/** Players the administrator or lender may sell: never below the minimum squad or the last keeper. */
function sellable(w: World, c: HClub): HPlayer[] {
  const r = w.config.ruleset;
  const squad = squadOf(w, c.id);
  if (squad.length <= r.squad.min) return [];
  const keepers = squad.filter((p) => p.position === "GK").length;
  return squad
    .filter((p) => p.position !== "GK" || keepers > r.squad.goalkeepers)
    .sort((a, b) => b.wage - a.wage || b.overall - a.overall || a.id.localeCompare(b.id));
}

/**
 * Sells players one at a time until `enough()`: who may be sold is re-checked after every sale, so
 * the club never drops below the minimum squad or its last keeper (a list computed once would sell
 * a second keeper after the first). Players nobody bids for stay; the loop ends when none are left.
 */
function forcedSales(w: World, c: HClub, round: number | null, enough: () => boolean) {
  const failed = new Set<string>();
  while (!enough()) {
    const p = sellable(w, c).find((x) => !failed.has(x.id));
    if (!p) return;
    if (!auction(w, c, p, round)) failed.add(p.id);
  }
}

/** A compulsory sealed-bid auction for one player: every eligible club bids once; proceeds to the lender. */
function auction(w: World, seller: HClub, p: HPlayer, round: number | null): boolean {
  const r = w.config.ruleset;
  const guide = r.guideFee(p.overall, p.goalsLastSeason);
  const bids: Array<{ club: string; amount: number }> = [];
  for (const c of w.clubs.values()) {
    if (c.id === seller.id || c.administration || c.loans.some((l) => l.kind === "emergency")) continue;
    const squad = squadOf(w, c.id);
    if (squad.length >= r.squad.max) continue;
    const side = startingSide(squad, r.squad.side) ?? [];
    const weakest = side.filter((x) => x.position === p.position).sort((a, b) => a.overall - b.overall)[0];
    if (weakest && p.overall <= weakest.overall - 3) continue;
    const m = { conservative: 0.5, aggressive: 0.8, trader: p.age <= 25 ? 0.8 : 0.45, adaptive: 0.6, opportunist: 0.7 }[
      c.policy
    ];
    const spare = c.cash - 3 * roundBill(w, c);
    const amount = Math.min(spare, Math.round((guide * m) / 10_000) * 10_000);
    if (amount > 0) bids.push({ club: c.id, amount });
  }
  const win = auctionWinner(bids, guide);
  if (!win) return false;
  credit(w, win.club, "auction", -win.amount, `auction:${w.season}:${round ?? "off"}:${p.id}:${win.club}`, round);
  credit(w, seller.id, "auction", win.amount, `auction:${w.season}:${round ?? "off"}:${p.id}:${seller.id}`, round);
  p.club = win.club;
  for (const l of seller.loans) l.collateral = l.collateral.filter((x) => x !== p.id);
  w.deals.push({ season: w.season, player: p.id, from: seller.id, to: win.club, fee: win.amount, overall: p.overall });
  w.events.push({ season: w.season, round, kind: "forced_sale", club: seller.id, amount: win.amount, detail: p.id });
  repay(w, seller, win.amount, round, `auction:${p.id}`);
  return true;
}

/**
 * The payroll check under insolvency/2: a club short of a round's wages borrows emergency money if
 * it fits under its cap; otherwise it defaults: the lender auctions players (proceeds repay debt),
 * the club enters administration, and repayable senior support pays what's still short. The round's
 * wages are always paid, so every fixture is played.
 */
export function ensurePayroll(w: World, c: HClub, round: number, payroll: number, due: number) {
  const shortfall = payroll - (c.cash + due);
  if (shortfall <= 0) return;
  const bill = seasonBill(w, c);
  const emergency = emergencyFinancing(shortfall, debtOf(c), bill, c.administration);
  if (emergency !== null) {
    lend(w, c, "emergency", emergency, round);
    w.events.push({ season: w.season, round, kind: "emergency", club: c.id, amount: emergency });
    return;
  }
  w.events.push({ season: w.season, round, kind: "default", club: c.id, amount: shortfall });
  forcedSales(w, c, round, () => debtOf(c) <= debtCap(bill) && c.cash + due >= payroll);
  if (!c.administration && debtOf(c) > INSOLVENCY_2.administration.exitDebtShare * debtCap(bill)) {
    c.administration = true;
    w.events.push({ season: w.season, round, kind: "administration", club: c.id, amount: debtOf(c) });
  }
  const still = payroll - (c.cash + due);
  if (still > 0) lend(w, c, "support", still, round);
}

/** Instalments every round, after wages. A missed instalment is a default (administration). */
export function serviceLoans(w: World, round: number) {
  const total = rounds(w);
  for (const c of w.clubs.values()) {
    for (const l of [...c.loans]) {
      const due = instalment(l, w.season, total - round + 1, total);
      if (due <= 0) continue;
      const pay = Math.min(due, Math.max(0, c.cash));
      if (pay > 0) {
        l.balance -= pay;
        credit(w, c.id, "repayment", -pay, `instalment:${l.id}:${w.season}:${round}`, round);
      }
      if (pay < due && !c.administration && l.kind !== "support") {
        c.administration = true;
        w.events.push({ season: w.season, round, kind: "default", club: c.id, amount: due - pay });
        w.events.push({ season: w.season, round, kind: "administration", club: c.id, amount: debtOf(c) });
      }
    }
    releaseRepaid(c);
  }
}

/** Season end: interest accrues; administered clubs sweep surplus cash to the lender and may exit. */
export function closeSeason(w: World) {
  for (const c of w.clubs.values()) {
    for (const l of c.loans) l.balance += Math.round(l.balance * interestFor(l.kind));
    const bill = roundBill(w, c);
    if (c.administration) {
      const surplus = c.cash - INSOLVENCY_2.administration.cashRounds * bill;
      if (surplus > 0) repay(w, c, Math.round(surplus * INSOLVENCY_2.administration.sweep), null, "sweep");
      if (canExitAdministration(debtOf(c), c.cash, bill, bill * rounds(w))) {
        c.administration = false;
        w.events.push({ season: w.season, round: null, kind: "recovery", club: c.id, amount: debtOf(c) });
      }
    }
    const distressed = c.administration || c.cash < 3 * bill;
    if (distressed && c.distressSince === null) c.distressSince = w.season;
    if (!distressed) c.distressSince = null;
  }
}

/**
 * The offseason under insolvency/2: the administrator sells surplus players (by compulsory auction)
 * until debt is back under the cap, and clubs whose policy borrows take secured loans against their
 * contracted players to fund the window.
 */
export function offseason(w: World) {
  for (const c of w.clubs.values()) {
    if (!c.administration) continue;
    const bill = seasonBill(w, c);
    forcedSales(w, c, null, () => debtOf(c) <= debtCap(bill));
  }
  for (const c of w.clubs.values()) {
    if (c.administration || c.loans.some((l) => l.kind === "emergency")) continue;
    if (c.policy !== "aggressive" && c.policy !== "opportunist") continue;
    const until = w.season + INSOLVENCY_2.secured.termSeasons - 1;
    const pledged = new Set(c.loans.flatMap((l) => l.collateral));
    const pledge: string[] = [];
    let value = 0;
    for (const p of squadOf(w, c.id).sort((a, b) => a.id.localeCompare(b.id))) {
      const v = collateralValue(
        {
          guideFee: w.config.ruleset.guideFee(p.overall, p.goalsLastSeason),
          contractUntil: p.contractUntil,
          pledged: pledged.has(p.id),
        },
        until,
      );
      if (v > 0) {
        pledge.push(p.id);
        value += v;
      }
    }
    const amount = securedCapacity(value, debtOf(c), seasonBill(w, c));
    // Only what the window could use: an aggressive club borrows up to a third of a season's wages.
    const want = Math.min(amount, Math.round(seasonBill(w, c) / 3));
    if (want >= 500_000) {
      lend(w, c, "secured", want, null, pledge);
      w.events.push({ season: w.season, round: null, kind: "borrow", club: c.id, amount: want });
    }
  }
}
