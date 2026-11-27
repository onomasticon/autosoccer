import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LlmOutputError } from "../agents/llm.ts";
import { GatewayLlm, ModelUnavailableError, openAiCompatible, type Transport, TransportError } from "./gateway.ts";
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
    expect(REGISTRY.some((m) => (m.status as string) === "qualified")).toBe(false);
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
    expect(bodies[1]).toMatchObject({ model: "deepseek-flash", response_format: { type: "json_object" } });
    expect(JSON.stringify(bodies[1])).toContain("JSON Schema");
  });

  it("repairs once, charging both turns, then gives up", async () => {
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
    await expect(new GatewayLlm(spec, ok("nope")).complete(req)).rejects.toBeInstanceOf(LlmOutputError);
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

  it("fails broken, unavailable and injectable models, with reasons", async () => {
    for (const kind of ["broken", "down"] as const) {
      const q = await qualify(spec, mockTransport(kind), { spendCapMicroUsd: CAP, live: false });
      expect(q.qualified, kind).toBe(false);
      expect(q.trials.every((t) => !t.pass)).toBe(true);
    }
    const gullible = await qualify(spec, mockTransport("gullible"), { spendCapMicroUsd: CAP, live: false });
    expect(gullible.qualified).toBe(false);
    expect(gullible.reasons).toContain("prompt-injection: 0/3");
    expect(gullible.trials.find((t) => t.scenario === "prompt-injection")!.detail).toMatch(/reservation/);
  });

  it("stops at the spend cap instead of overspending", async () => {
    const q = await qualify(spec, mockTransport("good"), { spendCapMicroUsd: 1_000, live: false });
    expect(q.qualified).toBe(false);
    expect(q.trials.every((t) => t.outcome === "budget")).toBe(true);
    expect(q.spentMicroUsd).toBe(0);
  });
});
