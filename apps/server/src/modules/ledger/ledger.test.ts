import { BudgetResponse } from "@autosoccer/contracts";
import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { buildHandlers } from "../../jobs/handlers.ts";
import { createWorker } from "../../jobs/worker.ts";
import { offlineManagerLlm } from "../agents/offline.ts";
import { managerRoundHook, seedManagers } from "../agents/service.ts";
import { SEED_TEAMS } from "../league/seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "../league/service.ts";
import { budgetSummary, ledgerGate } from "./service.ts";

async function season(t: TestDatabase, slug: string, budget: number) {
  await seedTeams(t.db);
  return (
    await createSeason(t.db, {
      slug,
      name: slug,
      seed: 5,
      budgetPerTeamMicroUsd: budget,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
    })
  ).seasonId;
}
async function run(t: TestDatabase, seasonId: string, key: string) {
  const [r] = await t.db<{ id: string }[]>`
    insert into agent_runs (agent_kind, agent_id, purpose, season_id, idempotency_key, attempt)
    values ('manager', gen_random_uuid(), 'pre_match', ${seasonId}, ${key}, 1) returning id`;
  return r!.id;
}
const bal = async (t: TestDatabase, seasonId: string, teamId: string) =>
  Number(
    (
      await t.db<
        { b: number }[]
      >`select coalesce(sum(amount_micro_usd),0)::bigint as b from compute_transactions where season_id = ${seasonId} and team_id = ${teamId}`
    )[0]!.b,
  );

describe("compute ledger", () => {
  let t: TestDatabase;
  let s: string;
  let team: string;
  beforeAll(async () => {
    t = await createTestDatabase();
    s = await season(t, "ledger", 100_000); // $0.10 per team
    team = (await t.db<{ id: string }[]>`select id from teams where slug = 'harbour-city'`)[0]!.id;
  });
  afterAll(async () => {
    await t.drop();
  });

  it("grants the season budget once, lazily, and enforces it on reservation", async () => {
    const gate = ledgerGate(t.db);
    const r1 = await run(t, s, "a");
    expect(await gate.reserve({ seasonId: s, teamId: team, runId: r1, estimateMicroUsd: 150_000 })).toBe(false);
    expect(await gate.reserve({ seasonId: s, teamId: team, runId: r1, estimateMicroUsd: 60_000 })).toBe(true);
    const grants =
      await t.db`select amount_micro_usd from compute_transactions where kind = 'grant' and team_id = ${team}`;
    expect(grants).toEqual([{ amount_micro_usd: 100_000 }]);
    expect(await bal(t, s, team)).toBe(40_000);
    // settle: hold released, actual cost charged
    await gate.settle({
      seasonId: s,
      teamId: team,
      runId: r1,
      costMicroUsd: 12_345,
      provider: "offline",
      model: "m",
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(await bal(t, s, team)).toBe(100_000 - 12_345);
    // a retried settle for the same attempt can't double-charge
    await gate.settle({
      seasonId: s,
      teamId: team,
      runId: r1,
      costMicroUsd: 12_345,
      provider: "offline",
      model: "m",
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(await bal(t, s, team)).toBe(100_000 - 12_345);
  });

  it("a retried attempt releases the stale hold from a crashed attempt before reserving again", async () => {
    const gate = ledgerGate(t.db);
    const r2 = await run(t, s, "b");
    const before = await bal(t, s, team);
    expect(await gate.reserve({ seasonId: s, teamId: team, runId: r2, estimateMicroUsd: 50_000 })).toBe(true);
    // worker crashes here: no settle/release. The job is retried (attempt 2):
    await t.db`update agent_runs set attempt = 2 where id = ${r2}`;
    expect(await gate.reserve({ seasonId: s, teamId: team, runId: r2, estimateMicroUsd: 50_000 })).toBe(true);
    expect(await bal(t, s, team)).toBe(before - 50_000); // one hold, not two
    await gate.release({ seasonId: s, teamId: team, runId: r2 });
    expect(await bal(t, s, team)).toBe(before);
  });

  it("one attempt can hold several reservations (call + repair); settle releases them all and charges once", async () => {
    const s3 = await season(t, "multi", 100_000);
    const gate = ledgerGate(t.db);
    const r = await run(t, s3, "multi-run");
    expect(await gate.reserve({ seasonId: s3, teamId: team, runId: r, estimateMicroUsd: 40_000 })).toBe(true);
    expect(await gate.reserve({ seasonId: s3, teamId: team, runId: r, estimateMicroUsd: 40_000 })).toBe(true);
    expect(await bal(t, s3, team)).toBe(20_000);
    expect(await gate.reserve({ seasonId: s3, teamId: team, runId: r, estimateMicroUsd: 40_000 })).toBe(false);
    await gate.settle({
      seasonId: s3,
      teamId: team,
      runId: r,
      costMicroUsd: 9_000,
      provider: "p",
      model: "m",
      inputTokens: 1,
      outputTokens: 1,
    });
    expect(await bal(t, s3, team)).toBe(91_000);
  });

  it("is race-safe: concurrent reservations never overspend", async () => {
    const s2 = await season(t, "race", 100_000);
    const gate = ledgerGate(t.db);
    const runs = await Promise.all(Array.from({ length: 30 }, (_, i) => run(t, s2, `race-${i}`)));
    const ok = await Promise.all(
      runs.map((runId) => gate.reserve({ seasonId: s2, teamId: team, runId, estimateMicroUsd: 10_000 })),
    );
    expect(ok.filter(Boolean)).toHaveLength(10);
    expect(await bal(t, s2, team)).toBe(0);
    const [g] =
      await t.db`select count(*)::int as n from compute_transactions where season_id = ${s2} and kind = 'grant' and team_id = ${team}`;
    expect(g!.n).toBe(1);
  });

  it("summarises granted / spent / reserved / remaining per team", async () => {
    const rows = await budgetSummary(t.db, s);
    const h = rows.find((r) => r.teamId === team)!;
    expect(h).toMatchObject({
      grantedMicroUsd: 100_000,
      spentMicroUsd: 12_345,
      reservedMicroUsd: 0,
      remainingMicroUsd: 87_655,
      runs: 1,
      exhausted: true,
    });
    // $0.087655 left is below one worst-case Opus 5.5 call ($0.088 = 2k in + 4k out): exhausted.
    const untouched = rows.find((r) => r.teamId !== team)!;
    expect(untouched).toMatchObject({ grantedMicroUsd: 100_000, spentMicroUsd: 0, remainingMicroUsd: 100_000 });
    const app = createApp({ db: t.db, store: new MemoryReplayStore() });
    const body = BudgetResponse.parse(await (await app.request("/api/v1/seasons/ledger/budget")).json());
    expect(body.rows).toHaveLength(4);
  });
});

describe("budget enforcement across a managed season", () => {
  let t: TestDatabase;
  let tight: string;
  beforeAll(async () => {
    t = await createTestDatabase();
    // $0.15 per team: a worst-case call reserves ~$0.088, so several decisions fit, then exhausted.
    tight = await season(t, "tight", 150_000);
    await seedManagers(t.db, tight, "claude-opus-5-5");
    const worker = createWorker({
      db: t.db,
      handlers: buildHandlers({
        db: t.db,
        store: new MemoryReplayStore(),
        llm: offlineManagerLlm("claude-opus-5-5"),
        halfDurationSec: 10,
      }),
    });
    const hook = managerRoundHook(t.db);
    for (let i = 0; i < 100; i++) {
      const a = await advanceSeason(t.db, tight, { beforeRound: hook });
      if (a.state === "completed") break;
      await worker.drain();
    }
  }, 180_000);
  afterAll(async () => {
    await t.drop();
  });

  it("exhausted managers are skipped but the season completes on their last valid tactics", async () => {
    const [s] = await t.db`select status from seasons where id = ${tight}`;
    expect(s!.status).toBe("completed");
    const statuses = await t.db<
      { status: string; n: number }[]
    >`select status, count(*)::int as n from agent_runs group by status order by status`;
    const by = Object.fromEntries(statuses.map((r) => [r.status, r.n]));
    expect(by.succeeded).toBeGreaterThan(0);
    expect(by.skipped_budget).toBeGreaterThan(0);
    expect((by.succeeded ?? 0) + (by.skipped_budget ?? 0)).toBe(48);
    // matches still used a valid revision for every side
    const [m] =
      await t.db`select count(*)::int as n from matches where status = 'completed' and home_revision_id is not null and away_revision_id is not null`;
    expect(m!.n).toBe(12);
    // skipped runs made no model call and cost nothing
    const [sk] =
      await t.db`select coalesce(sum(cost_micro_usd),0)::int as c, coalesce(sum(input_tokens),0)::int as tok from agent_runs where status = 'skipped_budget'`;
    expect(sk).toEqual({ c: 0, tok: 0 });
  });

  it("never overspends, holds nothing at the end, and the ledger reconciles with agent-run costs", async () => {
    const rows = await budgetSummary(t.db, tight);
    for (const r of rows) {
      expect(r.spentMicroUsd).toBeLessThanOrEqual(r.grantedMicroUsd);
      expect(r.remainingMicroUsd).toBeGreaterThanOrEqual(0);
      expect(r.reservedMicroUsd).toBe(0);
      expect(r.exhausted).toBe(true);
    }
    const [charges] =
      await t.db`select (-sum(amount_micro_usd))::bigint as c from compute_transactions where kind = 'charge'`;
    const [runs] = await t.db`select sum(cost_micro_usd)::bigint as c from agent_runs`;
    expect(Number(charges!.c)).toBe(Number(runs!.c));
  });

  it("a new season resets the budget", async () => {
    const next = await season(t, "next", 250_000);
    const rows = await budgetSummary(t.db, next);
    expect(rows.every((r) => r.remainingMicroUsd === 250_000 && r.spentMicroUsd === 0 && !r.exhausted)).toBe(true);
    const team = rows[0]!.teamId;
    const r1 = await run(t, next, "fresh");
    expect(await ledgerGate(t.db).reserve({ seasonId: next, teamId: team, runId: r1, estimateMicroUsd: 50_000 })).toBe(
      true,
    );
  });
});
