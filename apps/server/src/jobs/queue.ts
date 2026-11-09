import type { Job, JobStatus } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";

export interface JobRow {
  id: string;
  kind: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_at: Date;
  locked_by: string | null;
  locked_at: Date | null;
  last_error: string | null;
  result: Record<string, unknown> | null;
  artifacts: Array<{ kind: string; id: string }>;
  created_at: Date;
  finished_at: Date | null;
}

export const toJob = (r: JobRow): Job => ({
  id: r.id,
  kind: r.kind,
  idempotencyKey: r.idempotency_key,
  payload: r.payload,
  status: r.status,
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
  runAt: r.run_at.toISOString(),
  lockedBy: r.locked_by,
  lockedAt: r.locked_at?.toISOString() ?? null,
  lastError: r.last_error,
  result: r.result,
  artifacts: r.artifacts,
  createdAt: r.created_at.toISOString(),
  finishedAt: r.finished_at?.toISOString() ?? null,
});

export interface EnqueueInput {
  kind: string;
  key: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
  runAt?: Date;
}

/** Idempotent: the same key returns the existing job (whatever its state) instead of a duplicate. */
export async function enqueue(db: Db, input: EnqueueInput): Promise<{ job: JobRow; created: boolean }> {
  const [inserted] = await db<JobRow[]>`
    insert into jobs (kind, idempotency_key, payload, max_attempts, run_at)
    values (${input.kind}, ${input.key}, ${db.json((input.payload ?? {}) as never)}, ${input.maxAttempts ?? 3}, ${input.runAt ?? new Date()})
    on conflict (idempotency_key) do nothing
    returning *`;
  if (inserted) return { job: inserted, created: true };
  const [existing] = await db<JobRow[]>`select * from jobs where idempotency_key = ${input.key}`;
  return { job: existing!, created: false };
}

/**
 * Claims the next runnable job with SKIP LOCKED, so any number of workers can poll
 * concurrently without double-processing. Jobs whose lease expired (worker crashed
 * mid-run) are reclaimed.
 */
export async function claim(
  db: Db,
  workerId: string,
  opts: { kinds?: string[]; leaseMs?: number } = {},
): Promise<JobRow | null> {
  const lease = `${Math.round((opts.leaseMs ?? 5 * 60_000) / 1000)} seconds`;
  const kinds = opts.kinds ?? null;
  const [row] = await db<JobRow[]>`
    with next as (
      select id from jobs
      where attempts < max_attempts
        and (${kinds}::text[] is null or kind = any(${kinds}::text[]))
        and ((status = 'queued' and run_at <= now())
          or (status = 'running' and locked_at < now() - ${lease}::interval))
      order by run_at, created_at
      for update skip locked
      limit 1
    )
    update jobs j set status = 'running', attempts = j.attempts + 1, locked_by = ${workerId},
      locked_at = now(), updated_at = now()
    from next where j.id = next.id
    returning j.*`;
  return row ?? null;
}

export async function complete(
  db: Db,
  job: JobRow,
  result: Record<string, unknown>,
  artifacts: Array<{ kind: string; id: string }> = [],
): Promise<boolean> {
  const rows = await db`
    update jobs set status = 'succeeded', result = ${db.json(result as never)}, artifacts = ${db.json(artifacts)},
      last_error = null, locked_by = null, locked_at = null, finished_at = now(), updated_at = now()
    where id = ${job.id} and locked_by = ${job.locked_by} and status = 'running'
    returning id`;
  return rows.length === 1;
}

/** Exponential backoff: 2s, 4s, 8s… capped at 5 minutes. */
export const backoffMs = (attempt: number, baseMs = 2000) => Math.min(baseMs * 2 ** (attempt - 1), 5 * 60_000);

export async function fail(
  db: Db,
  job: JobRow,
  error: string,
  opts: { permanent?: boolean; baseBackoffMs?: number } = {},
): Promise<JobStatus> {
  const exhausted = opts.permanent || job.attempts >= job.max_attempts;
  const status: JobStatus = exhausted ? "failed" : "queued";
  const runAt = new Date(Date.now() + backoffMs(job.attempts, opts.baseBackoffMs));
  await db`
    update jobs set status = ${status}, last_error = ${error.slice(0, 4000)}, locked_by = null, locked_at = null,
      run_at = ${exhausted ? db`run_at` : runAt}, finished_at = ${exhausted ? new Date() : null}, updated_at = now()
    where id = ${job.id} and locked_by = ${job.locked_by}`;
  return status;
}

/** Marks running jobs whose lease expired and that have no attempts left as failed. */
export async function failExhausted(db: Db, leaseMs = 5 * 60_000): Promise<number> {
  const rows = await db`
    update jobs set status = 'failed', last_error = coalesce(last_error, 'lease expired with no attempts left'),
      locked_by = null, locked_at = null, finished_at = now(), updated_at = now()
    where status = 'running' and attempts >= max_attempts and locked_at < now() - ${`${Math.round(leaseMs / 1000)} seconds`}::interval
    returning id`;
  return rows.length;
}
