import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHandlers } from "../../jobs/handlers.ts";
import { createWorker } from "../../jobs/worker.ts";
import type { LlmClient, LlmRequest } from "../agents/llm.ts";
import { offlineManagerLlm } from "../agents/offline.ts";
import { managerRoundHook, seedManagers } from "../agents/service.ts";
import { SEED_TEAMS } from "../league/seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "../league/service.ts";
import { editorialBudgetSummary, editorialGate } from "../ledger/service.ts";
import { opsStatus } from "../ops/status.ts";
import { offlineEditorialLlm } from "./offline.ts";
import { seedJournalists, writeMatchReport } from "./service.ts";

const MODEL = "claude-opus-5-5";
/** A metered "model": the offline writer's drafts, reported as a real provider at 3k in / 2k out ($0.052). */
function pricedNewsroom(): LlmClient {
  const base = offlineEditorialLlm(MODEL);
  return {
    provider: "anthropic",
    model: MODEL,
    async complete<T>(r: LlmRequest<T>) {
      const res = await base.complete(r);
      return { ...res, provider: "anthropic", model: MODEL, inputTokens: 3000, outputTokens: 2000 };
    },
  };
}

describe("journalist spend cap", () => {
  let t: TestDatabase;
  let seasonId: string;
  const CAP = 500_000; // $0.50: room for a handful of ~$0.05 articles under a ~$0.17 worst-case hold
  beforeAll(async () => {
    t = await createTestDatabase();
    await seedTeams(t.db);
    ({ seasonId } = await createSeason(t.db, {
      slug: "capped",
      name: "Capped",
      seed: 7,
      budgetPerTeamMicroUsd: 1_000_000,
      editorialBudgetMicroUsd: CAP,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
    }));
    await seedManagers(t.db, seasonId, MODEL);
    await seedJournalists(t.db, MODEL);
    const worker = createWorker({
      db: t.db,
      handlers: buildHandlers({
        db: t.db,
        store: new MemoryReplayStore(),
        llm: offlineManagerLlm(MODEL),
        editorialLlm: pricedNewsroom(),
        halfDurationSec: 10,
      }),
    });
    const hook = managerRoundHook(t.db);
    for (let i = 0; i < 100; i++) {
      const a = await advanceSeason(t.db, seasonId, { beforeRound: hook });
      if (a.state === "completed") break;
      await worker.drain();
    }
    await worker.drain();
  }, 180_000);
  afterAll(async () => {
    await t.drop();
  });

  it("never spends past the season's editorial budget and holds nothing at the end", async () => {
    const b = await editorialBudgetSummary(t.db, seasonId);
    expect(b.grantedMicroUsd).toBe(CAP);
    expect(b.spentMicroUsd).toBeGreaterThan(0);
    expect(b.spentMicroUsd).toBeLessThanOrEqual(CAP);
    expect(b.reservedMicroUsd).toBe(0);
    expect(b.remainingMicroUsd).toBe(CAP - b.spentMicroUsd);
  });

  it("keeps publishing once the budget is spent: the template writer takes over, at no cost", async () => {
    const runs = await t.db<{ provider: string; status: string; cost: number }[]>`
      select provider, status, cost_micro_usd::int as cost from agent_runs
      where agent_kind = 'editorial' and season_id = ${seasonId} order by started_at`;
    expect(runs).toHaveLength(18); // 12 match reports + 6 round pieces
    expect(runs.every((r) => r.status === "succeeded")).toBe(true);
    const metered = runs.filter((r) => r.provider === "anthropic");
    const fallback = runs.filter((r) => r.provider === "offline");
    expect(metered.length).toBeGreaterThan(0);
    expect(fallback.length).toBeGreaterThan(0);
    expect(metered.length + fallback.length).toBe(18);
    expect(fallback.every((r) => r.cost === 0)).toBe(true);
    const n = (
      await t.db<{ n: number }[]>`
      select count(*)::int as n from articles where season_id = ${seasonId} and status = 'published'`
    )[0]!.n;
    expect(n).toBe(18);
  });

  it("reconciles: editorial ledger charges equal the journalists' run costs and never touch team budgets", async () => {
    const charged = (
      await t.db<{ charged: number }[]>`
      select (-coalesce(sum(amount_micro_usd), 0))::int as charged from compute_transactions
      where season_id = ${seasonId} and pool = 'editorial' and kind = 'charge'`
    )[0]!.charged;
    const cost = (
      await t.db<{ cost: number }[]>`
      select coalesce(sum(cost_micro_usd), 0)::int as cost from agent_runs where agent_kind = 'editorial'`
    )[0]!.cost;
    expect(charged).toBe(cost);
    const stray = (
      await t.db<{ stray: number }[]>`
      select count(*)::int as stray from compute_transactions c join agent_runs r on r.id = c.agent_run_id
      where r.agent_kind = 'editorial' and c.pool <> 'editorial'`
    )[0]!.stray;
    expect(stray).toBe(0);
  });

  it("reports the editorial budget in ops status", async () => {
    const s = await opsStatus(t.db);
    expect(s.budget?.editorial).toMatchObject({ grantedMicroUsd: CAP, reservedMicroUsd: 0 });
  });

  it("without a fallback writer, an article the budget can't cover is skipped, not failed", async () => {
    const [m] = await t.db<{ id: string }[]>`select id from matches order by id limit 1`;
    await t.db`delete from articles where match_id = ${m!.id}`;
    await t.db`delete from agent_runs where idempotency_key = ${`article.match_report:${m!.id}`}`;
    await t.db`update seasons set editorial_budget_micro_usd = ${CAP} where id = ${seasonId}`;
    const out = await writeMatchReport({ db: t.db, llm: pricedNewsroom(), gate: editorialGate(t.db) }, m!.id);
    expect(out).toEqual({ status: "skipped-budget" });
    const [run] = await t.db<{ status: string; error: string }[]>`
      select status, error from agent_runs where idempotency_key = ${`article.match_report:${m!.id}`}`;
    expect(run).toMatchObject({ status: "skipped_budget", error: "season editorial budget exhausted" });
    expect((await editorialBudgetSummary(t.db, seasonId)).reservedMicroUsd).toBe(0);
  });
});
