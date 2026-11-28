/**
 * The private Phase 2 pilot (#101): a new league founded and run by the 20 qualified models, LIVE,
 * on an isolated database with an accelerated clock, through the production scheduler, job worker
 * and rules: founding, the talent pool and three recruitment rounds, the safety net, the season with
 * both market windows, the lender, then rollover/1 into the next season.
 *
 *   with-anthropic-token with-openai-token with-openrouter-token \
 *     env DATABASE_URL=postgres://…/autosoccer_pilot PILOT_CAP_USD=50 bun scripts/phase2-pilot.ts
 *
 * Spend is bounded twice: every manager call reserves its worst case against the club's season
 * budget (the production compute ledger), and every live call also counts against the pilot's hard
 * cap. A manager call that the cap can't cover is skipped as out of budget (the club keeps its last
 * valid decision, as in production); once the cap is spent, the pilot stops.
 *
 * Stop conditions: spend at the cap; a season blocked by a failed match; the time limit; or an
 * invariant failure (checked after every tick). Evidence goes to out/pilot/ (not committed):
 * calls.jsonl (one line per model call), ticks.log, report.json and report.md.
 *
 * Refuses to run against a database whose name doesn't contain "pilot": never production. No
 * newsroom calls (journalists are excluded: the newsroom's spend is measured on the live site).
 *
 * Settings (env): PILOT_CAP_USD (default 50), PILOT_SEASONS (2), PILOT_BUDGET_PER_CLUB_USD (5),
 * PILOT_HOURS (8, the wall-clock limit), PILOT_WORKERS (10), PILOT_SEED (2027).
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createDb, type Db, migrate } from "@autosoccer/db";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { buildHandlers } from "../apps/server/src/jobs/handlers.ts";
import { createWorker } from "../apps/server/src/jobs/worker.ts";
import type { LlmClient, LlmRequest } from "../apps/server/src/modules/agents/llm.ts";
import { offlineManagerLlm } from "../apps/server/src/modules/agents/offline.ts";
import { costMicroUsd } from "../apps/server/src/modules/agents/pricing.ts";
import type { ComputeGate } from "../apps/server/src/modules/agents/service.ts";
import { startInaugural, tickInaugural } from "../apps/server/src/modules/founding/inaugural.ts";
import { offlineFounder } from "../apps/server/src/modules/founding/offline.ts";
import { apply, leagueBySlug } from "../apps/server/src/modules/league/leagues.ts";
import { ledgerGate } from "../apps/server/src/modules/ledger/service.ts";
import { llmForModel } from "../apps/server/src/modules/models/gateway.ts";
import { modelBySlug, REGISTRY } from "../apps/server/src/modules/models/registry.ts";
import { schedulerTick } from "../apps/server/src/modules/ops/scheduler.ts";

const url = process.env.DATABASE_URL ?? "";
if (!/pilot/.test(new URL(url).pathname)) {
  console.error("refusing: DATABASE_URL must name a pilot database (never production)");
  process.exit(2);
}
const CAP = Math.round(Number(process.env.PILOT_CAP_USD ?? 50) * 1e6);
const SEASONS = Number(process.env.PILOT_SEASONS ?? 2);
const BUDGET = Math.round(Number(process.env.PILOT_BUDGET_PER_CLUB_USD ?? 5) * 1e6);
const DEADLINE = Date.now() + Number(process.env.PILOT_HOURS ?? 8) * 3_600_000;
const WORKERS = Number(process.env.PILOT_WORKERS ?? 10);
const SEED = Number(process.env.PILOT_SEED ?? 2027);
/** PILOT_OFFLINE=1: the same run with the offline stand-ins (no model calls), to rehearse the plumbing. */
const OFFLINE = process.env.PILOT_OFFLINE === "1";
const LEAGUE = "pilot";
const OUT = process.env.PILOT_OUT ?? "out/pilot";
mkdirSync(OUT, { recursive: true });

// ---- Metering: every live call, against the hard cap ------------------------------------------
let spent = 0; // micro-USD, settled calls plus the worst case of calls in flight
let inFlight = 0;
let stopReason: string | null = null;
const log = (line: string) => {
  const s = `${new Date().toISOString()} ${line}`;
  console.log(s);
  appendFileSync(`${OUT}/ticks.log`, `${s}\n`);
};
/** Every live model is priced (registry); only the offline founder stand-in isn't, and costs nothing. */
const price = (model: string, input: number, output: number) => {
  if (!OFFLINE) return costMicroUsd(model, input, output);
  try {
    return costMicroUsd(model, input, output);
  } catch {
    return 0;
  }
};
const worstCase = (model: string, req: LlmRequest<unknown>) =>
  price(
    model,
    Math.ceil((req.system.length + req.prompt.length) / 3) * 3,
    (Math.max(req.maxTokens ?? 4000, modelBySlug(model)?.maxOutputTokens ?? 0) + 200) * 3,
  );

class PilotCapReached extends Error {}

function metered(inner: LlmClient): LlmClient {
  return {
    provider: inner.provider,
    model: inner.model,
    async complete(req) {
      // Three attempts at most (an answer and two repairs): reserve all of them.
      const est = worstCase(inner.model, req as LlmRequest<unknown>);
      if (stopReason || spent + inFlight + est > CAP) {
        stopReason ??= "spend cap reached";
        throw new PilotCapReached(`pilot cap: ${(spent / 1e6).toFixed(2)} of ${(CAP / 1e6).toFixed(2)} USD spent`);
      }
      inFlight += est;
      const t0 = Date.now();
      const g = inner as LlmClient & { lastAttempts?: number; lastRepairs?: number; lastFixes?: string[] };
      try {
        const r = await inner.complete(req);
        const cost = price(inner.model, r.inputTokens, r.outputTokens);
        spent += cost;
        appendFileSync(
          `${OUT}/calls.jsonl`,
          `${JSON.stringify({
            at: new Date(t0).toISOString(),
            model: inner.model,
            task: req.task,
            ok: true,
            ms: Date.now() - t0,
            in: r.inputTokens,
            out: r.outputTokens,
            usd: cost / 1e6,
            attempts: g.lastAttempts ?? 1,
            repairs: g.lastRepairs ?? 0,
            fixes: g.lastFixes ?? [],
          })}\n`,
        );
        return r;
      } catch (e) {
        // Tokens of a failed call aren't reported. A provider's refusal (an HTTP 4xx other than a
        // timeout, e.g. an account's daily budget) generated nothing and costs nothing; anything else
        // (a timeout, a cut-off answer) counts half its worst case, to stay on the safe side.
        const refused = /HTTP 4(?!08)\d\d/.test(String((e as Error).message));
        const charged = refused ? 0 : Math.round(est / 2);
        spent += charged;
        appendFileSync(
          `${OUT}/calls.jsonl`,
          `${JSON.stringify({
            at: new Date(t0).toISOString(),
            model: inner.model,
            task: req.task,
            ok: false,
            ms: Date.now() - t0,
            usd: charged / 1e6,
            refused,
            attempts: g.lastAttempts ?? 1,
            error: String((e as Error).message).slice(0, 300),
          })}\n`,
        );
        throw e;
      } finally {
        inFlight -= est;
      }
    },
  };
}

const clients = new Map<string, LlmClient>();
const llmFor = (model: string): LlmClient => {
  const hit = clients.get(model);
  if (hit) return hit;
  const spec = modelBySlug(model);
  if (!spec) throw new Error(`not a registry model: ${model}`);
  const c = metered(OFFLINE ? offlineManagerLlm(model) : llmForModel(spec, process.env));
  clients.set(model, c);
  return c;
};
// The production compute ledger, plus the pilot cap: a call the cap can't cover is skipped as out of budget.
const cappedGate = (db: Db): ComputeGate => {
  const inner = ledgerGate(db);
  return {
    reserve: async (a) => (stopReason || spent + inFlight + a.estimateMicroUsd > CAP ? false : inner.reserve(a)),
    settle: (a) => inner.settle(a),
    release: (a) => inner.release(a),
  };
};

// ---- Invariants, after every tick -------------------------------------------------------------
async function invariants(db: Db, leagueId: string): Promise<string[]> {
  const bad: string[] = [];
  const [r] = await db<{ dup: number; reg: number; failed: number; over: number }[]>`
    select
      (select count(*)::int from (select player_id from player_contracts where status = 'active' group by player_id having count(*) > 1) x) as dup,
      (select count(*)::int from (select r.season_id, r.player_id from player_registrations r group by 1, 2 having count(*) > 1) x) as reg,
      (select count(*)::int from fixtures f join seasons s on s.id = f.season_id
        where s.league_id = ${leagueId} and f.status = 'failed') as failed,
      (select count(*)::int from (select c.season_id, c.team_id from compute_transactions c join seasons s on s.id = c.season_id
        where s.league_id = ${leagueId} group by 1, 2 having sum(c.amount_micro_usd) < 0) x) as over`;
  if (r!.dup) bad.push(`${r!.dup} players with two active contracts`);
  if (r!.reg) bad.push(`${r!.reg} duplicate registrations`);
  if (r!.failed) bad.push(`${r!.failed} failed fixtures`);
  if (r!.over) bad.push(`${r!.over} clubs over their season compute budget`);
  return bad;
}

// ---- The run ----------------------------------------------------------------------------------
const db = createDb(url, { max: WORKERS + 6 });
await migrate(db);
const MODELS = REGISTRY.filter((m) => m.status !== "reserve").map((m) => m.slug);
if (!(await leagueBySlug(db, LEAGUE)))
  await apply(db, "create", { slug: LEAGUE, confirm: LEAGUE, name: "The Pilot League" });
const league = (await leagueBySlug(db, LEAGUE))!;
// The clock starts now and runs fast: every tick moves it on by STEP (deadlines and kickoffs follow it).
const [prior] = await db<
  { opens: string | null }[]
>`select inaugural->>'opens' as opens from leagues where id = ${league.id}`;
const T0 = prior?.opens ? new Date(prior.opens) : new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000);
await startInaugural(db, LEAGUE, { opens: T0, seed: SEED, models: MODELS, budgetPerTeamMicroUsd: BUDGET });
const handlers = buildHandlers({
  db,
  store: new MemoryReplayStore(),
  llm: llmFor(MODELS[0]!),
  llmFor,
  ...(OFFLINE ? { founderLlmFor: () => metered(offlineFounder()) } : {}),
  gate: cappedGate(db),
});
const workers = Array.from({ length: WORKERS }, (_, i) =>
  createWorker({ db, handlers, workerId: `pilot-${i}`, baseBackoffMs: 2_000 }),
);
const drainAll = async () => {
  for (let pass = 0; pass < 50; pass++) {
    const done = await Promise.all(workers.map((w) => w.drain(5)));
    if (done.every((d) => !d.length)) return;
  }
};

let now = new Date(T0.getTime() + 60_000);
const STEP = 30 * 60_000;
let activated = false;
let lastState = "";
log(
  `pilot${OFFLINE ? " (OFFLINE rehearsal)" : " (LIVE)"}: ${MODELS.length} models, cap $${CAP / 1e6}, budget $${BUDGET / 1e6}/club/season, ${SEASONS} seasons`,
);
for (let tick = 0; ; tick++) {
  if (Date.now() > DEADLINE) {
    stopReason ??= "time limit";
    break;
  }
  if (stopReason) break;
  const res = await schedulerTick(db, { respectSchedule: true, now });
  await drainAll();
  if (!activated) {
    const [t] = await tickInaugural(db, { now });
    if (t && `${t.state}:${t.detail}` !== lastState) log(`inaugural: ${t.state} (${t.detail})`);
    lastState = t ? `${t.state}:${t.detail}` : lastState;
    if (t?.state === "ready") {
      await apply(db, "activate", { slug: LEAGUE, confirm: LEAGUE });
      activated = true;
      log("league activated");
    }
    if (t?.state === "waiting") {
      stopReason = `inaugural phase stalled: ${t.detail}`;
      break;
    }
  }
  for (const s of res.seasons) {
    const msg = `${s.slug}: ${s.result.state}${"round" in s.result ? ` round ${s.result.round}` : ""}`;
    if (msg !== lastState) log(msg);
    lastState = msg;
    if (s.result.state === "blocked") stopReason = `season blocked: ${s.slug}`;
  }
  const bad = await invariants(db, league.id);
  if (bad.length) stopReason = `invariant failed: ${bad.join("; ")}`;
  const [seasons] = await db<{ done: number }[]>`
    select count(*) filter (where status = 'completed')::int as done from seasons where league_id = ${league.id}`;
  if (seasons!.done >= SEASONS) break;
  if (tick % 20 === 0)
    log(`spent $${(spent / 1e6).toFixed(2)} (in flight $${(inFlight / 1e6).toFixed(2)}), clock ${now.toISOString()}`);
  now = new Date(now.getTime() + STEP);
}
log(`stopped: ${stopReason ?? `${SEASONS} seasons complete`}; spent $${(spent / 1e6).toFixed(2)}`);
writeFileSync(`${OUT}/stop.json`, JSON.stringify({ stopReason, spentUsd: spent / 1e6, capUsd: CAP / 1e6, clock: now }));
await db.end();
process.exit(stopReason && !/time limit|spend cap/.test(stopReason) ? 1 : 0);
