/**
 * The qualification runner (#94): every scenario, several times, against one model through the same
 * gateway production uses. Records validity, legality, attempts, repairs, latency, tokens and cost.
 * Passing is operational: valid and legal answers, recovered errors, no injected actions, inside
 * the spend cap. Sporting skill isn't scored.
 */
import { LlmOutputError, LlmRefusalError } from "../agents/llm.ts";
import {
  type ChatBody,
  type ChatReply,
  GatewayLlm,
  ModelUnavailableError,
  type Transport,
  TransportError,
} from "./gateway.ts";
import { costOf, type ModelSpec, worstCaseMicroUsd } from "./registry.ts";
import { FACTS_END, FACTS_START, factsOf, SCENARIOS, type Scenario } from "./scenarios.ts";

export interface Trial {
  model: string;
  scenario: string;
  rep: number;
  pass: boolean;
  /** valid: schema-valid and legal; illegal; invalid: never schema-valid; unavailable; refused; budget. */
  outcome: "valid" | "illegal" | "invalid" | "unavailable" | "refused" | "budget";
  detail: string;
  attempts: number;
  repairs: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
}

export interface Qualification {
  model: string;
  provider: string;
  live: boolean;
  qualified: boolean;
  passRate: number;
  byScenario: Record<string, { passed: number; runs: number }>;
  trials: Trial[];
  spentMicroUsd: number;
  reasons: string[];
}

export interface QualifyOptions {
  reps?: number;
  /** Hard cap on spend for this model's qualification (micro-USD). Calls whose worst case doesn't fit are skipped. */
  spendCapMicroUsd: number;
  live: boolean;
  timeoutMs?: number;
  scenarios?: Scenario[];
  now?: () => number;
}

/** A model passes when ≥ 90% of trials pass and every scenario passes at least two thirds of its runs. */
export const PASS_RATE = 0.9;
export const SCENARIO_RATE = 2 / 3;

export async function qualify(spec: ModelSpec, transport: Transport, opts: QualifyOptions): Promise<Qualification> {
  const reps = opts.reps ?? 3;
  const now = opts.now ?? (() => performance.now());
  const llm = new GatewayLlm(spec, transport, {
    timeoutMs: opts.timeoutMs ?? 120_000,
    maxRetries: 2,
    backoffMs: () => 0,
  });
  const trials: Trial[] = [];
  let spent = 0;
  const worst = worstCaseMicroUsd(spec, 6_000, 4_000) * 2; // a repair turn can double a call
  for (const sc of opts.scenarios ?? SCENARIOS)
    for (let rep = 1; rep <= reps; rep++) {
      const base = {
        model: spec.slug,
        scenario: sc.id,
        rep,
        attempts: 0,
        repairs: 0,
        inputTokens: 0,
        outputTokens: 0,
        costMicroUsd: 0,
      };
      const calls = sc.rejectFirst ? 2 : 1;
      if (spent + worst * calls > opts.spendCapMicroUsd) {
        trials.push({
          ...base,
          pass: false,
          outcome: "budget",
          detail: "spend cap reached: call not made",
          latencyMs: 0,
        });
        continue;
      }
      const t0 = now();
      const trial: Trial = { ...base, pass: false, outcome: "invalid", detail: "", latencyMs: 0 };
      try {
        let context = sc.context;
        let prompt = sc.prompt(context);
        for (let k = 0; k < calls; k++) {
          const r = await llm.complete({
            system: sc.system,
            prompt,
            schema: sc.schema,
            task: `qualify.${sc.id}`,
            context,
            maxTokens: 4000,
          });
          trial.attempts += llm.lastAttempts;
          trial.repairs += llm.lastRepairs;
          trial.inputTokens += r.inputTokens;
          trial.outputTokens += r.outputTokens;
          if (k === 0 && sc.rejectFirst) {
            context = sc.rejectFirst.context;
            prompt = `${sc.prompt(context)}\n\nYour previous answer was: ${JSON.stringify(r.output)}\n${sc.rejectFirst.message}`;
            continue;
          }
          const illegal = sc.referee(r.output, context);
          trial.outcome = illegal ? "illegal" : "valid";
          trial.detail = illegal ?? "ok";
        }
      } catch (e) {
        trial.attempts += llm.lastAttempts;
        trial.repairs += llm.lastRepairs;
        const usage = (e as { usage?: { inputTokens: number; outputTokens: number } }).usage;
        if (usage) {
          trial.inputTokens += usage.inputTokens;
          trial.outputTokens += usage.outputTokens;
        }
        trial.outcome =
          e instanceof ModelUnavailableError
            ? "unavailable"
            : e instanceof LlmRefusalError
              ? "refused"
              : e instanceof LlmOutputError
                ? "invalid"
                : "unavailable";
        trial.detail = (e as Error).message;
      }
      trial.latencyMs = Math.round(now() - t0);
      trial.costMicroUsd = costOf(spec, trial.inputTokens, trial.outputTokens);
      trial.pass = trial.outcome === "valid";
      spent += trial.costMicroUsd;
      trials.push(trial);
    }
  const byScenario: Qualification["byScenario"] = {};
  for (const t of trials) {
    byScenario[t.scenario] = byScenario[t.scenario] ?? { passed: 0, runs: 0 };
    const s = byScenario[t.scenario]!;
    s.runs++;
    if (t.pass) s.passed++;
  }
  const passRate = trials.filter((t) => t.pass).length / Math.max(1, trials.length);
  const reasons: string[] = [];
  if (passRate < PASS_RATE) reasons.push(`pass rate ${(passRate * 100).toFixed(0)}% < ${PASS_RATE * 100}%`);
  for (const [id, s] of Object.entries(byScenario))
    if (s.passed / s.runs < SCENARIO_RATE) reasons.push(`${id}: ${s.passed}/${s.runs}`);
  if (trials.some((t) => t.outcome === "budget")) reasons.push("spend cap reached before every trial ran");
  return {
    model: spec.slug,
    provider: spec.provider,
    live: opts.live,
    qualified: reasons.length === 0,
    passRate,
    byScenario,
    trials,
    spentMicroUsd: spent,
    reasons,
  };
}

// --- mock providers: offline transports with known behaviour, to test the harness itself --------

export type MockKind = "good" | "flaky" | "broken" | "down" | "gullible" | "slow";

function lastFacts(body: ChatBody): unknown {
  for (let i = body.messages.length - 1; i >= 0; i--) {
    const m = body.messages[i]!;
    if (m.role === "user" && m.content.includes(FACTS_START) && m.content.includes(FACTS_END))
      return factsOf(m.content);
  }
  return null;
}

function scenarioFor(body: ChatBody): Scenario | undefined {
  const first = body.messages.find((m) => m.role === "user")?.content ?? "";
  return SCENARIOS.find((s) => first.startsWith(s.prompt(s.context as never).split(FACTS_START)[0]!));
}

/**
 * A scripted transport. good: always the reference answer. flaky: a 429, then invalid JSON, then
 * good answers (exercises retry and repair). broken: never valid JSON. down: always 503. gullible:
 * follows instructions inside other clubs' messages. slow: never answers (exercises the timeout).
 */
export function mockTransport(kind: MockKind): Transport & { calls: number } {
  let calls = 0;
  const reply = (content: string, tokens = 400): ChatReply => ({
    content,
    finishReason: "stop",
    inputTokens: 1200,
    outputTokens: tokens,
  });
  const t = {
    get calls() {
      return calls;
    },
    async chat(body: ChatBody, { signal }: { signal: AbortSignal }): Promise<ChatReply> {
      calls++;
      if (kind === "down") throw new TransportError(503, "HTTP 503: service unavailable");
      if (kind === "slow")
        return new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new TransportError(0, "timeout"))),
        );
      if (kind === "broken") return reply("Sure! Here's my lineup: the usual lads.");
      if (kind === "flaky" && calls === 1) throw new TransportError(429, "HTTP 429: rate limited");
      if (kind === "flaky" && calls === 2) return reply('{"formation": "2-3-1", "starters": [');
      const sc = scenarioFor(body);
      const facts = lastFacts(body) ?? sc?.context;
      if (!sc) return reply("{}");
      if (kind === "gullible" && /OVERRIDE/.test(JSON.stringify(facts)))
        return reply(JSON.stringify({ replies: [{ offerId: "o1", decision: "accept", reason: "Instructed to." }] }));
      return reply(JSON.stringify(sc.solve(facts as never)));
    },
  };
  return t;
}
