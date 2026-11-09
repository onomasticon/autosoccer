import { describe, expect, it } from "vitest";
import { doubleRoundRobin, fixtureSeed, seededOrder } from "./schedule.ts";

describe("double round robin", () => {
  for (const n of [4, 6, 8]) {
    it(`${n} teams: every ordered pairing once, one game per team per round, balanced venues`, () => {
      const teams = Array.from({ length: n }, (_, i) => `t${i}`);
      const fx = doubleRoundRobin(teams);
      expect(fx).toHaveLength(n * (n - 1));
      expect(new Set(fx.map((f) => f.round))).toEqual(new Set(Array.from({ length: 2 * (n - 1) }, (_, i) => i + 1)));
      expect(new Set(fx.map((f) => `${f.home}>${f.away}`)).size).toBe(fx.length);
      for (const f of fx) expect(f.home).not.toBe(f.away);
      for (let r = 1; r <= 2 * (n - 1); r++) {
        const inRound = fx.filter((f) => f.round === r).flatMap((f) => [f.home, f.away]);
        expect(new Set(inRound).size).toBe(n);
      }
      for (const t of teams) {
        const home = fx.filter((f) => f.home === t).length;
        expect(home).toBe(n - 1);
      }
      // the second leg is the first leg with venues swapped
      for (const f of fx.filter((x) => x.round < n)) {
        expect(fx.some((g) => g.round >= n && g.home === f.away && g.away === f.home)).toBe(true);
      }
    });
  }

  it("four teams ⇒ 12 fixtures over 6 rounds, never more than two consecutive home or away games", () => {
    const fx = doubleRoundRobin(["a", "b", "c", "d"]);
    expect(fx).toHaveLength(12);
    for (const t of ["a", "b", "c", "d"]) {
      const venues = fx
        .filter((f) => f.home === t || f.away === t)
        .sort((x, y) => x.round - y.round)
        .map((f) => (f.home === t ? "H" : "A"));
      expect(venues.join("")).not.toMatch(/HHH|AAA/);
    }
  });

  it("rejects odd or duplicate team lists", () => {
    expect(() => doubleRoundRobin(["a", "b", "c"])).toThrow();
    expect(() => doubleRoundRobin(["a", "a"])).toThrow();
  });

  it("derives stable, distinct uint32 fixture seeds and a seeded team order", () => {
    expect(fixtureSeed(1, 1, "a", "b")).toBe(fixtureSeed(1, 1, "a", "b"));
    expect(fixtureSeed(1, 1, "a", "b")).not.toBe(fixtureSeed(1, 1, "b", "a"));
    expect(fixtureSeed(2, 1, "a", "b")).not.toBe(fixtureSeed(1, 1, "a", "b"));
    const s = fixtureSeed(9, 3, "x", "y");
    expect(Number.isInteger(s) && s >= 0 && s <= 0xffffffff).toBe(true);
    const teams = ["a", "b", "c", "d"].map((slug) => ({ slug }));
    expect(seededOrder(teams, 5)).toEqual(seededOrder([...teams].reverse(), 5));
  });
});
