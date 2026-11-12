import type { Db } from "@autosoccer/db";
import { enqueue } from "../../jobs/queue.ts";
import { PermanentJobError } from "../../jobs/worker.ts";
import type { Logger } from "../../log.ts";
import { seasonTeamSize } from "../league/read.ts";
import { type PlayerRow, toPlayer } from "../mappers.ts";
import { defaultLineup } from "../matches/lineup.ts";
import { createRevision, latestValidRevision, tacticalDeployment } from "../tactics/service.ts";
import { type FixtureCtx, type ManagerRow, managerFacts, postMatchFacts } from "./facts.ts";
import type { LlmClient, LlmResponse } from "./llm.ts";
import { openingTactics, SEED_MANAGERS } from "./managers-seed.ts";
import { costMicroUsd } from "./pricing.ts";
import {
  managerSystem,
  PostMatchReview,
  type PreMatchDecision,
  postMatchPrompt,
  preMatchDecision,
  preMatchPrompt,
} from "./prompts.ts";

export const PRE_MATCH_JOB = "manager.pre_match";
export const POST_MATCH_JOB = "manager.post_match";
export const preKey = (fixtureId: string, teamId: string) => `${PRE_MATCH_JOB}:${fixtureId}:${teamId}`;
export const postKey = (fixtureId: string, teamId: string) => `${POST_MATCH_JOB}:${fixtureId}:${teamId}`;

/**
 * Spend control hook. The compute ledger (#24) implements it; the default allows everything.
 * `reserve` must be atomic: it returns false when the team can't cover the estimate.
 */
export interface ComputeGate {
  reserve(a: { seasonId: string; teamId: string; runId: string; estimateMicroUsd: number }): Promise<boolean>;
  settle(a: {
    seasonId: string;
    teamId: string;
    runId: string;
    costMicroUsd: number;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }): Promise<void>;
  release(a: { seasonId: string; teamId: string; runId: string }): Promise<void>;
}
export const unlimitedGate: ComputeGate = {
  reserve: async () => true,
  settle: async () => {},
  release: async () => {},
};

export interface ManagerDeps {
  db: Db;
  llm: LlmClient;
  gate?: ComputeGate;
  log?: Logger;
  /** Upper bound on output tokens per call, used for the spend reservation. */
  maxOutputTokens?: number;
}

/** Creates the four managers and their opening (v1) tactics for a season. Idempotent. */
export async function seedManagers(db: Db, seasonId: string, model: string) {
  for (const m of SEED_MANAGERS) {
    const [team] = await db<{ id: string }[]>`select id from teams where slug = ${m.teamSlug}`;
    if (!team) continue;
    await db`
      insert into manager_agents (team_id, slug, name, persona, philosophy, model)
      values (${team.id}, ${m.slug}, ${m.name}, ${m.persona}, ${m.philosophy}, ${model})
      on conflict (team_id) do nothing`;
    if (!(await latestValidRevision(db, team.id, seasonId))) {
      const squad = (await db<PlayerRow[]>`select * from players where team_id = ${team.id}`).map(toPlayer);
      const size = await seasonTeamSize(db, seasonId);
      await createRevision(db, {
        teamId: team.id,
        seasonId,
        source: "seed",
        deployment: tacticalDeployment(openingTactics(m, size)),
        starters: defaultLineup(squad, size).starters,
        rationale: `Opening setup: ${m.philosophy}`,
      });
    }
  }
}

interface RunRow {
  id: string;
  status: string;
  attempt: number;
}

type RunStart = { run: RunRow; done: false } | { run: RunRow; done: true };

/** Idempotent agent-run bookkeeping: one row per idempotency key, attempts counted. */
async function startRun(
  db: Db,
  a: { key: string; agentId: string; purpose: "pre_match" | "post_match"; seasonId: string; fixtureId: string },
): Promise<RunStart> {
  await db`
    insert into agent_runs (agent_kind, agent_id, purpose, season_id, fixture_id, idempotency_key)
    values ('manager', ${a.agentId}, ${a.purpose}, ${a.seasonId}, ${a.fixtureId}, ${a.key})
    on conflict (idempotency_key) do nothing`;
  const [run] = await db<RunRow[]>`select id, status, attempt from agent_runs where idempotency_key = ${a.key}`;
  if (run!.status === "succeeded" || run!.status === "skipped_budget") return { run: run!, done: true };
  const [started] = await db<RunRow[]>`
    update agent_runs set status = 'running', attempt = attempt + 1, started_at = now(), error = null
    where id = ${run!.id} returning id, status, attempt`;
  return { run: started!, done: false };
}

async function finishRun(
  db: Db,
  runId: string,
  f: {
    status: "succeeded" | "failed" | "skipped_budget";
    prompt?: unknown;
    output?: unknown;
    usage?: Usage;
    error?: string | null;
  },
) {
  const u = f.usage;
  await db`
    update agent_runs set status = ${f.status}, prompt = ${f.prompt === undefined ? null : db.json(f.prompt as never)},
      output = ${f.output === undefined ? null : db.json(f.output as never)},
      provider = ${u?.provider ?? null}, model = ${u?.model ?? null},
      input_tokens = ${u?.inputTokens ?? 0}, output_tokens = ${u?.outputTokens ?? 0}, cost_micro_usd = ${u?.costMicroUsd ?? 0},
      error = ${f.error ?? null}, finished_at = now()
    where id = ${runId}`;
}

interface Usage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
}
const addUsage = (u: Usage | null, r: LlmResponse<unknown>): Usage => {
  const inputTokens = (u?.inputTokens ?? 0) + r.inputTokens;
  const outputTokens = (u?.outputTokens ?? 0) + r.outputTokens;
  return {
    provider: r.provider,
    model: r.model,
    inputTokens,
    outputTokens,
    costMicroUsd: costMicroUsd(r.model, inputTokens, outputTokens),
  };
};

async function loadContext(db: Db, fixtureId: string, teamId: string) {
  const [fixture] = await db<
    FixtureCtx[]
  >`select id, season_id, round, home_team_id, away_team_id from fixtures where id = ${fixtureId}`;
  if (!fixture) throw new PermanentJobError(`fixture ${fixtureId} not found`);
  if (teamId !== fixture.home_team_id && teamId !== fixture.away_team_id)
    throw new PermanentJobError("team is not in this fixture");
  const [manager] = await db<ManagerRow[]>`select * from manager_agents where team_id = ${teamId}`;
  if (!manager) throw new PermanentJobError(`team ${teamId} has no manager`);
  return { fixture, manager };
}

/** Reserve the worst-case cost of a call before making it; false ⇒ skip (budget exhausted). */
async function reserveFor(
  deps: ManagerDeps,
  ids: { seasonId: string; teamId: string; runId: string },
  system: string,
  prompt: string,
  calls = 1,
) {
  const estIn = Math.ceil((system.length + prompt.length) / 3) * calls;
  const estOut = maxOut(deps) * calls;
  return (deps.gate ?? unlimitedGate).reserve({
    ...ids,
    estimateMicroUsd: costMicroUsd(deps.llm.model, estIn, estOut),
  });
}

export type PreMatchOutcome =
  | { status: "already-done" }
  | { status: "deployed"; revisionId: string; version: number }
  | { status: "rejected"; errors: string[] }
  | { status: "skipped-budget" };

/**
 * Pre-match decision: build grounded facts → ask the manager → validate → store a revision.
 * One repair attempt if the proposal is invalid. On rejection, budget exhaustion or failure
 * the team keeps its last valid tactics (matches always use the latest valid revision).
 * Never runs during a simulation: it's a separate job before the round is released.
 */
export async function runPreMatch(deps: ManagerDeps, fixtureId: string, teamId: string): Promise<PreMatchOutcome> {
  const { db, llm } = deps;
  const gate = deps.gate ?? unlimitedGate;
  const { fixture, manager } = await loadContext(db, fixtureId, teamId);
  const start = await startRun(db, {
    key: preKey(fixtureId, teamId),
    agentId: manager.id,
    purpose: "pre_match",
    seasonId: fixture.season_id,
    fixtureId,
  });
  if (start.done) return { status: "already-done" };
  const run = start.run;
  const ids = { seasonId: fixture.season_id, teamId, runId: run.id };

  const facts = await managerFacts(db, fixture, teamId, manager, { includeRound: false });
  const system = managerSystem(facts.manager, facts.team.name, facts.format.playersPerTeam);
  const prompt = preMatchPrompt(facts);
  const decisionSchema = preMatchDecision(facts.format.playersPerTeam);
  const audit: { system: string; user: string; repair?: string } = { system, user: prompt };

  if (!(await reserveFor(deps, ids, system, prompt))) {
    await finishRun(db, run.id, {
      status: "skipped_budget",
      prompt: audit,
      error: "season compute budget exhausted; keeping last valid tactics",
    });
    deps.log?.info("pre-match skipped: budget", { team: facts.team.name, fixtureId });
    return { status: "skipped-budget" };
  }

  let usage: Usage | null = null;
  try {
    const squad = (await db<PlayerRow[]>`select * from players where team_id = ${teamId}`).map(toPlayer);
    const byShirt = new Map(squad.map((p) => [p.shirtNumber, p.id]));
    let res = await llm.complete({
      system,
      prompt,
      schema: decisionSchema,
      task: "manager.pre_match",
      context: facts,
      maxTokens: maxOut(deps),
    });
    usage = addUsage(usage, res);
    const propose = (d: PreMatchDecision) =>
      createRevision(db, {
        teamId,
        seasonId: fixture.season_id,
        fixtureId,
        source: "manager",
        agentRunId: run.id,
        rationale: d.rationale,
        deployment: tacticalDeployment(d.tactics),
        starters: d.starters.map((n) => byShirt.get(n) ?? `unknown-shirt-${n}`),
      });
    let rev = await propose(res.output);
    const repair = `${prompt}\n\nYour previous proposal was rejected:\n${rev.validationErrors.map((e) => `- ${e}`).join("\n")}\nFix these problems and answer again.`;
    // The repair call is a second model call: it needs its own reservation (first hold still covers call one).
    if (rev.status === "rejected" && (await reserveFor(deps, ids, system, repair))) {
      audit.repair = repair;
      res = await llm.complete({
        system,
        prompt: repair,
        schema: decisionSchema,
        task: "manager.pre_match",
        context: facts,
        maxTokens: maxOut(deps),
      });
      usage = addUsage(usage, res);
      rev = await propose(res.output);
    }
    await gate.settle({ ...ids, ...usage });
    if (rev.status === "rejected") {
      await finishRun(db, run.id, {
        status: "failed",
        prompt: audit,
        output: res.output,
        usage,
        error: `proposal rejected: ${rev.validationErrors.join("; ")}`,
      });
      return { status: "rejected", errors: rev.validationErrors };
    }
    await finishRun(db, run.id, { status: "succeeded", prompt: audit, output: res.output, usage });
    deps.log?.info("pre-match deployed", { team: facts.team.name, version: rev.version });
    return { status: "deployed", revisionId: rev.id, version: rev.version };
  } catch (e) {
    if (usage) await gate.settle({ ...ids, ...usage });
    else await gate.release(ids);
    await finishRun(db, run.id, {
      status: "failed",
      prompt: audit,
      usage: usage ?? undefined,
      error: (e as Error).message,
    });
    throw e;
  }
}

export type PostMatchOutcome = { status: "already-done" } | { status: "reviewed" } | { status: "skipped-budget" };

/** Post-match review: official result + stats → manager → memory rewrite (persisted). */
export async function runPostMatch(deps: ManagerDeps, fixtureId: string, teamId: string): Promise<PostMatchOutcome> {
  const { db, llm } = deps;
  const gate = deps.gate ?? unlimitedGate;
  const { fixture, manager } = await loadContext(db, fixtureId, teamId);
  const start = await startRun(db, {
    key: postKey(fixtureId, teamId),
    agentId: manager.id,
    purpose: "post_match",
    seasonId: fixture.season_id,
    fixtureId,
  });
  if (start.done) return { status: "already-done" };
  const run = start.run;
  const ids = { seasonId: fixture.season_id, teamId, runId: run.id };

  const facts = await postMatchFacts(db, fixture, teamId, manager);
  const system = managerSystem(facts.manager, facts.team.name, facts.format.playersPerTeam);
  const prompt = postMatchPrompt(facts);
  const audit = { system, user: prompt };
  if (!(await reserveFor(deps, ids, system, prompt))) {
    await finishRun(db, run.id, {
      status: "skipped_budget",
      prompt: audit,
      error: "season compute budget exhausted; memory not updated",
    });
    return { status: "skipped-budget" };
  }
  try {
    const res = await llm.complete({
      system,
      prompt,
      schema: PostMatchReview,
      task: "manager.post_match",
      context: facts,
      maxTokens: maxOut(deps),
    });
    const usage = addUsage(null, res);
    await gate.settle({ ...ids, ...usage });
    const memory = {
      summary: res.output.summary,
      notes: [...res.output.notes.slice(0, 5), `Lesson after R${fixture.round}: ${res.output.lesson}`].slice(0, 6),
      updatedAt: new Date().toISOString(),
    };
    await db.begin(async (tx) => {
      await tx`update manager_agents set memory = ${tx.json(memory)}, updated_at = now() where id = ${manager.id}`;
      await tx`
        update agent_runs set status = 'succeeded', prompt = ${tx.json(audit)}, output = ${tx.json(res.output as never)},
          provider = ${usage.provider}, model = ${usage.model}, input_tokens = ${usage.inputTokens},
          output_tokens = ${usage.outputTokens}, cost_micro_usd = ${usage.costMicroUsd}, finished_at = now()
        where id = ${run.id}`;
    });
    return { status: "reviewed" };
  } catch (e) {
    await gate.release(ids);
    await finishRun(db, run.id, { status: "failed", prompt: audit, error: (e as Error).message });
    throw e;
  }
}

/** Jobs: one per (fixture, team, phase), idempotent by key. */
export async function enqueueManagerJobs(db: Db, phase: "pre" | "post", fixtureId: string) {
  const [f] = await db<
    { home_team_id: string; away_team_id: string }[]
  >`select home_team_id, away_team_id from fixtures where id = ${fixtureId}`;
  const teams = await db<{ team_id: string }[]>`
    select team_id from manager_agents where team_id in (${f!.home_team_id}, ${f!.away_team_id})`;
  for (const { team_id } of teams) {
    const kind = phase === "pre" ? PRE_MATCH_JOB : POST_MATCH_JOB;
    await enqueue(db, {
      kind,
      key: phase === "pre" ? preKey(fixtureId, team_id) : postKey(fixtureId, team_id),
      payload: { fixtureId, teamId: team_id },
      maxAttempts: 3,
    });
  }
  return teams.length;
}

/**
 * Round gate for the scheduler: enqueue every pre-match decision for the round, and
 * release the round only when all of them have finished (succeeded or failed — a failed
 * manager plays its last valid tactics, it never blocks the league).
 */
export function managerRoundHook(db: Db) {
  return async (_round: number, fixtureIds: string[]) => {
    for (const id of fixtureIds) await enqueueManagerJobs(db, "pre", id);
    const [pending] = await db<{ n: number }[]>`
      select count(*)::int as n from jobs where kind = ${PRE_MATCH_JOB}
        and (payload->>'fixtureId') = any(${fixtureIds}) and status in ('queued', 'running')`;
    return pending!.n === 0;
  };
}

export function managerJobHandlers(deps: ManagerDeps) {
  const ids = (p: Record<string, unknown>) => [String(p.fixtureId), String(p.teamId)] as const;
  return {
    [PRE_MATCH_JOB]: async (job: { payload: Record<string, unknown> }) => {
      const out = await runPreMatch(deps, ...ids(job.payload));
      return {
        result: out,
        artifacts: out.status === "deployed" ? [{ kind: "tactical_revision", id: out.revisionId }] : [],
      };
    },
    [POST_MATCH_JOB]: async (job: { payload: Record<string, unknown> }) => ({
      result: await runPostMatch(deps, ...ids(job.payload)),
    }),
  };
}

/**
 * Output-token cap per model call. It's both sent as `max_tokens` and used for the spend
 * reservation, so a reservation is a true worst case (thinking tokens count as output).
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4000;
function maxOut(deps: ManagerDeps) {
  return deps.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
}

/** Worst-case reservation for one manager model call (~2k-token prompt, full output cap). */
export const worstCaseDecisionMicroUsd = (model: string) => costMicroUsd(model, 2000, DEFAULT_MAX_OUTPUT_TOKENS);
