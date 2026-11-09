import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { buildHandlers } from "../../jobs/handlers.ts";
import { createWorker } from "../../jobs/worker.ts";
import { offlineManagerLlm } from "../agents/offline.ts";
import { seedManagers } from "../agents/service.ts";
import { SEED_TEAMS } from "../league/seed-data.ts";
import { createSeason, seedTeams } from "../league/service.ts";
import { heartbeat, schedulerTick } from "./scheduler.ts";
import { opsStatus, requeueFailed } from "./status.ts";

let t: TestDatabase;
let seasonId: string;
beforeAll(async () => {
  t = await createTestDatabase();
  await seedTeams(t.db);
  ({ seasonId } = await createSeason(t.db, {
    slug: "s1",
    name: "S1",
    seed: 3,
    budgetPerTeamMicroUsd: 1_000_000,
    teamSlugs: SEED_TEAMS.map((x) => x.slug),
    startsAt: new Date(Date.now() + 3_600_000),
  }));
  await seedManagers(t.db, seasonId, "claude-opus-5-5");
});
afterAll(async () => {
  await t.drop();
});

describe("scheduler", () => {
  it("waits for kickoff time when respecting the schedule", async () => {
    const r = await schedulerTick(t.db, { respectSchedule: true });
    expect(r.leader).toBe(true);
    expect(r.seasons[0]!.result.state).toBe("waiting");
    const [n] = await t.db`select count(*)::int as n from jobs`;
    expect(n!.n).toBe(0);
  });

  it("elects one leader when several schedulers tick at once", async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => schedulerTick(t.db, { respectSchedule: true })));
    expect(results.filter((r) => r.leader).length).toBeGreaterThanOrEqual(1);
    // a tick that lost the election does nothing
    for (const r of results.filter((x) => !x.leader)) expect(r.seasons).toEqual([]);
  });

  it("at kickoff: runs manager decisions first, then releases the round", async () => {
    const now = new Date(Date.now() + 2 * 3_600_000);
    const first = await schedulerTick(t.db, { respectSchedule: true, now });
    expect(first.seasons[0]!.result).toMatchObject({ state: "waiting", reason: "pre-round work in progress" });
    const [pre] = await t.db`select count(*)::int as n from jobs where kind = 'manager.pre_match'`;
    expect(pre!.n).toBe(4);
    const worker = createWorker({
      db: t.db,
      handlers: buildHandlers({
        db: t.db,
        store: new MemoryReplayStore(),
        llm: offlineManagerLlm("claude-opus-5-5"),
        halfDurationSec: 10,
      }),
    });
    await worker.drain();
    const second = await schedulerTick(t.db, { respectSchedule: true, now });
    expect(second.seasons[0]!.result).toMatchObject({ state: "playing", round: 1, enqueued: 2 });
  });
});

describe("operations", () => {
  it("reports workers, queue and season progress; unhealthy without live workers", async () => {
    let s = await opsStatus(t.db);
    expect(s.healthy).toBe(false);
    await heartbeat(t.db, "w-1", "worker", { succeeded: 3, failed: 0, lastKind: "match.play" });
    s = await opsStatus(t.db);
    expect(s.healthy).toBe(true);
    expect(s.workers[0]).toMatchObject({ id: "w-1", alive: true, succeeded: 3 });
    expect(s.seasons[0]).toMatchObject({ slug: "s1", fixturesTotal: 12, nextRound: 1 });
    expect(s.jobs.byKindAndStatus.some((j) => j.kind === "match.play")).toBe(true);
  });

  it("recovers a season blocked by a permanently failed match after requeue", async () => {
    // Fail the round-1 match jobs permanently (e.g. replay storage was down).
    const failingStore = {
      put: async () => {
        throw new Error("replay storage unavailable");
      },
      get: async () => new Uint8Array(),
    };
    const bad = createWorker({
      db: t.db,
      baseBackoffMs: 0,
      handlers: buildHandlers({
        db: t.db,
        store: failingStore,
        llm: offlineManagerLlm("claude-opus-5-5"),
        halfDurationSec: 10,
      }),
    });
    for (let i = 0; i < 10; i++) await bad.drain();
    const blocked = await schedulerTick(t.db, { respectSchedule: false });
    expect(blocked.seasons[0]!.result.state).toBe("blocked");
    const s = await opsStatus(t.db);
    expect(s.healthy).toBe(false);
    expect(s.jobs.failed[0]!.error).toMatch(/replay storage unavailable/);
    // Operator fixes storage and requeues.
    expect(await requeueFailed(t.db, { kind: "match.play" })).toBe(2);
    const good = createWorker({
      db: t.db,
      handlers: buildHandlers({
        db: t.db,
        store: new MemoryReplayStore(),
        llm: offlineManagerLlm("claude-opus-5-5"),
        halfDurationSec: 10,
      }),
    });
    await good.drain();
    const [m] = await t.db`select count(*)::int as n from matches where status = 'completed'`;
    expect(m!.n).toBe(2);
    expect((await schedulerTick(t.db, { respectSchedule: false })).seasons[0]!.result.state).not.toBe("blocked");
  });

  it("protects the ops endpoint with a token when configured", async () => {
    const app = createApp({ db: t.db, store: new MemoryReplayStore(), opsToken: "s3cret" });
    expect((await app.request("/api/v1/ops/status")).status).toBe(401);
    const ok = await app.request("/api/v1/ops/status", { headers: { authorization: "Bearer s3cret" } });
    expect([200, 503]).toContain(ok.status);
    expect((await ok.json()).seasons[0].slug).toBe("s1");
  });
});
