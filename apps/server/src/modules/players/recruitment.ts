/**
 * The shared inaugural talent pool and recruitment market (#96, recruit/1).
 *
 * Pool: a deterministic, seeded set of unattached players with stable ids, names, ages, attributes
 * (the production attribute model), a potential, and bounded preferences (the least wage they'll
 * accept, the contract length they want, how much they want to play). No per-player model calls.
 * Every club sees the same pool (equal scouting access); nobody starts with a squad.
 *
 * Market: simultaneous offer rounds. In each round every club submits offers before a deadline;
 * answers after the deadline are ignored, so a faster model gains nothing. Offers reserve budget
 * when submitted (a club can't promise more than it has). Then each player, in a fixed seeded
 * order, signs the offer that suits them best among those that meet their terms, from a club that
 * still has room and money; ties go to the earlier club in a seeded order, never to the first to
 * answer. Signing is atomic: registration, contract and payment together.
 *
 * Safety net: after the last round, a club short of a viable squad (the minimum, with a keeper)
 * is assigned the best remaining unattached players at minimum terms plus a stated fee per player.
 * It's recorded as such; squads are never silently made equal.
 */
import { createHash } from "node:crypto";
import type { PlayerAttributes, Position } from "@autosoccer/contracts";
import { overallRating, playerAttributes } from "../league/attributes.ts";

export const RECRUIT_RULE = "recruit/1";

export const RECRUIT = {
  version: RECRUIT_RULE,
  /** Players per club the pool is sized for, by position (7-a-side, 14-player squads). */
  perClub: { GK: 2, DF: 4, MF: 4, FW: 4 } as Record<Position, number>,
  /** Pool surplus over what the clubs need, so the last clubs still have real choices. */
  surplus: 1.6,
  squad: { min: 9, max: 16, keepers: 1 },
  ages: { min: 17, max: 33 },
  /** Lowest wage anyone accepts, per season (whole credits). */
  minWage: 150_000,
  /** A player's asking wage per season: base + perPoint × (overall − 45). */
  asking: { base: 150_000, perPoint: 18_000 },
  contractYears: { min: 1, max: 4 },
  /** Safety-net fee per assigned player, on top of minimum terms. */
  safetyNetFee: 250_000,
  rounds: 3,
} as const;

export interface PoolPlayer {
  id: string;
  name: string;
  position: Position;
  age: number;
  attributes: PlayerAttributes;
  overall: number;
  /** Expected peak, from age (hidden from no one: every club sees the same scouting report). */
  potential: number;
  prefs: {
    /** Least wage per season they'll sign for. */
    minWage: number;
    /** Contract length they prefer (years). */
    years: number;
    /** 0 (any role) to 1 (must start). */
    playingTime: number;
  };
}

const FIRST = [
  "Ada",
  "Bram",
  "Cleo",
  "Dario",
  "Esme",
  "Femi",
  "Greta",
  "Hugo",
  "Ines",
  "Joss",
  "Kaia",
  "Lior",
  "Mira",
  "Nils",
  "Odin",
  "Pia",
  "Quin",
  "Rosa",
  "Sami",
  "Tove",
  "Uma",
  "Vik",
  "Wren",
  "Yara",
  "Zeno",
];
const LAST = [
  "Abara",
  "Brandt",
  "Castell",
  "Dorsey",
  "Ekwueme",
  "Falk",
  "Grieve",
  "Halloran",
  "Ishii",
  "Janssen",
  "Kovac",
  "Lindqvist",
  "Moreau",
  "Novak",
  "Okafor",
  "Petrova",
  "Quigley",
  "Rasku",
  "Sorensen",
  "Tanaka",
  "Ueda",
  "Varga",
  "Whitlock",
  "Yilmaz",
  "Zielinski",
];

const bytes = (s: string) => createHash("sha256").update(s).digest();
const uuidFrom = (s: string) => {
  const h = createHash("md5").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** The pool for a league of `clubs`, from a seed. Same seed, same pool. */
export function generatePool(seed: number, clubs: number): PoolPlayer[] {
  const out: PoolPlayer[] = [];
  const names = new Set<string>();
  let n = 0;
  for (const pos of ["GK", "DF", "MF", "FW"] as Position[]) {
    const count = Math.ceil(RECRUIT.perClub[pos] * clubs * RECRUIT.surplus);
    for (let i = 0; i < count; i++, n++) {
      const k = bytes(`recruit:${seed}:${n}`);
      let name = `${FIRST[k[0]! % FIRST.length]} ${LAST[k[1]! % LAST.length]}`;
      // Walk every first × last combination once; past that, add a middle initial (always terminates).
      for (let j = 1; names.has(name); j++)
        name =
          j < FIRST.length * LAST.length
            ? `${FIRST[(k[0]! + j) % FIRST.length]} ${LAST[(k[1]! + Math.floor(j / FIRST.length)) % LAST.length]}`
            : `${FIRST[k[0]! % FIRST.length]} ${String.fromCharCode(65 + (j % 26))}. ${LAST[(k[1]! + j) % LAST.length]}`;
      names.add(name);
      const attributes = playerAttributes({ name, shirtNumber: 1 + (n % 99), position: pos }, `recruit-${seed}`);
      const overall = overallRating(attributes, pos);
      const age = RECRUIT.ages.min + (k[2]! % (RECRUIT.ages.max - RECRUIT.ages.min + 1));
      const growth = age <= 20 ? 8 : age <= 23 ? 5 : age <= 26 ? 2 : 0;
      const ask = RECRUIT.asking.base + RECRUIT.asking.perPoint * Math.max(0, overall - 45);
      out.push({
        id: uuidFrom(`recruit:${seed}:${n}`),
        name,
        position: pos,
        age,
        attributes,
        overall,
        potential: Math.min(90, overall + growth + (k[3]! % 4)),
        prefs: {
          minWage: Math.max(RECRUIT.minWage, Math.round((ask * (0.85 + (k[4]! % 31) / 100)) / 10_000) * 10_000),
          years: age >= 30 ? 1 + (k[5]! % 2) : 2 + (k[5]! % 3),
          playingTime: Math.round(((overall - 50) / 40 + (k[6]! % 21) / 100) * 100) / 100,
        },
      });
    }
  }
  return out;
}

export interface Offer {
  club: string;
  player: string;
  /** Wage per season. */
  wage: number;
  /** One-off signing bonus. */
  bonus: number;
  years: number;
  submittedAt: Date;
}

export interface ClubState {
  id: string;
  budget: number;
  squad: string[];
}

export interface Signing {
  round: number;
  club: string;
  player: string;
  wage: number;
  bonus: number;
  years: number;
  /** offer: signed in the market; safety-net: assigned after the deadline at stated cost. */
  via: "offer" | "safety-net";
}

export interface OfferOutcome {
  offer: Offer;
  outcome: "signed" | "late" | "over-budget" | "below-terms" | "outbid" | "no-room" | "invalid";
}

export interface RoundResult {
  round: number;
  signings: Signing[];
  outcomes: OfferOutcome[];
}

/** First-season cost of an offer (what it reserves): one season's wage plus the bonus. */
export const commitment = (o: Pick<Offer, "wage" | "bonus">) => o.wage + o.bonus;

/** How much a player likes an offer (only offers meeting their terms are compared). */
export function appeal(p: PoolPlayer, o: Offer, startsAt: (club: string) => boolean): number {
  const money = (o.wage * Math.min(o.years, p.prefs.years) + o.bonus) / Math.max(1, p.prefs.minWage);
  const term = 1 - Math.abs(o.years - p.prefs.years) * 0.1;
  const role = startsAt(o.club) ? 1 : 1 - p.prefs.playingTime * 0.5;
  return money * term * role;
}

const order = (seed: number, round: number, id: string) =>
  createHash("sha256").update(`recruit-order:${seed}:${round}:${id}`).digest("hex");

/**
 * Settles one offer round. Pure: returns what happened; `clubs` and `pool` membership are updated in
 * place to reflect signings (the caller persists them atomically).
 */
export function settleRound(
  seed: number,
  round: number,
  deadline: Date,
  pool: Map<string, PoolPlayer & { club: string | null }>,
  clubs: Map<string, ClubState>,
  offers: Offer[],
): RoundResult {
  const outcomes: OfferOutcome[] = [];
  const reserved = new Map<string, number>();
  const valid: Offer[] = [];
  // Submission: late answers are ignored; each offer reserves budget in the club's own order.
  for (const o of [...offers].sort((a, b) => a.club.localeCompare(b.club))) {
    const p = pool.get(o.player);
    const c = clubs.get(o.club);
    if (
      !p ||
      !c ||
      p.club ||
      o.wage < 0 ||
      o.bonus < 0 ||
      o.years < RECRUIT.contractYears.min ||
      o.years > RECRUIT.contractYears.max
    ) {
      outcomes.push({ offer: o, outcome: "invalid" });
      continue;
    }
    if (o.submittedAt.getTime() > deadline.getTime()) {
      outcomes.push({ offer: o, outcome: "late" });
      continue;
    }
    const r = (reserved.get(o.club) ?? 0) + commitment(o);
    if (r > c.budget) {
      outcomes.push({ offer: o, outcome: "over-budget" });
      continue;
    }
    reserved.set(o.club, r);
    valid.push(o);
  }
  const byPlayer = new Map<string, Offer[]>();
  for (const o of valid) byPlayer.set(o.player, [...(byPlayer.get(o.player) ?? []), o]);
  const players = [...byPlayer.keys()].sort((a, b) => order(seed, round, a).localeCompare(order(seed, round, b)));
  const signings: Signing[] = [];
  const depth = (club: string, pos: Position) =>
    clubs
      .get(club)!
      .squad.filter((id) => pool.get(id)?.position === pos)
      .map((id) => pool.get(id)!.overall);
  for (const id of players) {
    const p = pool.get(id)!;
    const startsAt = (club: string) => {
      const d = depth(club, p.position).sort((a, b) => b - a);
      const spots = p.position === "GK" ? 1 : 2;
      return d.length < spots || p.overall > (d[spots - 1] ?? 0);
    };
    const candidates = byPlayer.get(id)!.filter((o) => {
      if (o.wage < p.prefs.minWage) {
        outcomes.push({ offer: o, outcome: "below-terms" });
        return false;
      }
      return true;
    });
    candidates.sort(
      (a, b) =>
        appeal(p, b, startsAt) - appeal(p, a, startsAt) ||
        order(seed, round, a.club).localeCompare(order(seed, round, b.club)),
    );
    let signed = false;
    for (const o of candidates) {
      const c = clubs.get(o.club)!;
      if (signed) {
        outcomes.push({ offer: o, outcome: "outbid" });
        continue;
      }
      if (c.squad.length >= RECRUIT.squad.max) {
        outcomes.push({ offer: o, outcome: "no-room" });
        continue;
      }
      c.budget -= commitment(o);
      c.squad.push(p.id);
      p.club = c.id;
      signed = true;
      signings.push({ round, club: c.id, player: p.id, wage: o.wage, bonus: o.bonus, years: o.years, via: "offer" });
      outcomes.push({ offer: o, outcome: "signed" });
    }
  }
  return { round, signings, outcomes };
}

/** Whether a squad can take the field and meets the minimum. */
export function viable(c: ClubState, pool: Map<string, PoolPlayer>): boolean {
  const keepers = c.squad.filter((id) => pool.get(id)?.position === "GK").length;
  return c.squad.length >= RECRUIT.squad.min && keepers >= RECRUIT.squad.keepers;
}

/**
 * The deadline safety net: each short club, in seeded order, is assigned the best remaining
 * players it needs (a keeper first) at the player's minimum wage, shortest term, plus the stated
 * fee. Charged to the club even if that takes it below zero: the debt is visible (finance rules
 * decide what follows).
 */
export function safetyNet(
  seed: number,
  pool: Map<string, PoolPlayer & { club: string | null }>,
  clubs: Map<string, ClubState>,
): Signing[] {
  const out: Signing[] = [];
  const ids = [...clubs.keys()].sort((a, b) => order(seed, 0, a).localeCompare(order(seed, 0, b)));
  const free = () =>
    [...pool.values()].filter((p) => !p.club).sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id));
  for (const id of ids) {
    const c = clubs.get(id)!;
    while (!viable(c, pool)) {
      const keepers = c.squad.filter((x) => pool.get(x)?.position === "GK").length;
      const p = free().find((x) => (keepers < RECRUIT.squad.keepers ? x.position === "GK" : true));
      if (!p) break;
      c.budget -= p.prefs.minWage + RECRUIT.safetyNetFee;
      c.squad.push(p.id);
      p.club = c.id;
      out.push({
        round: 0,
        club: c.id,
        player: p.id,
        wage: p.prefs.minWage,
        bonus: RECRUIT.safetyNetFee,
        years: RECRUIT.contractYears.min,
        via: "safety-net",
      });
    }
  }
  return out;
}
