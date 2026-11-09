import { AgentRunListResponse, TeamDetailResponse } from "@autosoccer/contracts";
import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { buildHandlers } from "../../jobs/handlers.ts";
import { createWorker } from "../../jobs/worker.ts";
import { SEED_TEAMS } from "../league/seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "../league/service.ts";
import { latestValidRevision } from "../tactics/service.ts";
import type { LlmClient, LlmRequest } from "./llm.ts";
import { offlineManagerLlm } from "./offline.ts";
import type { PreMatchDecision } from "./prompts.ts";
import { type ComputeGate, managerRoundHook, runPostMatch, runPreMatch, seedManagers } from "./service.ts";

const MODEL = "claude-opus-5-5";

async function setup(t: TestDatabase, slug = "season-1") {
  await seedTeams(t.db);
  const { seasonId } = await createSeason(t.db, {
    slug,
    name: "S",
    seed: 20261109,
    budgetPerTeamMicroUsd: 1_000_000,
    teamSlugs: SEED_TEAMS.map((x) => x.slug),
  });
  await seedManagers(t.db, seasonId, MODEL);
  const teams = new Map(
    (await t.db<{ id: string; slug: string }[]>`select id, slug from teams`).map((r) => [r.slug, r.id]),
  );
  const [f1] = await t.db<{ id: string; home_team_id: string; away_team_id: string }[]>`
    select id, home_team_id, away_team_id from fixtures where season_id = ${seasonId} and round = 1 order by id limit 1`;
  return { seasonId, teams, fixture: f1! };
}

/** Wraps an LLM to script responses and record every call. */
function scripted(base: LlmClient, transform: (n: number, out: unknown, req: LlmRequest<unknown>) => unknown) {
  const calls: Array<LlmRequest<unknown>> = [];
  const llm: LlmClient = {
    provider: base.provider,
    model: base.model,
    async complete<T>(r: LlmRequest<T>) {
      calls.push(r as LlmRequest<unknown>);
      const res = await base.complete(r);
      return { ...res, output: transform(calls.length, res.output, r as LlmRequest<unknown>) as T };
    },
  };
  return { llm, calls };
}

describe("manager pre/post-match loop", () => {
  let t: TestDatabase;
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await setup(t);
  });
  afterAll(async () => {
    await t.drop();
  });

  it("seeds four persistent managers with opening tactics (idempotently)", async () => {
    await seedManagers(t.db, ctx.seasonId, MODEL);
    const managers = await t.db`select slug, model from manager_agents order by slug`;
    expect(managers.map((m) => m.slug)).toEqual(["dex-okoro", "ines-varga", "marta-sol", "theo-lambert"]);
    const revs = await t.db`select source, version from tactical_revisions`;
    expect(revs).toHaveLength(4);
    expect(revs.every((r) => r.source === "seed" && r.version === 1)).toBe(true);
  });

  it("pre-match: grounded prompt → validated revision deployed, full audit stored, idempotent", async () => {
    const { llm, calls } = scripted(offlineManagerLlm(MODEL), (_n, out) => out);
    const team = ctx.fixture.home_team_id;
    const out = await runPreMatch({ db: t.db, llm }, ctx.fixture.id, team);
    expect(out).toMatchObject({ status: "deployed", version: 2 });
    const req = calls[0]!;
    expect(req.system).toContain("Only use the facts provided");
    expect(req.prompt).toContain("Round 1");
    expect(req.prompt).toContain("Squad (shirt · name · position)");
    const [run] = await t.db`select * from agent_runs where idempotency_key like ${`%${ctx.fixture.id}:${team}`}`;
    expect(run).toMatchObject({ status: "succeeded", provider: "offline", model: `offline:${MODEL}`, attempt: 1 });
    expect(run!.input_tokens).toBeGreaterThan(0);
    expect(run!.cost_micro_usd).toBeGreaterThan(0);
    expect(run!.prompt.user).toBe(req.prompt);
    const rev = await latestValidRevision(t.db, team, ctx.seasonId);
    expect(rev).toMatchObject({ version: 2, source: "manager", agentRunId: run!.id, fixtureId: ctx.fixture.id });
    expect(await runPreMatch({ db: t.db, llm }, ctx.fixture.id, team)).toEqual({ status: "already-done" });
    expect(calls).toHaveLength(1);
  });

  it("an invalid proposal gets one repair attempt; if still invalid the last valid tactics stay", async () => {
    const team = ctx.fixture.away_team_id;
    const before = await latestValidRevision(t.db, team, ctx.seasonId);
    const bad = (o: unknown) => ({ ...(o as PreMatchDecision), starters: [2, 3, 4, 5, 6] }); // no goalkeeper
    const { llm, calls } = scripted(offlineManagerLlm(MODEL), (_n, o) => bad(o));
    const out = await runPreMatch({ db: t.db, llm }, ctx.fixture.id, team);
    expect(out.status).toBe("rejected");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.prompt).toContain("Your previous proposal was rejected");
    expect((await latestValidRevision(t.db, team, ctx.seasonId))!.id).toBe(before!.id);
    const rejected =
      await t.db`select status, validation_errors from tactical_revisions where team_id = ${team} and status = 'rejected'`;
    expect(rejected).toHaveLength(2);
    const [run] =
      await t.db`select status, error, input_tokens from agent_runs where idempotency_key like ${`%${ctx.fixture.id}:${team}`}`;
    expect(run!.status).toBe("failed");
    expect(run!.error).toMatch(/slot 1 must be a goalkeeper/);
  });

  it("a repaired proposal is deployed", async () => {
    const t2 = await createTestDatabase();
    try {
      const c = await setup(t2);
      const { llm, calls } = scripted(offlineManagerLlm(MODEL), (n, o) =>
        n === 1 ? { ...(o as PreMatchDecision), starters: [1, 1, 2, 3, 4] } : o,
      );
      expect((await runPreMatch({ db: t2.db, llm }, c.fixture.id, c.fixture.home_team_id)).status).toBe("deployed");
      expect(calls).toHaveLength(2);
    } finally {
      await t2.drop();
    }
  });

  it("LLM errors fail the attempt (job retries); a later attempt succeeds on the same run", async () => {
    const t3 = await createTestDatabase();
    try {
      const c = await setup(t3);
      let fail = true;
      const flaky: LlmClient = {
        provider: "offline",
        model: `offline:${MODEL}`,
        async complete(r) {
          if (fail) throw new Error("overloaded");
          return offlineManagerLlm(MODEL).complete(r);
        },
      };
      await expect(runPreMatch({ db: t3.db, llm: flaky }, c.fixture.id, c.fixture.home_team_id)).rejects.toThrow(
        "overloaded",
      );
      fail = false;
      expect((await runPreMatch({ db: t3.db, llm: flaky }, c.fixture.id, c.fixture.home_team_id)).status).toBe(
        "deployed",
      );
      const runs = await t3.db`select status, attempt from agent_runs`;
      expect(runs).toEqual([{ status: "succeeded", attempt: 2 }]);
    } finally {
      await t3.drop();
    }
  });

  it("when the compute gate refuses, the run is skipped without calling the model", async () => {
    const t4 = await createTestDatabase();
    try {
      const c = await setup(t4);
      const broke: ComputeGate = { reserve: async () => false, settle: async () => {}, release: async () => {} };
      const { llm, calls } = scripted(offlineManagerLlm(MODEL), (_n, o) => o);
      expect(await runPreMatch({ db: t4.db, llm, gate: broke }, c.fixture.id, c.fixture.home_team_id)).toEqual({
        status: "skipped-budget",
      });
      expect(calls).toHaveLength(0);
      const [run] = await t4.db`select status, error, cost_micro_usd from agent_runs`;
      expect(run).toMatchObject({ status: "skipped_budget", cost_micro_usd: 0 });
      expect((await latestValidRevision(t4.db, c.fixture.home_team_id, c.seasonId))!.version).toBe(1);
    } finally {
      await t4.drop();
    }
  });
});

describe("a season managed by AI managers", () => {
  let t: TestDatabase;
  let seasonId: string;
  const llmCalls: Array<{ task: string; at: number }> = [];
  beforeAll(async () => {
    t = await createTestDatabase();
    ({ seasonId } = await setup(t));
    const base = offlineManagerLlm(MODEL);
    const llm: LlmClient = {
      provider: base.provider,
      model: base.model,
      complete: (r) => {
        llmCalls.push({ task: r.task, at: Date.now() });
        return base.complete(r);
      },
    };
    const worker = createWorker({
      db: t.db,
      handlers: buildHandlers({ db: t.db, store: new MemoryReplayStore(), llm, halfDurationSec: 10 }),
    });
    const hook = managerRoundHook(t.db);
    for (let i = 0; i < 100; i++) {
      const a = await advanceSeason(t.db, seasonId, { beforeRound: hook });
      if (a.state === "completed") break;
      await worker.drain();
    }
  }, 180_000);
  afterAll(async () => {
    await t.drop();
  });

  it("every team runs a pre-match decision and a post-match review for each of its six matches", async () => {
    const [s] = await t.db`select status from seasons where id = ${seasonId}`;
    expect(s!.status).toBe("completed");
    const runs = await t.db<{ purpose: string; n: number }[]>`
      select purpose, count(*)::int as n from agent_runs where status = 'succeeded' group by purpose order by purpose`;
    expect(runs).toEqual([
      { purpose: "post_match", n: 24 },
      { purpose: "pre_match", n: 24 },
    ]);
  });

  it("no LLM call happens while a match is being simulated", async () => {
    const rows = await t.db<
      { fixture_id: string; started_at: Date; completed_at: Date }[]
    >`select fixture_id, started_at, completed_at from matches`;
    const pre = await t.db<
      { fixture_id: string; finished_at: Date }[]
    >`select fixture_id, finished_at from agent_runs where purpose = 'pre_match'`;
    const post = await t.db<
      { fixture_id: string; started_at: Date }[]
    >`select fixture_id, started_at from agent_runs where purpose = 'post_match'`;
    for (const m of rows) {
      for (const r of pre.filter((p) => p.fixture_id === m.fixture_id))
        expect(r.finished_at.getTime()).toBeLessThanOrEqual(m.started_at.getTime());
      for (const r of post.filter((p) => p.fixture_id === m.fixture_id))
        expect(r.started_at.getTime()).toBeGreaterThanOrEqual(m.completed_at.getTime());
      for (const c of llmCalls) expect(c.at > m.started_at.getTime() && c.at < m.completed_at.getTime()).toBe(false);
    }
  });

  it("managers adapt: matches deploy manager revisions and memory accumulates grounded notes", async () => {
    const used = await t.db<{ n: number }[]>`
      select count(*)::int as n from matches m join tactical_revisions r on r.id in (m.home_revision_id, m.away_revision_id) where r.source = 'manager'`;
    expect(used[0]!.n).toBe(24);
    const distinct = await t.db<{ n: number }[]>`
      select count(distinct deployment)::int as n from tactical_revisions where status = 'valid'`;
    expect(distinct[0]!.n).toBeGreaterThan(4); // at least one manager changed tactics during the season
    const app = createApp({ db: t.db, store: new MemoryReplayStore() });
    const team = TeamDetailResponse.parse(await (await app.request("/api/v1/teams/harbour-city")).json());
    expect(team.manager?.memory.notes.length).toBeGreaterThan(0);
    expect(team.manager?.memory.notes.some((n) => /^R\d/.test(n) || n.startsWith("Lesson after R"))).toBe(true);
    // every note that cites a result matches the official score
    const results = await t.db<{ round: number; home: string; away: string; hs: number; as: number }[]>`
      select f.round, h.name as home, a.name as away, m.home_score as hs, m.away_score as as from matches m
      join fixtures f on f.id = m.fixture_id join teams h on h.id = f.home_team_id join teams a on a.id = f.away_team_id
      where 'Harbour City' in (h.name, a.name)`;
    for (const n of team.manager!.memory.notes.filter((x) => /^R\d/.test(x))) {
      const round = Number(/^R(\d+)/.exec(n)![1]);
      const r = results.find((x) => x.round === round)!;
      const [gf, ga] = r.home === "Harbour City" ? [r.hs, r.as] : [r.as, r.hs];
      expect(n).toContain(`${gf}–${ga}`);
    }
    const runs = AgentRunListResponse.parse(await (await app.request("/api/v1/teams/harbour-city/agent-runs")).json());
    expect(runs.items).toHaveLength(12);
  });

  it("post-match reviews are idempotent", async () => {
    const [run] = await t.db<
      { fixture_id: string; agent_id: string }[]
    >`select fixture_id, agent_id from agent_runs where purpose = 'post_match' limit 1`;
    const [m] = await t.db<{ team_id: string }[]>`select team_id from manager_agents where id = ${run!.agent_id}`;
    expect(await runPostMatch({ db: t.db, llm: offlineManagerLlm(MODEL) }, run!.fixture_id, m!.team_id)).toEqual({
      status: "already-done",
    });
  });
});
