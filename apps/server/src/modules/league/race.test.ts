import { describe, expect, it } from "vitest";
import { titleRace } from "./race.ts";

const rows = (...pts: number[]) => pts.map((points, i) => ({ teamId: `t${i + 1}`, points }));
const left = (n: number, teams = 4) => new Map(Array.from({ length: teams }, (_, i) => [`t${i + 1}`, n]));

describe("title race", () => {
  it("keeps every club in it while they can still reach the leader's points", () => {
    expect(titleRace({ rows: rows(9, 7, 4, 3), remaining: left(2) })).toEqual({
      contenders: ["t1", "t2", "t3", "t4"],
      clinched: null,
    });
    expect(titleRace({ rows: rows(10, 7, 4, 3), remaining: left(2) }).contenders).toEqual(["t1", "t2", "t3"]);
  });

  it("is clinched once nobody can reach the leader (Season 5: 13 vs at most 10 with a round left)", () => {
    expect(titleRace({ rows: rows(13, 7, 6, 3), remaining: left(1) })).toEqual({ contenders: ["t1"], clinched: "t1" });
  });

  it("isn't clinched while a rival can draw level on points (tie-breaks could still go either way)", () => {
    expect(titleRace({ rows: rows(13, 10, 6, 3), remaining: left(1) }).clinched).toBeNull();
  });

  it("is settled by the table at the end of the season, even level on points", () => {
    expect(titleRace({ rows: rows(10, 10, 6, 3), remaining: left(0) })).toEqual({ contenders: ["t1"], clinched: "t1" });
  });
});
