/** Operational status: season progress, job queue, failures, worker liveness and spend. */
import type { Db } from "@autosoccer/db";
import { budgetSummary } from "../ledger/service.ts";

export async function opsStatus(db: Db, opts: { staleAfterSec?: number } = {}) {
  const stale = opts.staleAfterSec ?? 60;
  const seasons = await db<
    {
      id: string;
      slug: string;
      status: string;
      done: number;
      total: number;
      next_round: number | null;
      next_at: Date | null;
    }[]
  >`
    select s.id, s.slug, s.status,
      count(f.*) filter (where f.status = 'completed')::int as done, count(f.*)::int as total,
      min(f.round) filter (where f.status <> 'completed') as next_round,
      min(f.scheduled_at) filter (where f.status = 'scheduled') as next_at
    from seasons s left join fixtures f on f.season_id = s.id
    group by s.id order by s.created_at desc limit 5`;
  const jobs = await db<{ kind: string; status: string; n: number }[]>`
    select kind, status, count(*)::int as n from jobs group by kind, status order by kind, status`;
  const failed = await db<
    { kind: string; idempotency_key: string; attempts: number; last_error: string | null; finished_at: Date | null }[]
  >`
    select kind, idempotency_key, attempts, last_error, finished_at from jobs where status = 'failed' order by finished_at desc limit 20`;
  const retrying = await db<
    { n: number }[]
  >`select count(*)::int as n from jobs where status = 'queued' and attempts > 0`;
  const workers = await db<
    {
      worker_id: string;
      role: string;
      last_seen: Date;
      jobs_succeeded: number;
      jobs_failed: number;
      last_job_kind: string | null;
      age: number;
    }[]
  >`
    select *, extract(epoch from now() - last_seen)::int as age from worker_heartbeats order by last_seen desc limit 20`;
  const agents = await db<{ agent_kind: string; status: string; n: number; cost: number }[]>`
    select agent_kind, status, count(*)::int as n, coalesce(sum(cost_micro_usd), 0)::bigint as cost from agent_runs group by 1, 2 order by 1, 2`;
  const current = seasons.find((s) => s.status === "active") ?? seasons[0];
  return {
    generatedAt: new Date().toISOString(),
    seasons: seasons.map((s) => ({
      slug: s.slug,
      status: s.status,
      fixturesCompleted: s.done,
      fixturesTotal: s.total,
      nextRound: s.next_round,
      nextKickoff: s.next_at?.toISOString() ?? null,
    })),
    jobs: {
      byKindAndStatus: jobs,
      retrying: retrying[0]!.n,
      failed: failed.map((j) => ({
        kind: j.kind,
        key: j.idempotency_key,
        attempts: j.attempts,
        error: j.last_error,
        at: j.finished_at?.toISOString() ?? null,
      })),
    },
    workers: workers.map((w) => ({
      id: w.worker_id,
      role: w.role,
      lastSeenSecondsAgo: w.age,
      alive: w.age <= stale,
      succeeded: w.jobs_succeeded,
      failed: w.jobs_failed,
      lastJobKind: w.last_job_kind,
    })),
    agents: agents.map((a) => ({ kind: a.agent_kind, status: a.status, runs: a.n, costMicroUsd: Number(a.cost) })),
    budget: current ? { season: current.slug, rows: await budgetSummary(db, current.id) } : null,
    healthy: failed.length === 0 && workers.some((w) => w.age <= stale),
  };
}

/** Recovery: put permanently failed jobs back in the queue with fresh attempts (after fixing the cause). */
export async function requeueFailed(db: Db, opts: { kind?: string } = {}): Promise<number> {
  const rows = await db`
    update jobs set status = 'queued', attempts = 0, run_at = now(), finished_at = null, locked_by = null, locked_at = null, updated_at = now()
    where status = 'failed' and (${opts.kind ?? null}::text is null or kind = ${opts.kind ?? null})
    returning id`;
  return rows.length;
}
