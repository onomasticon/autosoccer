import { describe, expect, it } from "vitest";
import { computeStandings, type Result } from "./standings.ts";

const r = (round: number, home: string, away: string, homeGoals: number, awayGoals: number): Result => ({
  round,
  home,
  away,
  homeGoals,
  awayGoals,
});
const order = (rows: { team: string }[]) => rows.map((x) => x.team);

describe("standings", () => {
  it("awards 3/1/0 and tracks W/D/L, goals, GD and form (most recent last)", () => {
    const rows = computeStandings(["a", "b"], [r(1, "a", "b", 2, 1), r(2, "b", "a", 1, 1)]);
    expect(rows[0]).toMatchObject({
      team: "a",
      position: 1,
      played: 2,
      won: 1,
      drawn: 1,
      lost: 0,
      goalsFor: 3,
      goalsAgainst: 2,
      goalDifference: 1,
      points: 4,
      form: ["W", "D"],
    });
    expect(rows[1]).toMatchObject({ team: "b", points: 1, form: ["L", "D"] });
  });

  it("form keeps only the last five results", () => {
    const res = [1, 2, 3, 4, 5, 6].map((i) => r(i, "a", "b", i === 1 ? 0 : 1, 0));
    expect(computeStandings(["a", "b"], res)[0]!.form).toEqual(["W", "W", "W", "W", "W"]);
  });

  it("orders by points, then goal difference, then goals for", () => {
    const rows = computeStandings(
      ["a", "b", "c", "d"],
      [r(1, "a", "c", 3, 0), r(1, "b", "d", 1, 0), r(2, "c", "d", 4, 3)],
    );
    // a: 3pts GD+3, b: 3pts GD+1, c: 3pts GD-2 (GF 4), d: 0
    expect(order(rows)).toEqual(["a", "b", "c", "d"]);
    const gf = computeStandings(["a", "b", "x", "y"], [r(1, "a", "x", 3, 2), r(1, "b", "y", 1, 0)]);
    expect(order(gf).slice(0, 2)).toEqual(["a", "b"]); // both 3pts GD+1, a scored more
  });

  it("breaks a two-way tie on equal points/GD/GF by head-to-head", () => {
    // a beat b 1-0 and lost 0-1 to c; b lost to a and beat d 1-0; c-d drew.
    // a and b: 3 pts, GD 0, GF 1 each ⇒ head-to-head puts a above b.
    const tie = computeStandings(
      ["a", "b", "c", "d"],
      [r(1, "a", "b", 1, 0), r(2, "c", "a", 1, 0), r(3, "b", "d", 1, 0), r(4, "c", "d", 0, 0)],
    );
    const a = tie.find((x) => x.team === "a")!;
    const b = tie.find((x) => x.team === "b")!;
    expect([a.points, a.goalDifference, a.goalsFor]).toEqual([b.points, b.goalDifference, b.goalsFor]);
    expect(order(tie)).toEqual(["c", "a", "b", "d"]);
    // flipping the head-to-head result flips the order
    const flipped = computeStandings(
      ["a", "b", "c", "d"],
      [r(1, "a", "b", 0, 1), r(2, "a", "c", 1, 0), r(3, "d", "b", 1, 0), r(4, "c", "d", 0, 0)],
    );
    expect(order(flipped).indexOf("b")).toBeLessThan(order(flipped).indexOf("a"));
  });

  it("uses a head-to-head mini-table for three-way ties, then name as the last resort", () => {
    // Cycle a>b, b>c, c>a, all 1-0: identical overall and head-to-head ⇒ alphabetical by name.
    const res = [r(1, "a", "b", 1, 0), r(2, "b", "c", 1, 0), r(3, "c", "a", 1, 0)];
    const names: Record<string, string> = { a: "Zeta", b: "Alpha", c: "Mu" };
    expect(order(computeStandings(["a", "b", "c"], res, (t) => names[t]!))).toEqual(["b", "c", "a"]);
  });

  it("ignores results involving teams outside the table and starts everyone at zero", () => {
    const rows = computeStandings(["a", "b"], [r(1, "a", "z", 5, 0)]);
    expect(rows.every((x) => x.played === 0 && x.points === 0)).toBe(true);
  });
});
