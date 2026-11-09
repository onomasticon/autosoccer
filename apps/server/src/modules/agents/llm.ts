import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export interface LlmRequest<T> {
  /** Stable instructions (persona, rules). */
  system: string;
  /** The task with all grounded facts. */
  prompt: string;
  schema: z.ZodType<T>;
  /** Task id, e.g. "manager.pre_match"; lets offline providers pick a strategy. */
  task: string;
  /** Structured facts the prompt was built from (used only by the offline provider). */
  context: unknown;
  maxTokens?: number;
}

export interface LlmResponse<T> {
  output: T;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmClient {
  readonly provider: string;
  /** Model id used for pricing and audit. */
  readonly model: string;
  complete<T>(req: LlmRequest<T>): Promise<LlmResponse<T>>;
}

export class LlmRefusalError extends Error {}
export class LlmOutputError extends Error {}

/**
 * Claude via the official SDK, with structured output constrained to the zod schema.
 * Claude Opus 5.5: adaptive thinking is always on, so depth is set with `effort`;
 * server-side refusal fallbacks are enabled ("default" routing).
 */
export class AnthropicLlm implements LlmClient {
  readonly provider = "anthropic";
  private readonly client: Anthropic;
  private readonly effort: "low" | "medium" | "high";

  constructor(
    readonly model: string,
    opts: { client?: Anthropic; effort?: "low" | "medium" | "high" } = {},
  ) {
    this.client = opts.client ?? new Anthropic();
    this.effort = opts.effort ?? "medium";
  }

  async complete<T>(req: LlmRequest<T>): Promise<LlmResponse<T>> {
    const params = {
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: req.prompt }],
      output_config: { effort: this.effort, format: zodOutputFormat(req.schema as z.ZodType) },
    };
    // `fallbacks` is newer than some SDK type definitions; the request shape follows the API docs.
    const msg = (await this.client.beta.messages.create(params as never)) as unknown as Anthropic.Beta.BetaMessage;
    if (msg.stop_reason === "refusal") throw new LlmRefusalError("model declined the request");
    if (msg.stop_reason === "max_tokens") throw new LlmOutputError("output truncated (max_tokens)");
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LlmOutputError("model output was not JSON");
    }
    const parsed = req.schema.safeParse(json);
    if (!parsed.success) throw new LlmOutputError(`output failed schema: ${parsed.error.issues[0]?.message}`);
    const u = msg.usage;
    return {
      output: parsed.data,
      provider: this.provider,
      model: this.model,
      inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      outputTokens: u.output_tokens,
    };
  }
}

/**
 * Deterministic offline provider for tests and keyless demos. It does NOT call a model:
 * a rule-based strategy per task produces the output from the same structured facts the
 * prompt was built from. Token usage is *estimated* (≈4 chars per token) and priced at the
 * configured model so budget mechanics behave realistically. Runs are recorded with
 * provider "offline" and model "offline:<model>" so they're never mistaken for real calls.
 */
export class OfflineLlm implements LlmClient {
  readonly provider = "offline";
  readonly model: string;

  constructor(
    pricedAs: string,
    private readonly strategies: Record<string, (context: unknown) => unknown>,
  ) {
    this.model = `offline:${pricedAs}`;
  }

  async complete<T>(req: LlmRequest<T>): Promise<LlmResponse<T>> {
    const strategy = this.strategies[req.task];
    if (!strategy) throw new Error(`offline provider has no strategy for ${req.task}`);
    const output = req.schema.parse(strategy(req.context));
    return {
      output,
      provider: this.provider,
      model: this.model,
      inputTokens: Math.ceil((req.system.length + req.prompt.length) / 4),
      outputTokens: Math.ceil(JSON.stringify(output).length / 4) + 150,
    };
  }
}
