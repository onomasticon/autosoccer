import type { OfficialEvent } from "@autosoccer/contracts";
import { describe, expect, it } from "vitest";
import { buildHighlights, CATCH_MIN_SPEED, clipReel, reelNext } from "./highlights";

describe("clipReel", () => {
  it("windows each goal with build-up, merges close goals and drops out-of-match ticks", () => {
    const r = clipReel([600, 9_999_999, 3000, 3300], { finalTick: 10_000, tickRate: 60 });
    expect(r).toEqual([
      { start: 180, end: 780 },
      { start: 2580, end: 3480 },
    ]);
    expect(clipReel([], { finalTick: 10, tickRate: 60 })).toEqual([]);
  });
});

const R = 60;
const period = (tick: number, type: "periodStart" | "periodEnd", p: "firstHalf" | "secondHalf"): OfficialEvent => ({
  type,
  tick,
  period: p,
  clockSec: 0,
});
const goal = (
  tick: number,
  side: "home" | "away",
  over: Partial<OfficialEvent & { type: "goal" }> = {},
): OfficialEvent => ({
  type: "goal",
  tick,
  period: "firstHalf",
  clockSec: tick / R,
  side,
  scorerId: "00000000-0000-4000-8000-000000000001",
  ownGoal: false,
  score: { home: side === "home" ? 1 : 0, away: side === "away" ? 1 : 0 },
  ...over,
});
const flow = [
  period(0, "periodStart", "firstHalf"),
  period(9000, "periodEnd", "firstHalf"),
  period(9100, "periodStart", "secondHalf"),
  period(18100, "periodEnd", "secondHalf"),
];
const log = (...e: Array<[number, Record<string, unknown>]>) =>
  e.map(([tick, event]) => ({ tick, event: event as { type: string } }));

describe("highlights index", () => {
  it("a goalless match has no goal moments but keeps its chapters and fast keeper catches", () => {
    const h = buildHighlights(flow, {
      finalTick: 18100,
      tickRate: R,
      events: log(
        [3000, { type: "catch", playerId: "red-1", success: true, incomingSpeed: CATCH_MIN_SPEED + 3 }],
        [4000, { type: "catch", playerId: "blue-1", success: true, incomingSpeed: 4 }], // a soft back-pass: not a moment
        [5000, { type: "catch", playerId: "blue-1", success: false, incomingSpeed: 20 }], // a fumble isn't a catch
      ),
    });
    expect(h.moments).toEqual([expect.objectContaining({ kind: "catch", tick: 3000, side: "away" })]);
    expect(h.chapters.map((c) => c.label)).toEqual(["Kick-off", "Half-time", "Second half", "Full time"]);
    expect(h.notes).toEqual([]);
  });

  it("indexes every goal the replay confirms, own goals and unknown scorers included", () => {
    const events = [
      ...flow,
      goal(1200, "home"),
      goal(9500, "away", { ownGoal: true, score: { home: 1, away: 1 } }),
      goal(15000, "home", { scorerId: null, score: { home: 2, away: 1 } }),
    ];
    const h = buildHighlights(events, {
      finalTick: 18100,
      tickRate: R,
      events: log([1200, { type: "goalScored" }], [9500, { type: "goalScored" }], [15000, { type: "goalScored" }]),
    });
    expect(h.moments.map((m) => [m.kind, m.tick, m.side, m.goal?.ownGoal, m.goal?.scorerId ?? null])).toEqual([
      ["goal", 1200, "home", false, "00000000-0000-4000-8000-000000000001"],
      ["goal", 9500, "away", true, "00000000-0000-4000-8000-000000000001"],
      ["goal", 15000, "home", false, null],
    ]);
    // Windows: 7 s before, 3 s after, clamped to the match.
    expect(h.moments[0]).toMatchObject({ start: 1200 - 7 * R, end: 1200 + 3 * R });
  });

  it("leaves out goals the replay doesn't confirm or that sit outside the match, and says so", () => {
    const h = buildHighlights(
      [...flow, goal(1200, "home"), goal(2400, "away"), goal(99999, "home"), goal(Number.NaN, "home")],
      {
        finalTick: 18100,
        tickRate: R,
        events: log([1200, { type: "goalScored" }]),
      },
    );
    expect(h.moments.map((m) => m.tick)).toEqual([1200]);
    expect(h.notes).toHaveLength(3);
    expect(h.notes.join(" ")).toMatch(/isn't in this replay's own event log/);
  });

  it("without a replay event log, still indexes official goals (it can't cross-check them)", () => {
    const h = buildHighlights([...flow, goal(30, "home")], { finalTick: 18100, tickRate: R });
    expect(h.moments).toEqual([expect.objectContaining({ kind: "goal", tick: 30, start: 0 })]);
  });

  it("merges overlapping windows into one reel, and steps through it", () => {
    const h = buildHighlights([...flow, goal(1200, "home"), goal(1500, "away")], {
      finalTick: 18100,
      tickRate: R,
      events: log(
        [1200, { type: "goalScored" }],
        [1500, { type: "goalScored" }],
        [6000, { type: "catch", playerId: "red-1", success: true, incomingSpeed: 15 }],
      ),
    });
    expect(h.reel).toEqual([
      { start: 1200 - 420, end: 1500 + 180 },
      { start: 6000 - 240, end: 6000 + 120 },
    ]);
    expect(reelNext(h.reel, 0)).toBe(780);
    expect(reelNext(h.reel, 1000)).toBe(1000);
    expect(reelNext(h.reel, 1700)).toBe(5760);
    expect(reelNext(h.reel, 6200)).toBeNull();
  });
});
