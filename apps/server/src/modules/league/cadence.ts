/**
 * Fixture cadence: how rounds are spaced on the published calendar. All times are UTC.
 *  - demo:          a round every N minutes (default 60), for local runs and fast demos
 *  - weekly:        one round a week, Saturdays 15:00 UTC
 *  - twice-weekly:  Wednesdays and Saturdays, 19:00 UTC
 *
 * Rescheduling only ever moves rounds that haven't started: a round with any fixture that is
 * playing, completed or failed keeps its recorded kickoff times exactly as they were.
 */
import type { Db } from "@autosoccer/db";

export type Cadence =
  | { kind: "interval"; minutes: number }
  | { kind: "weekly"; slots: Array<{ weekday: number; hour: number; minute: number }> };

export const CADENCES = {
  demo: { kind: "interval", minutes: 60 },
  weekly: { kind: "weekly", slots: [{ weekday: 6, hour: 15, minute: 0 }] },
  "twice-weekly": {
    kind: "weekly",
    slots: [
      { weekday: 3, hour: 19, minute: 0 },
      { weekday: 6, hour: 19, minute: 0 },
    ],
  },
} as const satisfies Record<string, Cadence>;
export type CadenceName = keyof typeof CADENCES;

export function parseCadence(name: string, intervalMinutes?: number): Cadence {
  if (name === "demo") return { kind: "interval", minutes: intervalMinutes ?? 60 };
  const c = (CADENCES as Record<string, Cadence>)[name];
  if (!c) throw new Error(`unknown cadence "${name}" (use ${Object.keys(CADENCES).join(", ")})`);
  return c;
}

/** Kickoff for each of `rounds` rounds: the first slot at or after `from`, then every slot after. */
export function kickoffs(from: Date, rounds: number, cadence: Cadence): Date[] {
  if (cadence.kind === "interval")
    return Array.from({ length: rounds }, (_, i) => new Date(from.getTime() + i * cadence.minutes * 60_000));
  const out: Date[] = [];
  const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  for (let d = 0; out.length < rounds && d < 366 * 2; d++) {
    const date = new Date(day.getTime() + d * 86_400_000);
    for (const s of [...cadence.slots].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute))) {
      if (date.getUTCDay() !== s.weekday) continue;
      const t = new Date(date.getTime() + (s.hour * 60 + s.minute) * 60_000);
      if (t >= from && out.length < rounds) out.push(t);
    }
  }
  return out;
}

export interface RescheduleChange {
  round: number;
  from: string | null;
  to: string;
}

/**
 * Moves every round that hasn't started onto the cadence, starting no earlier than `from`.
 * Started rounds (any fixture playing/completed/failed) are never touched. Idempotent.
 */
export async function rescheduleUnplayed(
  db: Db,
  seasonId: string,
  cadence: Cadence,
  opts: { from?: Date; dryRun?: boolean } = {},
): Promise<{ changes: RescheduleChange[]; untouchedRounds: number[] }> {
  const rounds = await db<{ round: number; started: boolean; scheduled_at: Date | null }[]>`
    select round, bool_or(status in ('playing', 'completed', 'failed')) as started, min(scheduled_at) as scheduled_at
    from fixtures where season_id = ${seasonId} group by round order by round`;
  const open = rounds.filter((r) => !r.started);
  const untouchedRounds = rounds.filter((r) => r.started).map((r) => r.round);
  const lastStarted = rounds.filter((r) => r.started).at(-1)?.scheduled_at ?? null;
  // Never schedule a round before the last started round's kickoff, nor in the past.
  const earliest = new Date(Math.max(opts.from?.getTime() ?? Date.now(), (lastStarted?.getTime() ?? 0) + 60_000));
  const times = kickoffs(earliest, open.length, cadence);
  const changes = open.map((r, i) => ({
    round: r.round,
    from: r.scheduled_at?.toISOString() ?? null,
    to: times[i]!.toISOString(),
  }));
  if (!opts.dryRun)
    await db.begin(async (tx) => {
      for (const c of changes)
        await tx`
          update fixtures set scheduled_at = ${c.to}, updated_at = now()
          where season_id = ${seasonId} and round = ${c.round} and status in ('scheduled', 'ready')`;
    });
  return { changes, untouchedRounds };
}
