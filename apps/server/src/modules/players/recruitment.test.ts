import { describe, expect, it } from "vitest";
import {
  type ClubState,
  generatePool,
  type Offer,
  type PoolPlayer,
  RECRUIT,
  safetyNet,
  settleRound,
  viable,
} from "./recruitment.ts";

const DEADLINE = new Date("2027-04-01T12:00:00Z");
const ON_TIME = new Date("2027-04-01T11:00:00Z");
type Pool = Map<string, PoolPlayer & { club: string | null }>;

const poolOf = (seed = 1, clubs = 20): Pool =>
  new Map(generatePool(seed, clubs).map((p) => [p.id, { ...p, club: null }]));
const clubsOf = (n = 20, budget = 6_000_000) =>
  new Map<string, ClubState>(Array.from({ length: n }, (_, i) => [`c${i}`, { id: `c${i}`, budget, squad: [] }]));

/** A simple offline recruiter: offers each needed position's best affordable players at their terms (+ a margin). */
function offersFor(c: ClubState, pool: Pool, margin: number): Offer[] {
  const need = Object.entries(RECRUIT.perClub).flatMap(([pos, n]) => {
    const have = c.squad.filter((id) => pool.get(id)!.position === pos).length;
    return Array.from({ length: Math.max(0, n - have) }, () => pos);
  });
  const out: Offer[] = [];
  let left = c.budget;
  const taken = new Set<string>();
  for (const pos of need) {
    const p = [...pool.values()]
      .filter((x) => !x.club && x.position === pos && !taken.has(x.id) && x.prefs.minWage * (1 + margin) <= left / 2)
      .sort((a, b) => b.overall - a.overall)[Number(c.id.slice(1)) % 3];
    if (!p) continue;
    const wage = Math.round(p.prefs.minWage * (1 + margin));
    out.push({ club: c.id, player: p.id, wage, bonus: 0, years: p.prefs.years, submittedAt: ON_TIME });
    taken.add(p.id);
    left -= wage;
  }
  return out;
}

describe("recruit/1 pool", () => {
  it("is deterministic, with stable ids and unique names, and a surplus at every position", () => {
    const a = generatePool(7, 20);
    expect(generatePool(7, 20)).toEqual(a);
    expect(generatePool(8, 20)).not.toEqual(a);
    expect(new Set(a.map((p) => p.id)).size).toBe(a.length);
    expect(new Set(a.map((p) => p.name)).size).toBe(a.length);
    for (const [pos, n] of Object.entries(RECRUIT.perClub))
      expect(a.filter((p) => p.position === pos).length).toBeGreaterThan(n * 20);
    for (const p of a) {
      expect(p.age).toBeGreaterThanOrEqual(17);
      expect(p.age).toBeLessThanOrEqual(33);
      expect(p.prefs.minWage).toBeGreaterThanOrEqual(RECRUIT.minWage);
    }
    expect(new Set(a.map((p) => p.overall)).size).toBeGreaterThan(15); // variety
  });
});

describe("recruit/1 market", () => {
  it("settles competing offers by the player's preference, ties by a seeded order, not by who answered first", () => {
    const pool = poolOf();
    const p = [...pool.values()].find((x) => x.position === "FW")!;
    const offer = (club: string, wage: number, at: string): Offer => ({
      club,
      player: p.id,
      wage,
      bonus: 0,
      years: p.prefs.years,
      submittedAt: new Date(at),
    });
    const tie = (first: string, second: string) => {
      const pl = poolOf();
      const clubs = clubsOf(3);
      const r = settleRound(1, 1, DEADLINE, pl, clubs, [
        offer(first, p.prefs.minWage, "2027-04-01T09:00:00Z"),
        offer(second, p.prefs.minWage, "2027-04-01T10:00:00Z"),
      ]);
      return r.signings[0]!.club;
    };
    expect(tie("c0", "c1")).toBe(tie("c1", "c0")); // answering first doesn't win a tie
    const clubs = clubsOf(3);
    const r = settleRound(1, 1, DEADLINE, pool, clubs, [
      offer("c0", p.prefs.minWage, "2027-04-01T09:00:00Z"),
      offer("c1", p.prefs.minWage * 2, "2027-04-01T10:00:00Z"),
      offer("c2", p.prefs.minWage - 10_000, "2027-04-01T08:00:00Z"),
    ]);
    expect(r.signings).toEqual([expect.objectContaining({ club: "c1", player: p.id })]);
    expect(r.outcomes.map((o) => [o.offer.club, o.outcome]).sort()).toEqual([
      ["c0", "outbid"],
      ["c1", "signed"],
      ["c2", "below-terms"],
    ]);
  });

  it("ignores late answers, refuses offers beyond the club's budget, and never over-fills a squad", () => {
    const pool = poolOf();
    const ps = [...pool.values()].filter((x) => x.position === "MF").slice(0, 3);
    const clubs = clubsOf(2, ps[0]!.prefs.minWage + ps[1]!.prefs.minWage);
    const r = settleRound(1, 1, DEADLINE, pool, clubs, [
      { club: "c0", player: ps[0]!.id, wage: ps[0]!.prefs.minWage, bonus: 0, years: 2, submittedAt: ON_TIME },
      { club: "c0", player: ps[1]!.id, wage: ps[1]!.prefs.minWage, bonus: 0, years: 2, submittedAt: ON_TIME },
      { club: "c0", player: ps[2]!.id, wage: ps[2]!.prefs.minWage, bonus: 0, years: 2, submittedAt: ON_TIME },
      {
        club: "c1",
        player: ps[2]!.id,
        wage: ps[2]!.prefs.minWage * 3,
        bonus: 0,
        years: 2,
        submittedAt: new Date("2027-04-01T12:00:01Z"),
      },
    ]);
    const by = Object.fromEntries(r.outcomes.map((o) => [`${o.offer.club}:${o.offer.player}`, o.outcome]));
    expect(by[`c0:${ps[2]!.id}`]).toBe("over-budget");
    expect(by[`c1:${ps[2]!.id}`]).toBe("late");
    expect(clubs.get("c0")!.budget).toBe(0);
    const full = clubsOf(1);
    full.get("c0")!.squad = Array.from({ length: RECRUIT.squad.max }, (_, i) => `x${i}`);
    const r2 = settleRound(1, 2, DEADLINE, poolOf(), full, [
      { club: "c0", player: ps[0]!.id, wage: ps[0]!.prefs.minWage, bonus: 0, years: 2, submittedAt: ON_TIME },
    ]);
    expect(r2.outcomes[0]!.outcome).toBe("no-room");
  });

  it("gives 20 clubs complete, viable squads from the shared pool, conserving every player and credit", () => {
    const pool = poolOf(3);
    const clubs = clubsOf();
    const start = [...clubs.values()].reduce((s, c) => s + c.budget, 0);
    let paid = 0;
    for (let round = 1; round <= RECRUIT.rounds; round++) {
      const offers = [...clubs.values()].flatMap((c) => offersFor(c, pool, 0.1 * round));
      for (const s of settleRound(3, round, DEADLINE, pool, clubs, offers).signings) paid += s.wage + s.bonus;
    }
    for (const s of safetyNet(3, pool, clubs)) paid += s.wage + s.bonus;
    for (const c of clubs.values()) expect(viable(c, pool), c.id).toBe(true);
    const signed = [...clubs.values()].flatMap((c) => c.squad);
    expect(new Set(signed).size).toBe(signed.length); // nobody registered twice
    for (const id of signed) expect(clubs.get(pool.get(id)!.club!)!.squad).toContain(id);
    expect(start - [...clubs.values()].reduce((s, c) => s + c.budget, 0)).toBe(paid);
  });

  it("the safety net is explicit and costed, and can't conjure a keeper that doesn't exist", () => {
    const pool = poolOf(4, 2);
    for (const p of pool.values()) if (p.position === "GK") pool.delete(p.id);
    const clubs = clubsOf(2);
    const net = safetyNet(4, pool, clubs);
    expect(net.every((s) => s.via === "safety-net" && s.bonus === RECRUIT.safetyNetFee)).toBe(true);
    expect(viable(clubs.get("c0")!, pool)).toBe(false); // a keeper shortage is reported, not hidden
  });
});
