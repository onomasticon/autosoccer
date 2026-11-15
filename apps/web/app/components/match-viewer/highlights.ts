/**
 * Deterministic highlights index for one official match. Every entry points at a tick that the
 * verified replay actually records; nothing is reconstructed or stitched together. "Watch
 * highlights" plays windows of the same replay around these ticks.
 *
 * Sources, in order of authority:
 *  - goals: the official match events (scorer, own goal, score), each confirmed against the
 *    replay's own goal event at the same tick. A goal the replay doesn't confirm is left out and
 *    reported, never guessed at.
 *  - keeper catches: the replay's recorded `catch` events where the keeper held a fast ball
 *    (≥ CATCH_MIN_SPEED m/s). Labelled for what they are ("keeper catch"), not as saves: the
 *    record doesn't say whether the ball was on target.
 *  - chapters: official period starts and ends (kick-off, half-time, second half, full time).
 */
import type { OfficialEvent } from "@autosoccer/contracts";

/** Minimum incoming ball speed (m/s) for a keeper catch to count as a key moment. */
export const CATCH_MIN_SPEED = 11;
/** Seconds of play shown before and after each moment in highlights mode. */
export const WINDOW = { goal: { before: 7, after: 3 }, catch: { before: 4, after: 2 } } as const;

type Goal = Extract<OfficialEvent, { type: "goal" }>;

/** The parts of a replay file this needs (ReplayFile has them; old or partial files may not). */
export interface ReplayLog {
  finalTick: number;
  tickRate: number;
  events?: ReadonlyArray<{ tick: number; event: { type: string; [k: string]: unknown } }>;
  /** Sim player id → team ("blue" is home). */
  teamOf?: (simId: string) => "home" | "away" | null;
}

export interface Moment {
  kind: "goal" | "catch";
  tick: number;
  side: "home" | "away";
  /** Play window around the moment, in ticks (clamped to the match). */
  start: number;
  end: number;
  /** For goals: the official event. */
  goal?: Goal;
  /** For catches: the keeper's sim id and the ball speed. */
  catch?: { keeper: string; speed: number };
}

export interface Chapter {
  label: string;
  tick: number;
}

export interface HighlightsIndex {
  moments: Moment[];
  chapters: Chapter[];
  /** Plain-language notes about anything left out (e.g. a goal the replay doesn't confirm). */
  notes: string[];
  /** Play windows for highlights mode, merged where moments overlap, in order. */
  reel: Array<{ start: number; end: number }>;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function buildHighlights(events: readonly OfficialEvent[], replay: ReplayLog): HighlightsIndex {
  const { finalTick, tickRate } = replay;
  const notes: string[] = [];
  const inMatch = (t: unknown): t is number => finite(t) && t >= 0 && t <= finalTick;
  const window = (tick: number, w: { before: number; after: number }) => ({
    start: Math.max(0, Math.round(tick - w.before * tickRate)),
    end: Math.min(finalTick, Math.round(tick + w.after * tickRate)),
  });
  const log = replay.events ?? null;
  const replayGoals = new Set(
    (log ?? []).filter((e) => e.event.type === "goalScored" || e.event.type === "goal").map((e) => e.tick),
  );

  const moments: Moment[] = [];
  for (const e of events) {
    if (e.type !== "goal") continue;
    if (!inMatch(e.tick)) {
      notes.push(`A goal recorded at an invalid time (tick ${String(e.tick)}) is left out of the highlights.`);
      continue;
    }
    if (log && !replayGoals.has(e.tick)) {
      notes.push(
        `The goal at tick ${e.tick} isn't in this replay's own event log, so it's left out of the highlights.`,
      );
      continue;
    }
    moments.push({ kind: "goal", tick: e.tick, side: e.side, goal: e, ...window(e.tick, WINDOW.goal) });
  }
  for (const e of log ?? []) {
    if (e.event.type !== "catch" || e.event.success !== true) continue;
    const speed = e.event.incomingSpeed;
    const keeper = e.event.playerId;
    if (!finite(speed) || speed < CATCH_MIN_SPEED || typeof keeper !== "string" || !inMatch(e.tick)) continue;
    const side =
      replay.teamOf?.(keeper) ?? (keeper.startsWith("blue") ? "home" : keeper.startsWith("red") ? "away" : null);
    if (!side) continue;
    moments.push({ kind: "catch", tick: e.tick, side, catch: { keeper, speed }, ...window(e.tick, WINDOW.catch) });
  }
  moments.sort((a, b) => a.tick - b.tick || (a.kind === "goal" ? -1 : 1));

  const chapters: Chapter[] = [];
  for (const e of events) {
    if (!inMatch(e.tick)) continue;
    if (e.type === "periodStart")
      chapters.push({ label: e.period === "firstHalf" ? "Kick-off" : "Second half", tick: e.tick });
    if (e.type === "periodEnd")
      chapters.push({ label: e.period === "firstHalf" ? "Half-time" : "Full time", tick: e.tick });
  }
  chapters.sort((a, b) => a.tick - b.tick);

  const reel: HighlightsIndex["reel"] = [];
  for (const m of moments) {
    const last = reel.at(-1);
    if (last && m.start <= last.end) last.end = Math.max(last.end, m.end);
    else reel.push({ start: m.start, end: m.end });
  }
  return { moments, chapters, notes, reel };
}

/** Where highlights playback goes next from `tick`: stay, jump to the next window, or stop (null). */
export function reelNext(reel: HighlightsIndex["reel"], tick: number): number | null {
  for (const w of reel) {
    if (tick < w.start) return w.start;
    if (tick <= w.end) return tick;
  }
  return null;
}
