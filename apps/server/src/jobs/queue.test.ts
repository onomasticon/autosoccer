import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { backoffMs, claim, complete, enqueue, fail, failExhausted } from "./queue.ts";
import { createWorker, PermanentJobError } from "./worker.ts";

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});
beforeEach(async () => {
  await t.db`delete from jobs`;
});

describe("job queue", () => {
  it("enqueue is idempotent by key", async () => {
    const a = await enqueue(t.db, { kind: "k", key: "same", payload: { n: 1 } });
    const b = await enqueue(t.db, { kind: "k", key: "same", payload: { n: 2 } });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
    expect(b.job.payload).toEqual({ n: 1 });
  });

  it("concurrent workers never claim the same job (SKIP LOCKED)", async () => {
    for (let i = 0; i < 20; i++) await enqueue(t.db, { kind: "k", key: `j${i}` });
    const claimed = await Promise.all(Array.from({ length: 30 }, (_, i) => claim(t.db, `w${i}`)));
    const ids = claimed.filter(Boolean).map((j) => j!.id);
    expect(ids.length).toBe(20);
    expect(new Set(ids).size).toBe(20);
  });

  it("retries with backoff, then fails permanently after max attempts", async () => {
    await enqueue(t.db, { kind: "k", key: "flaky", maxAttempts: 2 });
    const j1 = await claim(t.db, "w");
    expect(await fail(t.db, j1!, "boom", { baseBackoffMs: 0 })).toBe("queued");
    const j2 = await claim(t.db, "w");
    expect(j2!.attempts).toBe(2);
    expect(await fail(t.db, j2!, "boom again", { baseBackoffMs: 0 })).toBe("failed");
    expect(await claim(t.db, "w")).toBeNull();
    const [row] = await t.db`select status, last_error, finished_at from jobs where idempotency_key = 'flaky'`;
    expect(row).toMatchObject({ status: "failed", last_error: "boom again" });
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(3)).toBe(8000);
  });

  it("does not run a retried job before its backoff elapses", async () => {
    await enqueue(t.db, { kind: "k", key: "later" });
    const j = await claim(t.db, "w");
    await fail(t.db, j!, "transient", { baseBackoffMs: 60_000 });
    expect(await claim(t.db, "w")).toBeNull();
  });

  it("reclaims a job whose worker died (lease expired)", async () => {
    await enqueue(t.db, { kind: "k", key: "orphan" });
    const j = await claim(t.db, "dead-worker");
    await t.db`update jobs set locked_at = now() - interval '10 minutes' where id = ${j!.id}`;
    const again = await claim(t.db, "live-worker", { leaseMs: 60_000 });
    expect(again!.id).toBe(j!.id);
    expect(again!.attempts).toBe(2);
    // the dead worker can no longer complete it
    expect(await complete(t.db, j!, { stale: true })).toBe(false);
    expect(await complete(t.db, again!, { ok: true })).toBe(true);
  });

  it("fails expired running jobs with no attempts left", async () => {
    await enqueue(t.db, { kind: "k", key: "exhausted", maxAttempts: 1 });
    const j = await claim(t.db, "w");
    await t.db`update jobs set locked_at = now() - interval '10 minutes' where id = ${j!.id}`;
    expect(await failExhausted(t.db, 60_000)).toBe(1);
  });
});

describe("worker", () => {
  it("runs handlers, records results and treats PermanentJobError as non-retryable", async () => {
    await enqueue(t.db, { kind: "ok", key: "a", payload: { x: 2 } });
    await enqueue(t.db, { kind: "bad", key: "b" });
    const w = createWorker({
      db: t.db,
      baseBackoffMs: 0,
      handlers: {
        ok: async (job) => ({
          result: { doubled: Number(job.payload.x) * 2 },
          artifacts: [{ kind: "thing", id: "1" }],
        }),
        bad: async () => {
          throw new PermanentJobError("invalid input");
        },
      },
    });
    const done = await w.drain();
    expect(done.map((d) => d.status).sort()).toEqual(["failed", "succeeded"]);
    const [ok] = await t.db`select status, result, artifacts from jobs where idempotency_key = 'a'`;
    expect(ok).toMatchObject({ status: "succeeded", result: { doubled: 4 }, artifacts: [{ kind: "thing", id: "1" }] });
    const [bad] = await t.db`select status, attempts from jobs where idempotency_key = 'b'`;
    expect(bad).toMatchObject({ status: "failed", attempts: 1 });
  });
});
