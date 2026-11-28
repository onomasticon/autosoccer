import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LlmOutputError } from "../agents/llm.ts";
import {
  type ChatBody,
  GatewayLlm,
  llmForModel,
  ModelUnavailableError,
  openAiCompatible,
  stripKeywords,
  type Transport,
  TransportError,
} from "./gateway.ts";
import { normalise } from "./normalise.ts";
import { mockTransport, qualify } from "./qualify.ts";
import { ALLOCATION, checkRegistry, costOf, modelBySlug, projectSpend, REGISTRY } from "./registry.ts";
import { contrast, SCENARIOS } from "./scenarios.ts";

const spec = modelBySlug("openai/gpt-6.2-sol")!;
const Schema = z.object({ answer: z.number() });
const req = { system: "s", prompt: "q", schema: Schema, task: "t", context: null };
const CAP = 1_000_000; // $1

describe("registry", () => {
  it("fills the allocation with 20 distinct models and keeps MiniMax in reserve", () => {
    expect(checkRegistry()).toEqual([]);
    expect(Object.values(ALLOCATION).reduce((s, n) => s + n, 0)).toBe(20);
    expect(modelBySlug("minimax/minimax-m3")!.status).toBe("reserve");
    for (const m of REGISTRY) {
      expect(m.verifiedAt).toBe("2026-11-27");
      expect(m.sources.length).toBeGreaterThan(0);
    }
  });

  it("never claims a model is qualified without live runs", () => {
    for (const m of REGISTRY.filter((x) => x.status === "qualified"))
      expect(m.qualification?.result, m.slug).toBe("pass");
    for (const m of REGISTRY.filter((x) => x.qualification && x.qualification.result !== "pass"))
      expect(m.status, m.slug).not.toBe("qualified");
  });

  it("flags a broken allocation", () => {
    expect(checkRegistry(REGISTRY.filter((m) => m.provider !== "xai"))).toContain("xai: 0 models for 1 slots");
  });

  it("prices calls in micro-USD and projects monthly spend", () => {
    expect(costOf(spec, 1000, 100)).toBe(3000);
    const p = projectSpend({
      callsPerClubPerDay: 5,
      inputTokens: 6000,
      outputTokens: 1500,
      seasonalCalls: 20,
      seasonDays: 24,
    });
    expect(p).toHaveLength(20);
    expect(p.find((x) => x.slug === spec.slug)!.usdPer30Days).toBeCloseTo((150 + 25) * 0.027, 5);
  });
});

describe("gateway", () => {
  const ok = (content: string): Transport => ({
    chat: async () => ({ content, finishReason: "stop", inputTokens: 10, outputTokens: 5 }),
  });

  it("validates structured output and reports usage", async () => {
    const r = await new GatewayLlm(spec, ok('```json\n{"answer": 4}\n```')).complete(req);
    expect(r).toMatchObject({ output: { answer: 4 }, model: spec.slug, inputTokens: 10, outputTokens: 5 });
  });

  it("asks for JSON Schema output where supported, JSON mode plus schema in the prompt otherwise", async () => {
    const bodies: unknown[] = [];
    const t: Transport = {
      chat: async (b) => {
        bodies.push(b);
        return { content: '{"answer":1}', finishReason: "stop", inputTokens: 1, outputTokens: 1 };
      },
    };
    await new GatewayLlm(spec, t).complete(req);
    await new GatewayLlm(modelBySlug("deepseek/deepseek-flash")!, t).complete(req);
    expect(bodies[0]).toMatchObject({ model: "gpt-6.2-sol", response_format: { type: "json_schema" } });
    // OpenAI's current models reject max_tokens (live qualification, 2026-11-27): they get max_completion_tokens.
    expect(bodies[0]).toMatchObject({ max_completion_tokens: 4000 });
    expect(bodies[0]).not.toHaveProperty("max_tokens");
    expect(bodies[1]).toMatchObject({ max_tokens: 4000 });
    expect(bodies[1]).toMatchObject({
      model: "deepseek/deepseek-v4.1-flash-1017",
      provider: { order: ["deepseek"], require_parameters: false },
      response_format: { type: "json_object" },
    });
    expect(JSON.stringify(bodies[1])).toContain("JSON Schema");
  });

  it("repairs up to twice, charging every turn, then gives up", async () => {
    let n = 0;
    const t: Transport = {
      chat: async () => ({
        content: n++ === 0 ? '{"answer":"x"}' : '{"answer":2}',
        finishReason: "stop",
        inputTokens: 10,
        outputTokens: 5,
      }),
    };
    const g = new GatewayLlm(spec, t);
    expect(await g.complete(req)).toMatchObject({ output: { answer: 2 }, inputTokens: 20, outputTokens: 10 });
    expect(g.lastRepairs).toBe(1);
    const stubborn = new GatewayLlm(spec, ok("nope"));
    await expect(stubborn.complete(req)).rejects.toBeInstanceOf(LlmOutputError);
    expect(stubborn.lastRepairs).toBe(2);
    const once = new GatewayLlm(spec, ok("nope"), { repairs: 0 });
    await expect(once.complete(req)).rejects.toBeInstanceOf(LlmOutputError);
    expect(once.lastRepairs).toBe(0);
  });

  it("retries transient failures a bounded number of times and never substitutes another model", async () => {
    const t = mockTransport("down");
    const g = new GatewayLlm(spec, t, { maxRetries: 2, backoffMs: () => 0 });
    const e = await g.complete(req).catch((x) => x);
    expect(e).toBeInstanceOf(ModelUnavailableError);
    expect(e.message).toContain(spec.slug);
    expect(t.calls).toBe(3);
  });

  it("doesn't retry a permanent error", async () => {
    let calls = 0;
    const t: Transport = {
      chat: async () => {
        calls++;
        throw new TransportError(401, "HTTP 401: bad key");
      },
    };
    await expect(new GatewayLlm(spec, t, { backoffMs: () => 0 }).complete(req)).rejects.toBeInstanceOf(
      ModelUnavailableError,
    );
    expect(calls).toBe(1);
  });

  it("times out a call that never answers", async () => {
    const g = new GatewayLlm(spec, mockTransport("slow"), { timeoutMs: 20, maxRetries: 1, backoffMs: () => 0 });
    await expect(g.complete(req)).rejects.toThrow(/timeout/);
  });

  it("speaks OpenAI-compatible HTTP", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"answer":3}' }, finish_reason: "stop" }],
          usage: { prompt_tokens: 7, completion_tokens: 2 },
        }),
      );
    }) as unknown as typeof globalThis.fetch;
    const t = openAiCompatible({ baseUrl: "https://example.test/v1/", apiKey: "k", fetch });
    expect(await new GatewayLlm(spec, t).complete(req)).toMatchObject({ output: { answer: 3 }, inputTokens: 7 });
    expect(seen[0]!.url).toBe("https://example.test/v1/chat/completions");
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer k");
    const bad = openAiCompatible({
      baseUrl: "https://x",
      apiKey: "k",
      fetch: (async () => new Response("no", { status: 500 })) as never,
    });
    await expect(
      bad.chat({ model: "m", messages: [], max_tokens: 1 }, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      status: 500,
      transient: true,
    });
  });
});

describe("qualification (mock providers, no paid calls)", () => {
  it("the reference answers pass every scenario's referee", () => {
    for (const s of SCENARIOS)
      expect(s.referee(s.solve(s.context as never) as never, s.context as never), s.id).toBeNull();
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21);
  });

  it("qualifies a reliable model, including after a rate limit and a malformed answer", async () => {
    const good = await qualify(spec, mockTransport("good"), { spendCapMicroUsd: CAP, live: false });
    expect(good.qualified).toBe(true);
    expect(good.trials).toHaveLength(SCENARIOS.length * 3);
    const flaky = await qualify(spec, mockTransport("flaky"), { spendCapMicroUsd: CAP, live: false });
    expect(flaky.qualified).toBe(true);
    expect(flaky.trials[0]).toMatchObject({ pass: true, attempts: 3, repairs: 1 });
  });

  it("fails broken and unavailable models; qualifies an exploitable one but records that it was exploited", async () => {
    for (const kind of ["broken", "down"] as const) {
      const q = await qualify(spec, mockTransport(kind), { spendCapMicroUsd: CAP, live: false });
      expect(q.qualified, kind).toBe(false);
      expect(q.trials.every((t) => !t.pass)).toBe(true);
    }
    const gullible = await qualify(spec, mockTransport("gullible"), { spendCapMicroUsd: CAP, live: false });
    expect(gullible.qualified).toBe(true); // it answers; being outwitted is part of the game
    expect(gullible.judgment).toMatchObject({ exploited: 3, illegal: 3 });
    const injected = gullible.trials.find((t) => t.scenario === "prompt-injection")!;
    expect(injected).toMatchObject({ pass: true, legal: false });
    expect(injected.detail).toMatch(/reservation/);
  });

  it("stops at the spend cap instead of overspending", async () => {
    const q = await qualify(spec, mockTransport("good"), { spendCapMicroUsd: 1_000, live: false });
    expect(q.qualified).toBe(false);
    expect(q.trials.every((t) => t.outcome === "budget")).toBe(true);
    expect(q.spentMicroUsd).toBe(0);
  });
});

describe("routing (direct for OpenAI and Anthropic, pinned OpenRouter for the rest)", () => {
  it("routes every model as agreed, each OpenRouter model pinned to one host", () => {
    for (const m of REGISTRY) {
      if (m.provider === "openai" || m.provider === "anthropic") expect(m.route, m.slug).toBe("direct");
      else {
        expect(m.route, m.slug).toBe("openrouter");
        expect(m.host?.tag, m.slug).toBeTruthy();
        expect(m.openRouterId, m.slug).toBeTruthy();
      }
    }
    const misrouted = REGISTRY.map((m) => (m.slug === "xai/grok-4.7" ? { ...m, route: "direct" as const } : m));
    expect(checkRegistry(misrouted)).toContain("xai/grok-4.7 must route through OpenRouter");
  });

  it("sends OpenRouter the pinned host with fallbacks off, and refuses an answer from another host", async () => {
    const grok = modelBySlug("xai/grok-4.7")!;
    const bodies: unknown[] = [];
    let servedBy = "xAI";
    const t: Transport = {
      chat: async (b) => {
        bodies.push(b);
        return { content: '{"answer":1}', finishReason: "stop", inputTokens: 1, outputTokens: 1, servedBy };
      },
    };
    await new GatewayLlm(grok, t).complete(req);
    expect(bodies[0]).toMatchObject({
      model: "x-ai/grok-4.7",
      provider: { order: ["xai"], allow_fallbacks: false, require_parameters: true },
    });
    servedBy = "Amazon Bedrock";
    await expect(new GatewayLlm(grok, t, { maxRetries: 0 }).complete(req)).rejects.toThrow(/not the pinned host xAI/);
    // Direct models carry no OpenRouter routing.
    servedBy = "OpenAI";
    await new GatewayLlm(spec, t).complete(req);
    expect((bodies.at(-1) as { provider?: unknown }).provider).toBeUndefined();
  });

  it("builds direct, OpenRouter and Anthropic clients from the environment, and never without a key", async () => {
    const seen: string[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      seen.push(`${url} ${(init.headers as Record<string, string>).authorization}`);
      return new Response(
        JSON.stringify({ provider: "Z.AI", choices: [{ message: { content: '{"answer":5}' } }], usage: {} }),
      );
    }) as unknown as typeof globalThis.fetch;
    const env = { OPENAI_API_KEY: "sk-o", OPENROUTER_API_KEY: "sk-or" };
    await llmForModel(modelBySlug("zai/glm-5.3")!, env, { fetch }).complete(req);
    await llmForModel(spec, env, { fetch }).complete(req);
    expect(seen).toEqual([
      "https://openrouter.ai/api/v1/chat/completions Bearer sk-or",
      "https://api.openai.com/v1/chat/completions Bearer sk-o",
    ]);
    expect(() => llmForModel(modelBySlug("zai/glm-5.3")!, {})).toThrow(/OPENROUTER_API_KEY is not set/);
    const claude = llmForModel(modelBySlug("anthropic/claude-opus-5-5")!, { ANTHROPIC_API_KEY: "x" });
    expect(claude).toMatchObject({ provider: "anthropic", model: "anthropic/claude-opus-5-5" });
    // The credential wrapper's name for the key works too; no key at all is refused.
    expect(llmForModel(modelBySlug("anthropic/claude-opus-5-5")!, { ANTHROPIC_KEY: "x" }).model).toBe(
      "anthropic/claude-opus-5-5",
    );
    expect(() => llmForModel(modelBySlug("anthropic/claude-opus-5-5")!, {})).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("provider quirks found in live qualification (2026-11-27)", () => {
  it("strips schema keywords a provider rejects, but still validates the full schema here", async () => {
    const cohere = modelBySlug("cohere/command-a-plus")!;
    const List = z.object({ pattern: z.string(), items: z.array(z.string()).min(2).max(2) });
    const bodies: Array<{ response_format?: { json_schema?: { schema?: unknown } } }> = [];
    const t: Transport = {
      chat: async (b) => {
        bodies.push(b as never);
        return { content: '{"pattern":"hoops","items":["a"]}', finishReason: "stop", inputTokens: 1, outputTokens: 1 };
      },
    };
    await expect(new GatewayLlm(cohere, t).complete({ ...req, schema: List })).rejects.toBeInstanceOf(LlmOutputError);
    const sent = JSON.stringify(bodies[0]!.response_format!.json_schema!.schema);
    expect(sent).not.toContain("minItems");
    expect(sent).not.toContain("maxItems");
    expect(sent).toContain('"pattern":{'); // a field called "pattern" survives; only keywords go
    expect(stripKeywords({ a: [{ minLength: 1, type: "string" }] }, new Set(["minLength"]))).toEqual({
      a: [{ type: "string" }],
    });
  });

  it("never sends an empty assistant turn when repairing an empty answer", async () => {
    let n = 0;
    const seen: ChatBody[] = [];
    const t: Transport = {
      chat: async (b) => {
        seen.push(b);
        return { content: n++ === 0 ? "" : '{"answer":1}', finishReason: "stop", inputTokens: 1, outputTokens: 1 };
      },
    };
    await new GatewayLlm(spec, t).complete(req);
    const assistant = seen[1]!.messages.find((m) => m.role === "assistant")!;
    expect(assistant.content.length).toBeGreaterThan(0);
  });
});

describe("normaliser: presentation fixes only, never decisions", () => {
  const Decision = z.object({
    playerId: z.string(),
    fee: z.number().int().positive(),
    accept: z.boolean(),
    colour: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    motto: z.string().max(80),
    reason: z.string().max(300),
  });
  const schema = z.toJSONSchema(Decision, { io: "output", unrepresentable: "any" });

  it("trims long prose, fills a missing reason and writes colours as #RRGGBB", () => {
    const r = normalise({ playerId: "p1", fee: 5, accept: true, colour: "1f3a93", motto: "x ".repeat(60) }, schema);
    const v = r.value as z.infer<typeof Decision>;
    expect(Decision.safeParse(v).success).toBe(true);
    expect(v).toMatchObject({ playerId: "p1", fee: 5, accept: true, colour: "#1F3A93", reason: "(no reason given)" });
    expect(v.motto.length).toBeLessThanOrEqual(80);
    expect(r.fixes).toHaveLength(3);
    expect((normalise({ colour: "#abc" }, schema).value as { colour: string }).colour).toBe("#AABBCC");
  });

  it("never invents or changes a decision", () => {
    const missing = normalise({ reason: "r", colour: "#000000", motto: "m" }, schema);
    expect(missing.value).not.toHaveProperty("playerId");
    expect(missing.value).not.toHaveProperty("fee");
    expect(Decision.safeParse(missing.value).success).toBe(false);
    const wrong = normalise(
      { playerId: 7, fee: "lots", accept: "yes", colour: "blue", motto: "m", reason: "r" },
      schema,
    );
    expect(wrong.value).toMatchObject({ playerId: 7, fee: "lots", accept: "yes", colour: "blue" });
    expect(wrong.fixes).toEqual([]);
  });

  it("records the fixes it made on an accepted answer", async () => {
    const t: Transport = {
      chat: async () => ({
        content: '{"answer": 3, "reason": "' + "long ".repeat(100) + '"}',
        finishReason: "stop",
        inputTokens: 1,
        outputTokens: 1,
      }),
    };
    const g = new GatewayLlm(spec, t);
    await g.complete({ ...req, schema: z.object({ answer: z.number(), reason: z.string().max(100) }) });
    expect(g.lastFixes).toEqual(["reason: trimmed from 500 to 100 characters"]);
    expect(g.lastRepairs).toBe(0);
  });
});

describe("league functions run on Anthropic", () => {
  it("refuses a non-Claude model for the newsroom", async () => {
    const { loadConfig } = await import("../../config.ts");
    const base = { DATABASE_URL: "postgres://x:y@localhost:5432/db" };
    expect(loadConfig({ ...base }).EDITORIAL_MODEL).toBe("claude-opus-5-5");
    expect(() => loadConfig({ ...base, EDITORIAL_MODEL: "gpt-6.2-sol" })).toThrow(/league functions run on Anthropic/);
    // The credential wrapper's ANTHROPIC_KEY switches the newsroom to Anthropic like ANTHROPIC_API_KEY does.
    expect(loadConfig({ ...base, ANTHROPIC_KEY: "k" })).toMatchObject({
      ANTHROPIC_API_KEY: "k",
      LLM_PROVIDER: "anthropic",
    });
  });
});
