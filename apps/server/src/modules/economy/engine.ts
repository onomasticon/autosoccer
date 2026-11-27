/**
 * The fast economy mode (#98): seasons of a league played in memory with synthetic results and
 * deterministic policy agents. No database, no simulator, no model calls, no news.
 *
 * What is production logic: the finance table (rulesFor), wages (wageFor), the transfer guide fee,
 * the squad limits, player attributes and overall ratings, ageing deltas and retirements (ageing/1),
 * the payroll check and the forfeit/takeover consequence (insolvency/1). What is surrogate: match
 * results (a Poisson model on starting-side strength, see MatchModel), and the managers (policies.ts).
 */

import { createHash } from "node:crypto";
import type { Position } from "@autosoccer/contracts";
import { ageDeltas, developmentRate, retires } from "../league/ageing.ts";
import { overallRating, playerAttributes } from "../league/attributes.ts";
import { checkInvariants, type InvariantFailure } from "./invariants.ts";
import { type SeasonStats, seasonStats } from "./metrics.ts";
import {
  DEFAULT_MATCH,
  type HClub,
  type HPlayer,
  type LedgerEntry,
  type LedgerKind,
  type MatchModel,
  POLICIES,
  type PolicyName,
  poisson,
  type Ruleset,
  rng,
  type Scenario,
} from "./model.ts";
import { decideBids, decideReply } from "./policies.ts";
import { closeSeason, ensurePayroll, offseason, serviceLoans } from "./recovery.ts";

export interface RunConfig {
  clubs: number;
  seasons: number;
  seed: number;
  ruleset: Ruleset;
  scenario: Scenario;
  /** Policies assigned round-robin to clubs (default: all five). */
  policies?: PolicyName[];
  match?: MatchModel;
}

export interface Fixture {
  season: number;
  round: number;
  home: string;
  away: string;
  homeGoals: number | null;
  awayGoals: number | null;
  walkover: string | null;
  void: boolean;
}

export interface Deal {
  season: number;
  player: string;
  from: string | null;
  to: string;
  fee: number;
  overall: number;
}

export interface Event {
  season: number;
  round: number | null;
  kind:
    | "withdrawal"
    | "takeover"
    | "default"
    | "forced_sale"
    | "administration"
    | "recovery"
    | "unviable"
    | "emergency"
    | "borrow";
  club: string;
  amount?: number;
  detail?: string;
}

export interface World {
  config: RunConfig;
  rand: () => number;
  season: number;
  clubs: Map<string, HClub>;
  players: Map<string, HPlayer>;
  ledger: LedgerEntry[];
  keys: Set<string>;
  fixtures: Fixture[];
  deals: Deal[];
  events: Event[];
  market: { bids: number; accepted: number; rejected: number; failed: number; unavailable: number };
  /** Per-season results digests, to prove past seasons are never rewritten. */
  history: Map<number, string>;
  /** Final positions per season. */
  tables: Map<number, string[]>;
  retiredThisSeason: number;
  joinedThisSeason: number;
  nextPlayer: number;
  nextLoan: number;
}

export interface RunResult {
  config: { clubs: number; seasons: number; seed: number; ruleset: string; scenario: string; policies: PolicyName[] };
  seasons: SeasonStats[];
  failures: InvariantFailure[];
  deals: Deal[];
  events: Event[];
  clubs: Array<{ id: string; name: string; policy: PolicyName; cash: number; titles: number }>;
  ms: number;
}

const POSITIONS_16: Position[] = [
  "GK",
  "GK",
  "DF",
  "DF",
  "DF",
  "DF",
  "DF",
  "MF",
  "MF",
  "MF",
  "MF",
  "MF",
  "FW",
  "FW",
  "FW",
  "FW",
];

/** Positions for a squad of n: two keepers, then DF/MF/FW in proportion. */
export function squadPositions(n: number): Position[] {
  if (n === 16) return POSITIONS_16;
  const out: Position[] = ["GK", "GK"];
  const cycle: Position[] = ["DF", "MF", "FW", "DF", "MF"];
  for (let i = 0; out.length < n; i++) out.push(cycle[i % cycle.length]!);
  return out;
}

export function credit(
  w: World,
  club: string,
  kind: LedgerKind,
  amount: number,
  key: string,
  round: number | null = null,
) {
  if (amount === 0) return;
  if (w.keys.has(key)) throw new Error(`duplicate settlement ${key}`);
  w.keys.add(key);
  w.ledger.push({ key, club, season: w.season, round, kind, amount });
  w.clubs.get(club)!.cash += amount;
}

function newPlayer(w: World, position: Position, age: number, deficit = 0): HPlayer {
  const id = `p${++w.nextPlayer}`;
  const name = `h:${w.config.seed}:${id}`;
  const base = playerAttributes({ name, shirtNumber: w.nextPlayer % 99, position });
  const attrs = deficit
    ? (Object.fromEntries(
        Object.entries(base).map(([k, v]) => [
          k,
          k === "goalkeeping" && position !== "GK" ? v : Math.max(25, v - deficit),
        ]),
      ) as typeof base)
    : base;
  return {
    id,
    position,
    attrs,
    overall: overallRating(attrs, position),
    age,
    rate: developmentRate(name, deficit > 0),
    club: null,
    wage: 0,
    contractUntil: Number.POSITIVE_INFINITY,
    goalsLastSeason: 0,
    retired: false,
  };
}

export function squadOf(w: World, club: string): HPlayer[] {
  const out: HPlayer[] = [];
  for (const p of w.players.values()) if (p.club === club && !p.retired) out.push(p);
  return out;
}

/** The starting side: the best keeper and the best outfield players. Null when the squad can't field one. */
export function startingSide(squad: HPlayer[], side: number): HPlayer[] | null {
  const gk = squad.filter((p) => p.position === "GK").sort((a, b) => b.overall - a.overall)[0];
  const outfield = squad.filter((p) => p !== gk).sort((a, b) => b.overall - a.overall);
  if (!gk || outfield.length < side - 1) return null;
  return [gk, ...outfield.slice(0, side - 1)];
}

export const strength = (side: HPlayer[]) => side.reduce((s, p) => s + p.overall, 0) / side.length;

/** Circle-method double round robin: 2(n−1) rounds, each club once a round, home and away. */
export function doubleRoundRobin(ids: string[]): Array<{ round: number; home: string; away: string }> {
  const list = ids.length % 2 ? [...ids, "bye"] : [...ids];
  const n = list.length;
  const half: Array<{ round: number; home: string; away: string }> = [];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = list[i]!;
      const b = list[n - 1 - i]!;
      if (a === "bye" || b === "bye") continue;
      half.push(r % 2 === 0 ? { round: r + 1, home: a, away: b } : { round: r + 1, home: b, away: a });
    }
    list.splice(1, 0, list.pop()!);
  }
  return [...half, ...half.map((f) => ({ round: f.round + n - 1, home: f.away, away: f.home }))];
}

export function found(config: RunConfig): World {
  const w: World = {
    config,
    rand: rng(config.seed),
    season: 1,
    clubs: new Map(),
    players: new Map(),
    ledger: [],
    keys: new Set(),
    fixtures: [],
    deals: [],
    events: [],
    market: { bids: 0, accepted: 0, rejected: 0, failed: 0, unavailable: 0 },
    history: new Map(),
    tables: new Map(),
    retiredThisSeason: 0,
    joinedThisSeason: 0,
    nextPlayer: 0,
    nextLoan: 0,
  };
  const policies = config.scenario.policy ? [config.scenario.policy] : (config.policies ?? POLICIES);
  for (let i = 0; i < config.clubs; i++) {
    const id = `c${String(i + 1).padStart(2, "0")}`;
    w.clubs.set(id, {
      id,
      name: `Club ${i + 1}`,
      policy: policies[i % policies.length]!,
      cash: 0,
      loans: [],
      withdrawnFrom: null,
      administration: false,
      distressSince: null,
    });
  }
  // Founding squads: a snake draft by overall from a generated pool, per position, so squads are
  // as even as the pool allows (the production founders were picked the same way).
  const ages = config.scenario.ages ?? { min: 18, max: 33 };
  const shape = squadPositions(config.ruleset.squad.target);
  const ids = [...w.clubs.keys()];
  for (const pos of ["GK", "DF", "MF", "FW"] as Position[]) {
    const need = shape.filter((p) => p === pos).length;
    const pool = Array.from({ length: need * ids.length }, () =>
      newPlayer(w, pos, ages.min + Math.floor(w.rand() * (ages.max - ages.min + 1))),
    ).sort((a, b) => b.overall - a.overall);
    pool.forEach((p, k) => {
      const lap = Math.floor(k / ids.length);
      const i = k % ids.length;
      p.club = ids[lap % 2 === 0 ? i : ids.length - 1 - i]!;
      p.contractUntil = config.ruleset.contractSeasons
        ? 1 + (k % config.ruleset.contractSeasons.max)
        : Number.POSITIVE_INFINITY;
      w.players.set(p.id, p);
    });
  }
  const opening = config.scenario.opening ?? config.ruleset.finance(2 * (config.clubs - 1)).opening;
  for (const id of ids) credit(w, id, "opening", opening, `opening:${id}`);
  return w;
}

const available = (w: World) => w.rand() >= (w.config.scenario.downtime ?? 0);

/** ageing/1 between seasons: everyone a year older, development or decline, retirements and replacements. */
function age(w: World) {
  const r = w.config.ruleset;
  w.retiredThisSeason = 0;
  w.joinedThisSeason = 0;
  for (const p of [...w.players.values()]) {
    if (p.retired) continue;
    p.age++;
    const seed = `${w.config.seed}:${p.id}:${w.season}`;
    if (retires(p.age, p.overall, seed)) {
      const club = p.club;
      p.retired = true;
      p.club = null;
      w.players.delete(p.id); // careers end; keeping the live set small keeps 100+ seasons fast
      w.retiredThisSeason++;
      if (club && r.replacement === "academy") {
        const g = newPlayer(w, p.position, 17 + Math.floor(w.rand() * 3), 7);
        g.club = club;
        w.players.set(g.id, g);
        w.joinedThisSeason++;
      }
      continue;
    }
    for (const d of ageDeltas(p.age, p.position, p.rate, seed))
      p.attrs[d.attribute] = Math.max(25, Math.min(95, p.attrs[d.attribute] + d.delta));
    p.overall = overallRating(p.attrs, p.position);
  }
  if (r.replacement === "pool") {
    for (let i = 0; i < r.poolPerClub * w.clubs.size; i++) {
      const pos = squadPositions(r.squad.target)[i % r.squad.target]!;
      const p = newPlayer(w, pos, 17 + Math.floor(w.rand() * 6), 4);
      w.players.set(p.id, p);
      w.joinedThisSeason++;
    }
  }
}

/** The offseason market: bids from every available manager, the seller's reply, settlement highest fee first. */
function market(w: World) {
  const r = w.config.ruleset;
  const minFee = w.config.scenario.minFee ?? r.minFee;
  const maxBids = w.config.scenario.maxBids ?? r.maxBids;
  const fr = r.finance(2 * (w.clubs.size - 1));
  const bids: Array<{ buyer: string; player: HPlayer; fee: number; order: number }> = [];
  let order = 0;
  for (const c of w.clubs.values()) {
    // Administration: transfer embargo. Emergency financing outstanding: no discretionary signings.
    if (c.administration || c.loans.some((l) => l.kind === "emergency")) continue;
    if (!available(w)) {
      w.market.unavailable++;
      continue;
    }
    for (const b of decideBids(w, c, { minFee, maxBids, fr }).slice(0, maxBids)) {
      bids.push({ buyer: c.id, player: w.players.get(b.player)!, fee: b.fee, order: order++ });
      w.market.bids++;
    }
  }
  // Sellers reply to each offer; unavailable sellers' offers lapse (the player stays).
  const accepted = bids.filter((b) => {
    const seller = b.player.club ? w.clubs.get(b.player.club)! : null;
    if (seller && !available(w)) return false;
    const ok = seller ? decideReply(w, seller, b.player, b.fee) : true;
    if (ok) w.market.accepted++;
    else w.market.rejected++;
    return ok;
  });
  accepted.sort((a, b) => b.fee - a.fee || a.order - b.order);
  const done = new Set<string>();
  for (const b of accepted) {
    const p = b.player;
    if (done.has(p.id)) continue;
    const from = p.club;
    const buyer = w.clubs.get(b.buyer)!;
    const buyerSquad = squadOf(w, buyer.id);
    const sellerSquad = from ? squadOf(w, from) : [];
    const keepers = sellerSquad.filter((x) => x.position === "GK").length;
    const pledged = from !== null && w.clubs.get(from)!.loans.some((l) => l.collateral.includes(p.id));
    const fails =
      p.retired ||
      pledged ||
      buyer.cash < b.fee ||
      buyerSquad.length + 1 > r.squad.max ||
      (from !== null && sellerSquad.length - 1 < r.squad.min) ||
      (from !== null && p.position === "GK" && keepers - 1 < r.squad.goalkeepers);
    if (fails) {
      w.market.failed++;
      continue;
    }
    credit(w, buyer.id, "transfer", -b.fee, `transfer:${w.season}:${p.id}:${buyer.id}`);
    if (from) credit(w, from, "transfer", b.fee, `transfer:${w.season}:${p.id}:${from}`);
    p.club = buyer.id;
    if (r.contractSeasons) p.wage = 0; // a new contract, priced at the market when the season starts
    done.add(p.id);
    w.deals.push({ season: w.season, player: p.id, from, to: buyer.id, fee: b.fee, overall: p.overall });
  }
}

function takeovers(w: World) {
  const to = w.config.ruleset.takeoverTo;
  for (const c of w.clubs.values()) {
    if (c.withdrawnFrom === null) continue;
    c.withdrawnFrom = null;
    if (to !== undefined && c.cash < to) {
      const capital = to - c.cash;
      credit(w, c.id, "takeover", capital, `takeover:${w.season}:${c.id}`);
      w.events.push({ season: w.season, round: null, kind: "takeover", club: c.id, amount: capital });
    }
  }
}

/** The market multiplier for new contracts: (median club cash ÷ opening)^alpha, clamped. */
export function marketMultiplier(w: World): number {
  const m = w.config.ruleset.wageMarket;
  if (!m || m.alpha === 0) return 1;
  const opening = w.config.scenario.opening ?? w.config.ruleset.finance(2 * (w.clubs.size - 1)).opening;
  const cash = [...w.clubs.values()].map((c) => c.cash).sort((a, b) => a - b);
  const median = cash[Math.floor(cash.length / 2)] ?? opening;
  return Math.min(m.max, Math.max(m.min, (Math.max(1, median) / Math.max(1, opening)) ** m.alpha));
}

/**
 * Wages for the season. Without contracts (legacy): every player's wage follows their rating each
 * season. With contracts: a wage is fixed for the contract; new signings, graduates and expired
 * contracts are (re)priced at the rating-based wage times the market multiplier.
 */
function setWages(w: World, fr: ReturnType<Ruleset["finance"]>) {
  const r = w.config.ruleset;
  if (!r.contractSeasons) {
    for (const p of w.players.values()) if (!p.retired && p.club) p.wage = r.wage(p.overall, fr);
    return;
  }
  const m = marketMultiplier(w);
  const y = r.contractYears ?? { young: 3, prime: 2, veteran: 1 };
  for (const p of w.players.values()) {
    if (p.retired || !p.club) continue;
    if (p.wage > 0 && p.contractUntil >= w.season) continue;
    p.wage = Math.round((r.wage(p.overall, fr) * m) / 1000) * 1000;
    const years = p.age >= 31 ? y.veteran : p.age >= 27 ? y.prime : y.young;
    p.contractUntil = w.season + Math.min(r.contractSeasons.max, Math.max(r.contractSeasons.min, years)) - 1;
  }
}

function playSeason(w: World) {
  const r = w.config.ruleset;
  const m = w.config.match ?? DEFAULT_MATCH;
  const ids = [...w.clubs.keys()];
  const rounds = 2 * (ids.length - 1);
  const fr = r.finance(rounds);
  setWages(w, fr);
  // Running costs: a flat part plus a share of what each club earned last season.
  const earned = new Map<string, number>();
  if (r.operatingShare)
    for (const e of w.ledger)
      if (e.season === w.season - 1 && (e.kind === "distribution" || e.kind === "result" || e.kind === "prize"))
        earned.set(e.club, (earned.get(e.club) ?? 0) + e.amount);
  const operatingOf = (club: string) =>
    Math.round(((r.operatingPerSeason ?? 0) + (r.operatingShare ?? 0) * (earned.get(club) ?? 0)) / rounds);
  // A seeded order each season, so the same clubs don't always meet in the same round.
  const order = [...ids].sort(
    (a, b) => hash(`${w.config.seed}:${w.season}:${a}`) - hash(`${w.config.seed}:${w.season}:${b}`),
  );
  const calendar = doubleRoundRobin(order);
  const goals = new Map<string, number>();
  const seasonFixtures: Fixture[] = [];
  for (let round = 1; round <= rounds; round++) {
    // Payroll check before the round (insolvency/1): cash plus money due at kick-off.
    for (const c of w.clubs.values()) {
      if (c.withdrawnFrom !== null) continue;
      const due = round === 1 ? fr.distribution : 0;
      const payroll = squadOf(w, c.id).reduce((s, p) => s + p.wage, 0) + operatingOf(c.id);
      if (c.cash + due < payroll) {
        if (r.insolvency === "forfeit") {
          c.withdrawnFrom = round;
          w.events.push({ season: w.season, round, kind: "withdrawal", club: c.id, amount: payroll - c.cash - due });
        } else {
          ensurePayroll(w, c, round, payroll, due);
        }
      }
    }
    for (const c of w.clubs.values()) {
      if (c.withdrawnFrom !== null) continue;
      if (round === 1) credit(w, c.id, "distribution", fr.distribution, `distribution:${w.season}:${c.id}`, 1);
      const payroll = squadOf(w, c.id).reduce((s, p) => s + p.wage, 0);
      credit(w, c.id, "payroll", -payroll, `payroll:${w.season}:${round}:${c.id}`, round);
      const ops = operatingOf(c.id);
      if (ops) credit(w, c.id, "operating", -ops, `operating:${w.season}:${round}:${c.id}`, round);
    }
    if (r.lender) serviceLoans(w, round);
    for (const f of calendar.filter((x) => x.round === round)) {
      const home = w.clubs.get(f.home)!;
      const away = w.clubs.get(f.away)!;
      const fx: Fixture = { ...f, season: w.season, homeGoals: null, awayGoals: null, walkover: null, void: false };
      const hOut = home.withdrawnFrom !== null;
      const aOut = away.withdrawnFrom !== null;
      if (hOut && aOut) fx.void = true;
      else if (hOut || aOut) fx.walkover = hOut ? away.id : home.id;
      else {
        const hs = startingSide(squadOf(w, home.id), r.squad.side);
        const as = startingSide(squadOf(w, away.id), r.squad.side);
        if (!hs || !as) {
          w.events.push({ season: w.season, round, kind: "unviable", club: !hs ? home.id : away.id });
          fx.walkover = !hs ? away.id : home.id;
        } else {
          const d = strength(hs) - strength(as);
          fx.homeGoals = poisson(w.rand, m.goalsPerSide * Math.exp(m.homeAdvantage + m.strengthSlope * d));
          fx.awayGoals = poisson(w.rand, m.goalsPerSide * Math.exp(-m.strengthSlope * d));
          for (const [side, n] of [
            [hs, fx.homeGoals],
            [as, fx.awayGoals],
          ] as const)
            for (let g = 0; g < n; g++) {
              const scorer = side[1 + Math.floor(w.rand() * (side.length - 1))]!;
              goals.set(scorer.id, (goals.get(scorer.id) ?? 0) + 1);
            }
          credit(
            w,
            home.id,
            "result",
            income(fx.homeGoals, fx.awayGoals, fr),
            `result:${w.season}:${round}:${home.id}`,
            round,
          );
          credit(
            w,
            away.id,
            "result",
            income(fx.awayGoals, fx.homeGoals, fr),
            `result:${w.season}:${round}:${away.id}`,
            round,
          );
        }
      }
      seasonFixtures.push(fx);
    }
  }
  w.fixtures.push(...seasonFixtures);
  for (const p of w.players.values()) p.goalsLastSeason = goals.get(p.id) ?? 0;
  // Final table and prizes: withdrawn clubs are placed last and get no prize.
  const table = standings(ids, seasonFixtures, w);
  w.tables.set(w.season, table);
  const eligible = table.filter((id) => w.clubs.get(id)!.withdrawnFrom === null);
  for (const [i, id] of eligible.entries())
    credit(w, id, "prize", fr.prize[Math.min(i + 1, fr.prize.length) - 1] ?? 0, `prize:${w.season}:${id}`);
  w.history.set(w.season, digest(seasonFixtures));
  if (r.lender) closeSeason(w);
}

const income = (gf: number, ga: number, fr: ReturnType<Ruleset["finance"]>) =>
  gf > ga ? fr.result.win : gf === ga ? fr.result.draw : fr.result.loss;

export function standings(ids: string[], fixtures: Fixture[], w: World): string[] {
  const t = new Map(ids.map((id) => [id, { pts: 0, gd: 0, gf: 0 }]));
  for (const f of fixtures) {
    if (f.void) continue;
    const h = t.get(f.home)!;
    const a = t.get(f.away)!;
    if (f.walkover) {
      t.get(f.walkover)!.pts += 3;
      continue;
    }
    const hg = f.homeGoals!;
    const ag = f.awayGoals!;
    h.gf += hg;
    a.gf += ag;
    h.gd += hg - ag;
    a.gd += ag - hg;
    if (hg > ag) h.pts += 3;
    else if (hg < ag) a.pts += 3;
    else {
      h.pts++;
      a.pts++;
    }
  }
  const out = (id: string) => (w.clubs.get(id)!.withdrawnFrom === null ? 0 : 1);
  return [...ids].sort((x, y) => {
    const a = t.get(x)!;
    const b = t.get(y)!;
    return out(x) - out(y) || b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || x.localeCompare(y);
  });
}

const hash = (s: string) => createHash("sha256").update(s).digest().readUInt32BE(0);

export function digest(fixtures: Fixture[]): string {
  const h = createHash("sha256");
  for (const f of fixtures)
    h.update(`${f.round}|${f.home}|${f.away}|${f.homeGoals}|${f.awayGoals}|${f.walkover}|${f.void}\n`);
  return h.digest("hex");
}

/** One season: the offseason (ageing, takeovers, the market) unless it's the first, then the matches. */
export function nextSeason(w: World, s: number, prev?: SeasonStats): SeasonStats {
  w.season = s;
  w.market = { bids: 0, accepted: 0, rejected: 0, failed: 0, unavailable: 0 };
  const ledgerFrom = w.ledger.length;
  if (s > 1) {
    age(w);
    takeovers(w);
    if (w.config.ruleset.lender) offseason(w);
    market(w);
  }
  playSeason(w);
  return seasonStats(w, ledgerFrom, prev);
}

/** Runs a whole league: found the clubs, then season after season. Deterministic for the config. */
export function runLeague(config: RunConfig): RunResult {
  const t0 = performance.now();
  const w = found(config);
  const seasons: SeasonStats[] = [];
  const failures: InvariantFailure[] = [];
  for (let s = 1; s <= config.seasons; s++) {
    seasons.push(nextSeason(w, s, seasons.at(-1)));
    failures.push(...checkInvariants(w));
  }
  const titles = new Map<string, number>();
  for (const t of w.tables.values()) titles.set(t[0]!, (titles.get(t[0]!) ?? 0) + 1);
  return {
    config: {
      clubs: config.clubs,
      seasons: config.seasons,
      seed: config.seed,
      ruleset: config.ruleset.name,
      scenario: config.scenario.name,
      policies: [...new Set([...w.clubs.values()].map((c) => c.policy))],
    },
    seasons,
    failures,
    deals: w.deals,
    events: w.events,
    clubs: [...w.clubs.values()].map((c) => ({
      id: c.id,
      name: c.name,
      policy: c.policy,
      cash: c.cash,
      titles: titles.get(c.id) ?? 0,
    })),
    ms: performance.now() - t0,
  };
}
