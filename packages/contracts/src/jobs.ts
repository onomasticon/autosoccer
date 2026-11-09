import { z } from "zod";
import { Id, Timestamp } from "./common.ts";

export const JobStatus = z.enum(["queued", "running", "succeeded", "failed"]);
export type JobStatus = z.infer<typeof JobStatus>;

/**
 * Durable background job. `idempotencyKey` is unique: enqueueing the same logical
 * work twice returns the existing job rather than duplicating it.
 */
export const Job = z.object({
  id: Id,
  kind: z.string().min(1).describe("e.g. match.play, manager.pre_match, article.write"),
  idempotencyKey: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  status: JobStatus,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  runAt: Timestamp,
  lockedBy: z.string().nullable(),
  lockedAt: Timestamp.nullable(),
  lastError: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  /** Links to what the job produced (match, replay, article…). */
  artifacts: z.array(z.object({ kind: z.string(), id: z.string() })),
  createdAt: Timestamp,
  finishedAt: Timestamp.nullable(),
});
export type Job = z.infer<typeof Job>;
