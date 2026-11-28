import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHandlers } from "../../jobs/handlers.ts";
import { createWorker } from "../../jobs/worker.ts";
import type { LlmClient } from "../agents/llm.ts";
import { offlineManagerLlm } from "../agents/offline.ts";
import { apply, leagueBySlug, planFor } from "../league/leagues.ts";
import { REGISTRY } from "../models/registry.ts";
import { schedulerTick } from "../ops/scheduler.ts";
import { generatePool, RECRUIT } from "../players/recruitment.ts";
import { INAUGURAL, inauguralReadiness, startInaugural, tickInaugural } from "./inaugural.ts";
import { offlineFounder } from "./offline.ts";

const T0 = new Date("2027-05-01T09:00:00Z");
const MODELS = REGISTRY.filter((m) => m.status !== "reserve")
  .slice(0, 4)
  .map((m) => m.slug);

describe("the inaugural phase: founding, recruitment and the first season", () => {
  let t: TestDatabase;
  let leagueId: string;
  let seasonId: string;
  const managerModels: string[] = [];
  const ticks: string[] = [];
  let refusedEarly = "";

  beforeAll(async () => {
    t = await createTestDatabase();
    await apply(t.db, "create", { slug: "pilot", confirm: "pilot", name: "The Pilot League" });
    leagueId = (await leagueBySlug(t.db, "pilot"))!.id;
    await startInaugural(t.db, "pilot", { opens: T0, seed: 21, models: MODELS, budgetPerTeamMicroUsd: 1_000_000 });
    // Each manager answers through its own model's client (offline here, priced as that model).
    const llmFor = (model: string): LlmClient => {
      managerModels.push(model);
      return offlineManagerLlm(model);
    };
    const worker = createWorker({
      db: t.db,
      baseBackoffMs: 1,
      handlers: buildHandlers({
        db: t.db,
        store: new MemoryReplayStore(),
        llm: offlineManagerLlm("claude-opus-5-5"),
        llmFor,
        founderLlmFor: () => offlineFounder(),
        halfDurationSec: 10,
      }),
    });
    let now = new Date(T0.getTime() + 60_000);
    let activated = false;
    for (let i = 0; i < 160; i++) {
      await schedulerTick(t.db, { respectSchedule: false, now });
      await worker.drain();
      const [l] = await t.db<
        { inaugural_season_id: string | null }[]
      >`select inaugural_season_id from leagues where id = ${leagueId}`;
      if (l!.inaugural_season_id) seasonId = l!.inaugural_season_id;
      if (!activated) {
        const [tick] = await tickInaugural(t.db, { now });
        ticks.push(tick?.state ?? "-");
        if (tick?.state === "recruitment" && !refusedEarly) {
          const p = await planFor(t.db, "activate", { slug: "pilot", confirm: "pilot" });
          refusedEarly = p.ok ? "allowed" : "refused";
        }
        if (tick?.state === "ready") {
          await apply(t.db, "activate", { slug: "pilot", confirm: "pilot" });
          activated = true;
        }
      } else {
        const [s] = await t.db<{ status: string }[]>`select status from seasons where id = ${seasonId}`;
        if (s!.status === "completed") break;
      }
      now = new Date(now.getTime() + 12 * 3_600_000);
    }
  }, 600_000);
  afterAll(async () => {
    await t.drop();
  });

  it("founds a club per founder, each managed by its own model", async () => {
    const founded = await t.db<{ model: string; manager_model: string }[]>`
      select f.model, m.model as manager_model from founders f join manager_agents m on m.team_id = f.team_id
      where f.league_id = ${leagueId} and f.status = 'founded' order by f.model`;
    expect(founded.map((f) => f.model)).toEqual([...MODELS].sort());
    for (const f of founded) expect(f.manager_model).toBe(f.model);
    const [phases] =
      await t.db`select count(*)::int as n from league_phases where league_id = ${leagueId} and status = 'settled'`;
    expect(phases!.n).toBe(INAUGURAL.foundingRounds + 1);
  });

  it("creates season 1 for the founded clubs, with opening balances and the league's own talent pool", async () => {
    const [s] =
      await t.db`select slug, finance_rule, transfer_rule, insolvency_rule from seasons where id = ${seasonId}`;
    expect(s).toMatchObject({
      slug: "pilot-season-1",
      finance_rule: "finance/3",
      transfer_rule: "transfer/2",
      insolvency_rule: "insolvency/2",
    });
    const [clubs] = await t.db`select count(*)::int as n from season_teams where season_id = ${seasonId}`;
    expect(clubs!.n).toBe(4);
    const [opening] = await t.db`select count(*)::int as n from club_ledger where kind = 'opening'`;
    expect(opening!.n).toBe(4);
    const [pool] = await t.db`select count(*)::int as n from players where pool_league_id = ${leagueId}`;
    expect(pool!.n).toBe(generatePool(21, 4).length);
  });

  it("runs three offer rounds in order, then the safety net, before activation", async () => {
    const w = await t.db<{ round: number; phase: string; summary: { signed?: number } }[]>`
      select round, phase, summary from market_windows where season_id = ${seasonId} and kind = 'recruitment' order by round`;
    expect(w.map((x) => [x.round, x.phase])).toEqual([
      [1, "closed"],
      [2, "closed"],
      [3, "closed"],
    ]);
    expect(w.reduce((a, x) => a + (x.summary.signed ?? 0), 0)).toBeGreaterThan(0);
    const [decisions] =
      await t.db`select count(*)::int as n from agent_runs where idempotency_key like 'contracts:%' and status = 'succeeded'`;
    expect(decisions!.n).toBeGreaterThanOrEqual(3 * 4);
    expect(ticks).toContain("founding");
    expect(ticks).toContain("recruitment");
    expect(refusedEarly).toBe("refused");
  });

  it("gives every club a viable, contracted squad before the league can be activated", async () => {
    expect(await inauguralReadiness(t.db, leagueId)).toEqual({ ok: true, problems: [] });
    const squads = await t.db<{ n: number; gk: number }[]>`
      select count(*)::int as n, count(*) filter (where p.position = 'GK')::int as gk
      from season_teams st left join players p on p.team_id = st.team_id where st.season_id = ${seasonId} group by st.team_id`;
    for (const q of squads) {
      expect(q.n).toBeGreaterThanOrEqual(RECRUIT.squad.min);
      expect(q.n).toBeLessThanOrEqual(RECRUIT.squad.max);
      expect(q.gk).toBeGreaterThanOrEqual(1);
    }
    // Every signing is registered for the season (midseason signings by a registration move).
    const [unregistered] = await t.db`
      select count(*)::int as n from players p join season_teams st on st.team_id = p.team_id and st.season_id = ${seasonId}
      where not exists (select 1 from player_registrations r where r.season_id = ${seasonId} and r.player_id = p.id)
        and not exists (select 1 from registration_moves m where m.season_id = ${seasonId} and m.player_id = p.id)`;
    expect(unregistered!.n).toBe(0);
  });

  it("routes each club's decisions through its own manager's model", () => {
    expect(new Set(managerModels)).toEqual(new Set(MODELS));
  });

  it("plays the whole first season once activated", async () => {
    const [s] = await t.db`select status from seasons where id = ${seasonId}`;
    expect(s!.status).toBe("completed");
    const [f] =
      await t.db`select count(*)::int as n from fixtures where season_id = ${seasonId} and (status <> 'completed' or outcome is not null)`;
    expect(f!.n).toBe(0);
  });
});
