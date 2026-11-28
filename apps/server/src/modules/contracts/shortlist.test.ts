import { describe, expect, it } from "vitest";
import { FREE_AGENT_SHORTLIST, minWage, shortlist } from "./service.ts";

const pool = ["GK", "DF", "MF", "FW"].flatMap((position) =>
  Array.from({ length: 60 }, (_, i) => ({
    id: `${position}-${String(i).padStart(2, "0")}`,
    position,
    overall: 40 + i,
  })),
);

describe("the free-agent shortlist", () => {
  it("shows every club the best at each position and the cheapest of the rest, not the whole pool", () => {
    const list = shortlist(pool, 38);
    const per = FREE_AGENT_SHORTLIST.bestPerPosition + FREE_AGENT_SHORTLIST.cheapestPerPosition;
    expect(list).toHaveLength(4 * per);
    for (const pos of ["GK", "DF", "MF", "FW"]) {
      const at = list.filter((p) => p.position === pos).map((p) => p.overall);
      // The ten best (99 down to 90), then the five cheapest of the rest (the lowest ratings).
      expect(at.slice(0, 10)).toEqual([99, 98, 97, 96, 95, 94, 93, 92, 91, 90]);
      expect(at.slice(10)).toEqual([40, 41, 42, 43, 44]);
    }
    expect(minWage(40, 38)).toBeLessThan(minWage(99, 38));
  });

  it("is the same list whatever order the pool comes in", () => {
    expect(shortlist([...pool].reverse(), 38)).toEqual(shortlist(pool, 38));
  });

  it("shows a small pool in full", () => {
    expect(shortlist(pool.slice(0, 7), 38)).toHaveLength(7);
  });
});
