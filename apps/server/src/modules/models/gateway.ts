/**
 * The inference gateway (#94): one LlmClient per registered model, whatever its provider.
 *
 *  - Provider-agnostic: an OpenAI-compatible chat-completions transport covers every provider that
 *    exposes one (OpenAI, Google, Mistral, DeepSeek, Alibaba, xAI, Cohere, Moonshot, Z.ai, MiniMax,
 *    and OpenRouter for open-weight models); Anthropic keeps its SDK client (agents/llm.ts).
 *  - Validated structured output: the model is asked for JSON matching the task's zod schema (as
 *    JSON Schema where the provider supports it, else JSON mode plus the schema in the prompt), and
 *    the answer is parsed and validated here, never trusted.
 *  - Bounded: a per-call timeout, at most `maxRetries` retries on transient failures (timeouts, 429,
 *    5xx), and at most one repair turn for output that fails the schema. Every attempt's tokens are
 *    counted, so repairs are charged.
 *  - No silent substitution: a call is made to exactly the model asked for. If it fails, the error
 *    says so; the caller keeps the club's last valid decision (agents/service.ts). There is no
 *    cross-model fallback, here or in the registry.
 *
 * No calls are made from page rendering or simulator ticks: the gateway is only reachable from jobs.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  AnthropicLlm,
  type LlmClient,
  LlmOutputError,
  LlmRefusalError,
  type LlmRequest,
  type LlmResponse,
} from "../agents/llm.ts";
import { normalise } from "./normalise.ts";
import { type ModelSpec, OPENROUTER, PROVIDERS, requestModel } from "./registry.ts";

export class ModelUnavailableError extends Error {
  constructor(
    readonly model: string,
    readonly reason: string,
    readonly attempts: number,
  ) {
    super(`${model} unavailable after ${attempts} attempt(s): ${reason}`);
  }
}

export interface Transport {
  /** One chat-completions call. Throws TransportError for HTTP failures. */
  chat(body: ChatBody, opts: { signal: AbortSignal }): Promise<ChatReply>;
}

export class TransportError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
  get transient() {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export interface ChatBody {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  /** Output cap. OpenAI's current models reject it and take max_completion_tokens instead. */
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  /** OpenRouter routing: one pinned host, no fallback to other hosts. */
  provider?: { order: string[]; allow_fallbacks: false; require_parameters: boolean };
  response_format?:
    | { type: "json_object" }
    | { type: "json_schema"; json_schema: { name: string; strict: boolean; schema: unknown } };
}

export interface ChatReply {
  content: string;
  finishReason: string | null;
  inputTokens: number;
  outputTokens: number;
  /** The host that actually served the call, when the gateway reports it (OpenRouter does). */
  servedBy?: string;
}

/** OpenAI-compatible `POST {baseUrl}/chat/completions`, with an injectable fetch for tests. */
export function openAiCompatible(opts: {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}): Transport {
  const f = opts.fetch ?? fetch;
  return {
    async chat(body, { signal }) {
      let res: Response;
      try {
        res = await f(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}`, ...opts.headers },
          body: JSON.stringify(body),
          signal,
        });
      } catch (e) {
        throw new TransportError(0, (e as Error).name === "AbortError" ? "timeout" : (e as Error).message);
      }
      if (!res.ok) throw new TransportError(res.status, `HTTP ${res.status}: ${(await res.text()).slice(0, 600)}`);
      const j = (await res.json()) as {
        provider?: string;
        choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = j.choices?.[0];
      if (choice?.message?.refusal) throw new LlmRefusalError(choice.message.refusal);
      return {
        content: choice?.message?.content ?? "",
        finishReason: choice?.finish_reason ?? null,
        inputTokens: j.usage?.prompt_tokens ?? 0,
        outputTokens: j.usage?.completion_tokens ?? 0,
        ...(j.provider ? { servedBy: j.provider } : {}),
      };
    },
  };
}

export interface GatewayOptions {
  timeoutMs?: number;
  maxRetries?: number;
  /** Repair turns when output fails the schema (default 2; 0 or repair: false disables). */
  repairs?: number;
  /** @deprecated use repairs: 0 */
  repair?: boolean;
  /** Delay before retry n (ms); default 500 × 2^n. */
  backoffMs?: (attempt: number) => number;
  temperature?: number;
}

const stripFences = (s: string) => s.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");

/**
 * Per-call timeout. 120 s cut off Grok and Kimi mid-answer on market decisions in the live pilot
 * (#101); every decision deadline in calendar/1 is at least 30 minutes away.
 */
export const CALL_TIMEOUT_MS = 300_000;

/** An LlmClient for one registered model over a transport. */
export class GatewayLlm implements LlmClient {
  readonly provider: string;
  readonly model: string;
  /** Attempts and repairs made by the last call (for qualification evidence). */
  lastAttempts = 0;
  lastRepairs = 0;
  /** Presentation fixes the normaliser made to the last accepted answer (see normalise.ts). */
  lastFixes: string[] = [];

  constructor(
    readonly spec: ModelSpec,
    private readonly transport: Transport,
    private readonly opts: GatewayOptions = {},
  ) {
    this.provider = spec.provider;
    this.model = spec.slug;
  }

  async complete<T>(req: LlmRequest<T>): Promise<LlmResponse<T>> {
    const fullSchema = z.toJSONSchema(req.schema as z.ZodType, { io: "output", unrepresentable: "any" });
    const schema = stripKeywords(fullSchema, new Set(this.spec.schemaUnsupported ?? []));
    const structured = this.spec.structuredOutput;
    const system =
      structured === "json_schema"
        ? req.system
        : `${req.system}\n\nAnswer with a single JSON object, and nothing else, matching this JSON Schema:\n${JSON.stringify(schema)}`;
    const messages: ChatBody["messages"] = [
      { role: "system", content: system },
      { role: "user", content: req.prompt },
    ];
    let input = 0;
    let output = 0;
    this.lastAttempts = 0;
    this.lastRepairs = 0;
    this.lastFixes = [];
    const maxRepairs = this.opts.repair === false ? 0 : (this.opts.repairs ?? 2);
    // Some models need more room to finish an answer (registry maxOutputTokens).
    const maxOut = Math.max(req.maxTokens ?? 4000, this.spec.maxOutputTokens ?? 0);
    for (let repairs = 0; ; repairs++) {
      const reply = await this.call({
        model: requestModel(this.spec),
        ...(this.spec.route === "openrouter" && this.spec.host
          ? {
              provider: {
                order: [this.spec.host.tag],
                allow_fallbacks: false,
                require_parameters: structured === "json_schema",
              },
            }
          : {}),
        messages,
        ...(this.spec.provider === "openai" ? { max_completion_tokens: maxOut } : { max_tokens: maxOut }),
        ...(this.opts.temperature !== undefined ? { temperature: this.opts.temperature } : {}),
        ...(structured === "json_schema"
          ? { response_format: { type: "json_schema", json_schema: { name: "answer", strict: false, schema } } }
          : structured === "json_mode"
            ? { response_format: { type: "json_object" } }
            : {}),
      });
      input += reply.inputTokens;
      output += reply.outputTokens;
      // Same weights, same host, every call: an answer from any other host is refused, not used.
      if (this.spec.host && reply.servedBy && reply.servedBy !== this.spec.host.name)
        throw new ModelUnavailableError(
          this.model,
          `served by ${reply.servedBy}, not the pinned host ${this.spec.host.name}`,
          this.lastAttempts,
        );
      const problem = this.check(reply, req.schema, fullSchema);
      if (problem.ok)
        return {
          output: problem.value,
          provider: this.provider,
          model: this.model,
          inputTokens: input,
          outputTokens: output,
        };
      if (repairs >= maxRepairs) {
        const e = new LlmOutputError(problem.error);
        Object.assign(e, { usage: { inputTokens: input, outputTokens: output } });
        throw e;
      }
      this.lastRepairs++;
      messages.push(
        { role: "assistant", content: reply.content.slice(0, 8000) || "(an empty answer)" },
        {
          role: "user",
          content: problem.error.startsWith("output truncated")
            ? "That answer was cut off before it finished. Reply again with only the JSON object: no explanation around it, and keep every reason to a sentence or two."
            : `That answer was rejected: ${problem.error}. Reply again with only the corrected JSON object.`,
        },
      );
    }
  }

  private check<T>(
    reply: ChatReply,
    schema: z.ZodType<T>,
    fullSchema: unknown,
  ): { ok: true; value: T } | { ok: false; error: string } {
    if (reply.finishReason === "length") return { ok: false, error: "output truncated (max tokens)" };
    let json: unknown;
    try {
      json = JSON.parse(stripFences(reply.content));
    } catch {
      return { ok: false, error: "output was not JSON" };
    }
    // Presentation fixes only (normalise.ts); decisions are never changed.
    const tidy = normalise(json, fullSchema);
    const parsed = schema.safeParse(tidy.value);
    if (!parsed.success)
      return {
        ok: false,
        error: `output failed the schema: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
          .join("; ")}`,
      };
    this.lastFixes = tidy.fixes;
    return { ok: true, value: parsed.data };
  }

  private async call(body: ChatBody): Promise<ChatReply> {
    const max = this.opts.maxRetries ?? 2;
    let last: TransportError | null = null;
    for (let attempt = 0; attempt <= max; attempt++) {
      this.lastAttempts++;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.opts.timeoutMs ?? CALL_TIMEOUT_MS);
      try {
        return await this.transport.chat(body, { signal: ctl.signal });
      } catch (e) {
        if (!(e instanceof TransportError)) throw e;
        last = e;
        if (!e.transient) break;
        if (attempt < max)
          await new Promise((r) => setTimeout(r, (this.opts.backoffMs ?? ((n) => 500 * 2 ** n))(attempt)));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new ModelUnavailableError(this.model, last?.message ?? "unknown error", this.lastAttempts);
  }
}

/**
 * The client a manager model is called through. Anthropic: its SDK, direct (structured output, the
 * production client). OpenAI: direct, OpenAI-compatible. Everyone else: OpenRouter, pinned host.
 * Keys come from the environment (run through the credential wrappers); a missing key is an error.
 */
export function llmForModel(
  spec: ModelSpec,
  env: Record<string, string | undefined> = process.env,
  opts: GatewayOptions & { fetch?: typeof fetch } = {},
): LlmClient {
  if (spec.route === "direct" && spec.provider === "anthropic") {
    // ANTHROPIC_KEY is what the credential wrapper (with-anthropic-token) exports.
    const apiKey = env.ANTHROPIC_API_KEY ?? env.ANTHROPIC_KEY;
    if (!apiKey) throw new Error(`${spec.slug}: ANTHROPIC_API_KEY (or ANTHROPIC_KEY) is not set`);
    const inner = new AnthropicLlm(spec.apiModelId, { client: new Anthropic({ apiKey }) });
    return {
      provider: "anthropic",
      model: spec.slug,
      complete: async (req) => ({ ...(await inner.complete(req)), model: spec.slug }),
    };
  }
  const key = spec.route === "openrouter" ? OPENROUTER.keyEnv : PROVIDERS[spec.provider].keyEnv;
  const apiKey = env[key];
  if (!apiKey) throw new Error(`${spec.slug}: ${key} is not set`);
  const baseUrl = spec.route === "openrouter" ? OPENROUTER.baseUrl : PROVIDERS[spec.provider].baseUrl;
  return new GatewayLlm(spec, openAiCompatible({ baseUrl, apiKey, fetch: opts.fetch }), opts);
}

/** A copy of a JSON Schema without the given keywords, at every depth. */
export function stripKeywords(schema: unknown, drop: ReadonlySet<string>): unknown {
  if (!drop.size || schema === null || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map((x) => stripKeywords(x, drop));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    // Inside "properties" the keys are field names, never keywords.
    if (drop.has(k) && k !== "properties") continue;
    out[k] =
      k === "properties"
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([n, s]) => [n, stripKeywords(s, drop)]))
        : stripKeywords(v, drop);
  }
  return out;
}
