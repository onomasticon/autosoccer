/**
 * The Phase 2 league calendar (#99, calendar/1): exact UTC times for a whole season cycle of a
 * double round robin, and every decision opportunity a manager gets, each with its deadline.
 *
 * Three clocks are kept apart:
 *  - real time (UTC instants below), which drives the scheduler and model deadlines;
 *  - the football year (season N of the league), which drives ages, contracts and records;
 *  - match time (the simulator's clock inside a match), which never touches either.
 *
 * Shape of a cycle (defaults; all configurable):
 *   [founding: 10 days, inaugural season only] → preseason window (72h) → first half (n−1 rounds)
 *   → midseason window (24h) → second half (n−1 rounds) → the next cycle's preseason.
 * Rounds sit on fixed matchday slots (two a day, 12 hours apart). A half of an odd number of rounds
 * ends on the opposite slot to the one it started on, so the cycle's length depends on slot
 * alignment: computed, never assumed.
 *
 * Fairness: every club's tactics for a round lock before that round's first kickoff, so no club
 * picks its side knowing another result from the same round; the final round kicks off all at once.
 */
import { doubleRoundRobin } from "./schedule.ts";

export const CALENDAR_RULE = "calendar/1";

export interface CalendarConfig {
  clubs: number;
  /** UTC hours of the daily matchday slots (two slots: 12 hours apart by default). */
  slotHoursUtc: number[];
  preseasonHours: number;
  midseasonHours: number;
  /** Inaugural founding phase before the first preseason (0 for later seasons). */
  foundingDays: number;
  /** Fixtures in a round kick off in waves this many minutes apart (0: all at once). */
  staggerMinutes: number;
  /** Fixtures per wave. */
  perWave: number;
  /** Tactics lock this long before the round's first kickoff. */
  tacticsLockMinutes: number;
  /** A match takes about this long in real time (for post-match opportunities). */
  matchMinutes: number;
  /** Daily club management opens at this UTC hour each day of the season. */
  managementHourUtc: number;
  managementWindowHours: number;
}

export const DEFAULT_CALENDAR: CalendarConfig = {
  clubs: 20,
  slotHoursUtc: [8, 20],
  preseasonHours: 72,
  midseasonHours: 24,
  foundingDays: 10,
  staggerMinutes: 20,
  perWave: 5,
  tacticsLockMinutes: 30,
  matchMinutes: 10,
  managementHourUtc: 14,
  managementWindowHours: 4,
};

export interface RoundSlot {
  round: number;
  half: 1 | 2;
  /** Kickoff per fixture, in calendar order. */
  fixtures: Array<{ home: string; away: string; kickoff: Date }>;
  firstKickoff: Date;
  lastKickoff: Date;
  tacticsLock: Date;
}

export interface Window {
  kind: "founding" | "preseason" | "midseason";
  opens: Date;
  closes: Date;
}

export interface SeasonCalendar {
  rule: string;
  config: CalendarConfig;
  windows: Window[];
  rounds: RoundSlot[];
  /** After the last match of the season. */
  ends: Date;
  /** From the cycle's first window opening to the season's end. */
  cycleDays: number;
}

const H = 3_600_000;
const M = 60_000;

/** The first matchday slot at or after `t`. */
export function nextSlot(t: Date, slots: number[]): Date {
  const day = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
  for (let d = 0; d < 3; d++)
    for (const h of [...slots].sort((a, b) => a - b)) {
      const s = new Date(day + d * 24 * H + h * H);
      if (s.getTime() >= t.getTime()) return s;
    }
  throw new Error("no slot found");
}

/** A whole cycle from `opens` (the start of founding or of the preseason window). */
export function seasonCalendar(teams: string[], opens: Date, cfg: CalendarConfig = DEFAULT_CALENDAR): SeasonCalendar {
  if (teams.length !== cfg.clubs) throw new Error(`calendar for ${cfg.clubs} clubs got ${teams.length}`);
  const windows: Window[] = [];
  let t = opens.getTime();
  if (cfg.foundingDays > 0) {
    windows.push({ kind: "founding", opens: new Date(t), closes: new Date(t + cfg.foundingDays * 24 * H) });
    t += cfg.foundingDays * 24 * H;
  }
  windows.push({ kind: "preseason", opens: new Date(t), closes: new Date(t + cfg.preseasonHours * H) });
  t += cfg.preseasonHours * H;
  const fixtures = doubleRoundRobin(teams);
  const total = Math.max(...fixtures.map((f) => f.round));
  const half = total / 2;
  const rounds: RoundSlot[] = [];
  // The first slot must also leave room for the tactics lock after the window closes.
  let slot = nextSlot(new Date(t + cfg.tacticsLockMinutes * M), cfg.slotHoursUtc);
  for (let r = 1; r <= total; r++) {
    if (r === half + 1) {
      const lastEnd = rounds.at(-1)!.lastKickoff.getTime() + cfg.matchMinutes * M;
      windows.push({ kind: "midseason", opens: new Date(lastEnd), closes: new Date(lastEnd + cfg.midseasonHours * H) });
      slot = nextSlot(new Date(lastEnd + cfg.midseasonHours * H + cfg.tacticsLockMinutes * M), cfg.slotHoursUtc);
    }
    const own = fixtures.filter((f) => f.round === r);
    const final = r === total;
    const kicks = own.map((f, i) => ({
      home: f.home,
      away: f.away,
      kickoff: new Date(slot.getTime() + (final ? 0 : Math.floor(i / cfg.perWave) * cfg.staggerMinutes * M)),
    }));
    const first = kicks[0]!.kickoff;
    const last = kicks.at(-1)!.kickoff;
    rounds.push({
      round: r,
      half: r <= half ? 1 : 2,
      fixtures: kicks,
      firstKickoff: first,
      lastKickoff: last,
      tacticsLock: new Date(first.getTime() - cfg.tacticsLockMinutes * M),
    });
    // The next round goes on the next slot after this round's last match ends and the next lock.
    slot = nextSlot(new Date(last.getTime() + cfg.matchMinutes * M + cfg.tacticsLockMinutes * M + 1), cfg.slotHoursUtc);
  }
  const ends = new Date(rounds.at(-1)!.lastKickoff.getTime() + cfg.matchMinutes * M);
  return {
    rule: CALENDAR_RULE,
    config: cfg,
    windows,
    rounds,
    ends,
    cycleDays: (ends.getTime() - opens.getTime()) / (24 * H),
  };
}

export type OpportunityKind = "founding" | "season-strategy" | "window" | "management" | "pre-match" | "post-match";

export interface Opportunity {
  kind: OpportunityKind;
  opens: Date;
  deadline: Date;
  round?: number;
  window?: Window["kind"];
}

/**
 * Every decision opportunity a manager gets in the cycle. A manager may always decline (no-op);
 * nothing forces an action. Each opportunity is one bounded call (plus at most one repair).
 */
export function opportunities(cal: SeasonCalendar): Opportunity[] {
  const cfg = cal.config;
  const out: Opportunity[] = [];
  for (const w of cal.windows) {
    if (w.kind === "founding") out.push({ kind: "founding", opens: w.opens, deadline: w.closes, window: w.kind });
    if (w.kind === "preseason")
      out.push({
        kind: "season-strategy",
        opens: w.opens,
        deadline: new Date(w.opens.getTime() + 24 * H),
        window: w.kind,
      });
    // The transfer window's phases (listing, bidding, replying): one opportunity each.
    if (w.kind !== "founding") {
      const span = (w.closes.getTime() - w.opens.getTime()) / 3;
      for (let p = 0; p < 3; p++)
        out.push({
          kind: "window",
          opens: new Date(w.opens.getTime() + p * span),
          deadline: new Date(w.opens.getTime() + (p + 1) * span),
          window: w.kind,
        });
    }
  }
  for (const r of cal.rounds) {
    const prev = cal.rounds[r.round - 2];
    const opens = prev
      ? new Date(prev.lastKickoff.getTime() + cfg.matchMinutes * M)
      : new Date(r.tacticsLock.getTime() - 12 * H);
    out.push({ kind: "pre-match", opens, deadline: r.tacticsLock, round: r.round });
    const after = new Date(r.lastKickoff.getTime() + cfg.matchMinutes * M);
    const next = cal.rounds[r.round];
    out.push({
      kind: "post-match",
      opens: after,
      deadline: next ? next.tacticsLock : new Date(after.getTime() + 12 * H),
      round: r.round,
    });
  }
  // Daily open-ended club management, every day from the preseason to the end of the season.
  const pre = cal.windows.find((w) => w.kind === "preseason")!;
  const day0 = Date.UTC(pre.opens.getUTCFullYear(), pre.opens.getUTCMonth(), pre.opens.getUTCDate());
  for (let d = day0 + cfg.managementHourUtc * H; d < cal.ends.getTime(); d += 24 * H)
    if (d >= pre.opens.getTime())
      out.push({ kind: "management", opens: new Date(d), deadline: new Date(d + cfg.managementWindowHours * H) });
  return out.sort((a, b) => a.opens.getTime() - b.opens.getTime() || a.kind.localeCompare(b.kind));
}
