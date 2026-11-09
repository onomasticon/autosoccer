import { hostname } from "node:os";
import type { Db } from "@autosoccer/db";
import { type Logger, silentLogger } from "../log.ts";
import { claim, complete, fail, failExhausted, type JobRow } from "./queue.ts";

/** Throw from a handler to fail a job without retrying (bad input, not a transient fault). */
export class PermanentJobError extends Error {}

export interface HandlerResult {
  result: Record<string, unknown>;
  artifacts?: Array<{ kind: string; id: string }>;
}
export type JobHandler = (job: JobRow, ctx: { log: Logger; workerId: string }) => Promise<HandlerResult>;

export interface WorkerOptions {
  db: Db;
  handlers: Record<string, JobHandler>;
  workerId?: string;
  log?: Logger;
  pollMs?: number;
  leaseMs?: number;
  baseBackoffMs?: number;
}

export function createWorker(o: WorkerOptions) {
  const workerId = o.workerId ?? `${hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
  const log = (o.log ?? silentLogger).child({ worker: workerId });
  const kinds = Object.keys(o.handlers);
  let running = false;

  /** Processes at most one job. Returns the job's final status for this attempt, or null when idle. */
  async function runOnce(): Promise<{ job: JobRow; status: "succeeded" | "queued" | "failed" } | null> {
    const job = await claim(o.db, workerId, { kinds, leaseMs: o.leaseMs });
    if (!job) return null;
    const handler = o.handlers[job.kind]!;
    const jlog = log.child({ job: job.id, kind: job.kind, key: job.idempotency_key, attempt: job.attempts });
    const t0 = performance.now();
    jlog.info("job started");
    try {
      const out = await handler(job, { log: jlog, workerId });
      await complete(o.db, job, out.result, out.artifacts ?? []);
      jlog.info("job succeeded", { ms: Math.round(performance.now() - t0) });
      return { job, status: "succeeded" };
    } catch (e) {
      const err = e as Error;
      const status = (await fail(o.db, job, err.message, {
        permanent: err instanceof PermanentJobError,
        baseBackoffMs: o.baseBackoffMs,
      })) as "queued" | "failed";
      jlog[status === "failed" ? "error" : "warn"]("job attempt failed", { error: err.message, next: status });
      return { job, status };
    }
  }

  /** Runs until no runnable job is left (useful for tests and one-shot CLIs). */
  async function drain(max = 1000) {
    const done: Array<{ job: JobRow; status: string }> = [];
    for (let i = 0; i < max; i++) {
      const r = await runOnce();
      if (!r) break;
      done.push(r);
    }
    return done;
  }

  async function start() {
    running = true;
    log.info("worker started", { kinds });
    while (running) {
      try {
        await failExhausted(o.db, o.leaseMs);
        const r = await runOnce();
        if (!r) await new Promise((res) => setTimeout(res, o.pollMs ?? 1000));
      } catch (e) {
        log.error("worker loop error", { error: (e as Error).message });
        await new Promise((res) => setTimeout(res, o.pollMs ?? 1000));
      }
    }
    log.info("worker stopped");
  }

  return {
    workerId,
    runOnce,
    drain,
    start,
    stop: () => {
      running = false;
    },
  };
}
