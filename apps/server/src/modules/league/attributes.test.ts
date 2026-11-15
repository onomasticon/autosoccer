import { ATTRIBUTE_NAMES, PlayerAttributes } from "@autosoccer/contracts";
import { describe, expect, it } from "vitest";
import { overallRating, playerAttributes } from "./attributes.ts";
import { SEED_TEAMS } from "./seed-data.ts";

const rate = (p: (typeof SEED_TEAMS)[number]["players"][number]) =>
  playerAttributes({ name: p.name, shirtNumber: p.number, position: p.position });

describe("player ratings", () => {
  it("are fixed per player, valid 1–99 attributes, and in the 25–95 band", () => {
    const p = SEED_TEAMS[1]!.players[6]!;
    expect(rate(p)).toEqual(rate(p));
    for (const t of SEED_TEAMS)
      for (const q of t.players) {
        const a = rate(q);
        expect(PlayerAttributes.safeParse(a).success).toBe(true);
        for (const n of ATTRIBUTE_NAMES) expect(a[n]).toBeGreaterThanOrEqual(25);
        for (const n of ATTRIBUTE_NAMES) expect(a[n]).toBeLessThanOrEqual(95);
      }
  });

  it("follow the position: keepers keep goal, defenders tackle, forwards shoot", () => {
    const all = SEED_TEAMS.flatMap((t) => t.players.map((p) => ({ p, a: rate(p) })));
    const avg = (pos: string, n: (typeof ATTRIBUTE_NAMES)[number]) => {
      const xs = all.filter((x) => x.p.position === pos).map((x) => x.a[n]);
      return xs.reduce((s, x) => s + x, 0) / xs.length;
    };
    expect(avg("GK", "goalkeeping")).toBeGreaterThan(avg("DF", "goalkeeping") + 30);
    expect(avg("DF", "tackling")).toBeGreaterThan(avg("FW", "tackling") + 20);
    expect(avg("FW", "shooting")).toBeGreaterThan(avg("DF", "shooting") + 20);
    expect(avg("MF", "passing")).toBeGreaterThan(avg("FW", "passing") + 5);
  });

  it("leave the four founding clubs evenly matched", () => {
    const xi = SEED_TEAMS.map((t) => {
      const o = t.players.slice(0, 11).map((p) => overallRating(rate(p), p.position));
      return o.reduce((s, x) => s + x, 0) / o.length;
    });
    expect(Math.max(...xi) - Math.min(...xi)).toBeLessThan(1);
  });
});
