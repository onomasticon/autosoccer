import type { OfficialEvent } from "@autosoccer/contracts";

export type GoalEvent = Extract<OfficialEvent, { type: "goal" }>;

/** Real seconds a goal celebration lasts, whatever the playback speed. */
export const CELEBRATION_SECONDS = 2.6;

/**
 * How many match ticks the celebration plays through: most of the engine's own goal pause
 * (the ball sits in the net), stopping before players are reset for the kickoff.
 */
export function celebrationTicks(goalPauseTicks: number | undefined, tickRate: number): number {
  const pause = goalPauseTicks ?? 2 * tickRate;
  return Math.max(1, Math.round(pause * 0.75));
}

/** The first goal whose tick playback passes when it moves from `prev` (exclusive) to `next` (inclusive). */
export function goalCrossed(goals: readonly GoalEvent[], prev: number, next: number): GoalEvent | null {
  let first: GoalEvent | null = null;
  for (const g of goals) if (g.tick > prev && g.tick <= next && (!first || g.tick < first.tick)) first = g;
  return first;
}

/** Ticks per real second while celebrating, so `span` ticks last CELEBRATION_SECONDS. */
export const celebrationRate = (span: number) => span / CELEBRATION_SECONDS;
