import { describe, expect, it } from "vitest";
import { CELEBRATION_SECONDS, celebrationRate, celebrationTicks, type GoalEvent, goalCrossed } from "./celebration";

const goal = (tick: number): GoalEvent => ({
  type: "goal",
  tick,
  period: "firstHalf",
  clockSec: tick / 60,
  side: "home",
  scorerId: null,
  ownGoal: false,
  score: { home: 1, away: 0 },
});

describe("goal celebration", () => {
  const goals = [goal(600), goal(1200)];

  it("fires on the frame step that passes a goal, once", () => {
    expect(goalCrossed(goals, 590, 600)?.tick).toBe(600);
    expect(goalCrossed(goals, 599, 640)?.tick).toBe(600);
    expect(goalCrossed(goals, 600, 640)).toBeNull(); // already at the goal: no second celebration
    expect(goalCrossed(goals, 0, 590)).toBeNull();
  });

  it("picks the earliest goal when a fast step passes two", () => {
    expect(goalCrossed([goal(1200), goal(600)], 0, 5000)?.tick).toBe(600);
  });

  it("plays most of the engine's goal pause, at the same real length whatever the speed", () => {
    expect(celebrationTicks(120, 60)).toBe(90);
    expect(celebrationTicks(undefined, 60)).toBe(90);
    expect(celebrationTicks(0, 60)).toBe(1);
    expect(celebrationTicks(120, 60) / celebrationRate(celebrationTicks(120, 60))).toBeCloseTo(CELEBRATION_SECONDS);
  });
});
