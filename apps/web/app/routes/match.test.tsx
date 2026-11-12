import type { OfficialEvent } from "@autosoccer/contracts";
import { describe, expect, it } from "vitest";
import { scorerLines } from "./match";

const goal = (
  side: "home" | "away",
  scorerId: string,
  period: "firstHalf" | "secondHalf",
  clockSec: number,
  ownGoal = false,
): OfficialEvent => ({ type: "goal", tick: 0, period, clockSec, side, scorerId, ownGoal, score: { home: 0, away: 0 } });

describe("scorers under the score", () => {
  const names = new Map([
    ["p1", "Tove Nyberg"],
    ["p2", "Yusuf Demir"],
    ["p3", "Bruno Lind"],
  ]);
  it("groups a player's goals in order and marks own goals", () => {
    const events = [
      goal("away", "p2", "firstHalf", 90),
      goal("away", "p1", "secondHalf", 7),
      goal("away", "p1", "secondHalf", 26),
      goal("away", "p3", "secondHalf", 80, true),
    ];
    expect(scorerLines(events, "away", names)).toEqual([
      "Yusuf Demir 1H 1:30",
      "Tove Nyberg 2H 0:07, 2H 0:26",
      "Bruno Lind (own goal) 2H 1:20",
    ]);
    expect(scorerLines(events, "home", names)).toEqual([]);
  });
});
