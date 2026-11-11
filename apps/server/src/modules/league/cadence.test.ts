import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorker } from "../../jobs/worker.ts";
import { MATCH_JOB, matchJobHandler } from "../matches/service.ts";
import { CADENCES, kickoffs, parseCadence, rescheduleUnplayed } from "./cadence.ts";
import { SEED_TEAMS } from "./seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "./service.ts";

describe("kickoffs", () => {
  it("demo: every N minutes from the start", () => {
    const t = kickoffs(new Date("2026-11-11T10:00:00Z"), 3, { kind: "interval", minutes: 30 });
    expect(t.map((d) => d.toISOString())).toEqual([
      "2026-11-11T10:00:00.000Z",
      "2026-11-11T10:30:00.000Z",
      "2026-11-11T11:00:00.000Z",
    ]);
  });
  it("weekly: Saturdays 15:00 UTC, first slot at or after the start", () => {
    const t = kickoffs(new Date("2026-11-11T10:00:00Z"), 3, CADENCES.weekly); // a Wednesday
    expect(t.map((d) => d.toISOString())).toEqual([
      "2026-11-14T15:00:00.000Z",
      "2026-11-21T15:00:00.000Z",
      "2026-11-28T15:00:00.000Z",
    ]);
  });
  it("twice-weekly: Wednesdays and Saturdays 19:00 UTC", () => {
    const t = kickoffs(new Date("2026-11-11T20:00:00Z"), 3, CADENCES["twice-weekly"]);
    expect(t.map((d) => d.toISOString())).toEqual([
      "2026-11-14T19:00:00.000Z",
      "2026-11-18T19:00:00.000Z",
      "2026-11-21T19:00:00.000Z",
    ]);
  });
  it("parses names and rejects unknown ones", () => {
    expect(parseCadence("demo", 15)).toEqual({ kind: "interval", minutes: 15 });
    expect(() => parseCadence("daily")).toThrow(/unknown cadence/);
  });
});

describe("rescheduling a season", () => {
  let t: TestDatabase;
  let seasonId: string;
  beforeAll(async () => {
    t = await createTestDatabase();
    await seedTeams(t.db);
    ({ seasonId } = await createSeason(t.db, {
      slug: "s",
      name: "S",
      seed: 5,
      budgetPerTeamMicroUsd: 0,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      startsAt: new Date("2026-11-11T06:00:00Z"),
      cadence: { kind: "interval", minutes: 60 },
    }));
    // Play round 1 with the demo cadence.
    const worker = createWorker({
      db: t.db,
      handlers: { [MATCH_JOB]: matchJobHandler({ db: t.db, store: new MemoryReplayStore(), halfDurationSec: 10 }) },
    });
    await advanceSeason(t.db, seasonId);
    await worker.drain();
    await advanceSeason(t.db, seasonId); // completes round 1 bookkeeping
  }, 60_000);
  afterAll(async () => {
    await t.drop();
  });

  it("creates a season on a real-season cadence", async () => {
    const { seasonId: weekly } = await createSeason(t.db, {
      slug: "weekly",
      name: "W",
      seed: 5,
      budgetPerTeamMicroUsd: 0,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      startsAt: new Date("2026-11-11T06:00:00Z"),
      cadence: CADENCES.weekly,
    });
    const rows = await t.db<{ round: number; at: Date }[]>`
      select round, min(scheduled_at) as at from fixtures where season_id = ${weekly} group by round order by round`;
    expect(rows.map((r) => r.at.toISOString().slice(0, 10))).toEqual([
      "2026-11-14",
      "2026-11-21",
      "2026-11-28",
      "2026-12-05",
      "2026-12-12",
      "2026-12-19",
    ]);
  });

  it("moves only rounds that haven't started; recorded fixtures keep their kickoffs", async () => {
    const before = await t.db<{ id: string; round: number; status: string; scheduled_at: Date }[]>`
      select id, round, status, scheduled_at from fixtures where season_id = ${seasonId} order by round, id`;
    const played = before.filter((f) => f.status === "completed");
    expect(played.length).toBeGreaterThan(0);
    const dry = await rescheduleUnplayed(t.db, seasonId, CADENCES.weekly, {
      from: new Date("2026-11-12T00:00:00Z"),
      dryRun: true,
    });
    expect(dry.untouchedRounds).toEqual([1]);
    const after0 = await t.db`select scheduled_at from fixtures where season_id = ${seasonId} order by round, id`;
    expect(after0.map((r) => r.scheduled_at)).toEqual(before.map((r) => r.scheduled_at)); // dry run changes nothing

    const r = await rescheduleUnplayed(t.db, seasonId, CADENCES.weekly, { from: new Date("2026-11-12T00:00:00Z") });
    expect(r.changes.map((c) => [c.round, c.to])).toEqual([
      [2, "2026-11-14T15:00:00.000Z"],
      [3, "2026-11-21T15:00:00.000Z"],
      [4, "2026-11-28T15:00:00.000Z"],
      [5, "2026-12-05T15:00:00.000Z"],
      [6, "2026-12-12T15:00:00.000Z"],
    ]);
    const after = await t.db<{ id: string; scheduled_at: Date }[]>`
      select id, scheduled_at from fixtures where season_id = ${seasonId}`;
    const at = new Map(after.map((f) => [f.id, f.scheduled_at.toISOString()]));
    for (const f of played) expect(at.get(f.id)).toBe(f.scheduled_at.toISOString());
    // Idempotent.
    const again = await rescheduleUnplayed(t.db, seasonId, CADENCES.weekly, { from: new Date("2026-11-12T00:00:00Z") });
    expect(again.changes.map((c) => c.to)).toEqual(r.changes.map((c) => c.to));
  });

  it("never schedules an open round before the last started round", async () => {
    const r = await rescheduleUnplayed(
      t.db,
      seasonId,
      { kind: "interval", minutes: 60 },
      {
        from: new Date("2020-01-01T00:00:00Z"),
        dryRun: true,
      },
    );
    const [r1] = await t.db<{ at: Date }[]>`
      select min(scheduled_at) as at from fixtures where season_id = ${seasonId} and round = 1`;
    for (const c of r.changes) expect(new Date(c.to).getTime()).toBeGreaterThan(r1!.at.getTime());
  });
});
