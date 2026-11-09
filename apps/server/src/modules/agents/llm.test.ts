import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicLlm, LlmOutputError, LlmRefusalError, OfflineLlm } from "./llm.ts";
import { costMicroUsd } from "./pricing.ts";

const Schema = z.object({ answer: z.number() }).strict();

/** Minimal stand-in for the SDK client: records the request, returns a canned message. */
function fakeClient(message: Partial<Anthropic.Beta.BetaMessage>) {
  const calls: unknown[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: unknown) => {
          calls.push(params);
          return {
            model: "claude-opus-5-5",
            stop_reason: "end_turn",
            content: [{ type: "text", text: '{"answer": 42}' }],
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 50,
            },
            ...message,
          };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const req = { system: "sys", prompt: "q", schema: Schema, task: "t", context: null };

describe("AnthropicLlm", () => {
  it("sends a structured-output request with explicit effort and refusal fallbacks, and reports usage", async () => {
    const { client, calls } = fakeClient({});
    const llm = new AnthropicLlm("claude-opus-5-5", { client });
    const res = await llm.complete(req);
    expect(res).toMatchObject({
      output: { answer: 42 },
      provider: "anthropic",
      model: "claude-opus-5-5",
      inputTokens: 150,
      outputTokens: 20,
    });
    const p = calls[0] as Record<string, unknown> & { output_config: { effort: string; format: { type: string } } };
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.fallbacks).toBe("default");
    expect(p.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(p.output_config.effort).toBe("medium");
    expect(p.output_config.format.type).toBe("json_schema");
    expect(p).not.toHaveProperty("thinking");
    expect(p).not.toHaveProperty("temperature");
  });

  it("surfaces refusals, truncation and schema violations as typed errors", async () => {
    await expect(
      new AnthropicLlm("m", { client: fakeClient({ stop_reason: "refusal" }).client }).complete(req),
    ).rejects.toThrow(LlmRefusalError);
    await expect(
      new AnthropicLlm("m", { client: fakeClient({ stop_reason: "max_tokens" }).client }).complete(req),
    ).rejects.toThrow(LlmOutputError);
    const bad = fakeClient({ content: [{ type: "text", text: '{"answer":"x"}', citations: null }] as never });
    await expect(new AnthropicLlm("m", { client: bad.client }).complete(req)).rejects.toThrow(/schema/);
  });
});

describe("OfflineLlm and pricing", () => {
  it("is clearly labelled, estimates tokens and validates its own output", async () => {
    const llm = new OfflineLlm("claude-opus-5-5", { t: () => ({ answer: 1 }) });
    const res = await llm.complete(req);
    expect(res.provider).toBe("offline");
    expect(res.model).toBe("offline:claude-opus-5-5");
    expect(res.inputTokens).toBeGreaterThan(0);
    await expect(new OfflineLlm("claude-opus-5-5", { t: () => ({ answer: "no" }) }).complete(req)).rejects.toThrow();
  });

  it("prices tokens in integer micro-USD", () => {
    expect(costMicroUsd("claude-opus-5-5", 1_000_000, 0)).toBe(4_000_000);
    expect(costMicroUsd("claude-opus-5-5", 3000, 800)).toBe(28_000); // $0.028
    expect(costMicroUsd("offline:claude-opus-5-5", 10, 10)).toBe(240);
    expect(() => costMicroUsd("gpt-x", 1, 1)).toThrow(/pricing/);
  });
});
