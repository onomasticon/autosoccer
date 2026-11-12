/**
 * Unattended season orchestration. A scheduler tick advances every scheduled/active season:
 * it waits for each round's kickoff time, runs the managers' pre-match decisions, releases
 * the round's matches to the job queue, and completes the season after the last result.
 * Post-match reviews and articles are enqueued by the match jobs themselves.
 *
 * Any number of worker processes may run the scheduler: a Postgres advisory lock elects one
 * leader per tick, so rounds are never double-released.
 */
import type { Db } from "@autosoccer/db";
import type { Logger } from "../../log.ts";
import { managerRoundHook } from "../agents/service.ts";
import { rolloverSeason } from "../league/rollover.ts";
import { type AdvanceResult, advanceSeason } from "../league/service.ts";

const LEADER_LOCK = 727275;

export interface TickResult {
  leader: boolean;
  seasons: Array<{ slug: string; result: AdvanceResult }>;
  /** Slug of a season created by rollover in this tick. */
  rolledOver?: string | null;
}

export interface TickOptions {
  respectSchedule: boolean;
  log?: Logger;
  now?: Date;
  /** When set, a completed league starts its next season (see league/rollover.ts). */
  rollover?: { managerModel: string; editorialModel: string };
}

export async function schedulerTick(db: Db, opts: TickOptions): Promise<TickResult> {
  const conn = await db.reserve();
  try {
    const [lock] = await conn<{ ok: boolean }[]>`select pg_try_advisory_lock(${LEADER_LOCK}) as ok`;
    if (!lock!.ok) return { leader: false, seasons: [] };
    try {
      const seasons = await db<{ id: string; slug: string }[]>`
        select id, slug from seasons where status in ('scheduled', 'active') order by starts_at nulls last, created_at`;
      const hook = managerRoundHook(db);
      const out: TickResult["seasons"] = [];
      for (const s of seasons) {
        const result = await advanceSeason(db, s.id, {
          respectSchedule: opts.respectSchedule,
          now: opts.now,
          beforeRound: hook,
        });
        out.push({ slug: s.slug, result });
        if (result.state === "blocked") {
          opts.log?.error(
            "season blocked: a match failed permanently — run `bun run ops requeue` after fixing the cause",
            {
              season: s.slug,
              round: result.round,
              fixtures: result.failed,
            },
          );
        } else if (result.state === "completed") {
          opts.log?.info("season completed", { season: s.slug });
        }
      }
      const rolledOver = opts.rollover
        ? await rolloverSeason(db, { ...opts.rollover, now: opts.now, log: opts.log })
        : null;
      return { leader: true, seasons: out, rolledOver };
    } finally {
      await conn`select pg_advisory_unlock(${LEADER_LOCK})`;
    }
  } finally {
    conn.release();
  }
}

export interface HeartbeatStats {
  succeeded: number;
  failed: number;
  lastKind: string | null;
}

export async function heartbeat(db: Db, workerId: string, role: "worker" | "scheduler", stats?: HeartbeatStats) {
  await db`
    insert into worker_heartbeats (worker_id, role, jobs_succeeded, jobs_failed, last_job_kind)
    values (${workerId}, ${role}, ${stats?.succeeded ?? 0}, ${stats?.failed ?? 0}, ${stats?.lastKind ?? null})
    on conflict (worker_id) do update set last_seen = now(), jobs_succeeded = excluded.jobs_succeeded,
      jobs_failed = excluded.jobs_failed, last_job_kind = coalesce(excluded.last_job_kind, worker_heartbeats.last_job_kind)`;
}

/** Scheduler loop (stop() to end). Runs alongside the job worker in the worker process. */
export function startScheduler(db: Db, opts: TickOptions & { intervalMs: number; schedulerId: string }) {
  let running = true;
  const loop = (async () => {
    while (running) {
      try {
        await schedulerTick(db, opts);
        await heartbeat(db, opts.schedulerId, "scheduler");
      } catch (e) {
        opts.log?.error("scheduler tick failed", { error: (e as Error).message });
      }
      await new Promise((r) => setTimeout(r, opts.intervalMs));
    }
  })();
  return {
    stop: async () => {
      running = false;
      await loop;
    },
  };
}
