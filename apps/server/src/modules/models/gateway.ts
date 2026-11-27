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
import { z } from "zod";
import {
  AnthropicLlm,
  type LlmClient,
  LlmOutputError,
  LlmRefusalError,
  type LlmRequest,
  type LlmResponse,
} from "../agents/llm.ts";
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
  max_tokens: number;
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
      if (!res.ok) throw new TransportError(res.status, `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
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
  /** One repair turn when output fails the schema (default true). */
  repair?: boolean;
  /** Delay before retry n (ms); default 500 × 2^n. */
  backoffMs?: (attempt: number) => number;
  temperature?: number;
}

const stripFences = (s: string) => s.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");

/** An LlmClient for one registered model over a transport. */
export class GatewayLlm implements LlmClient {
  readonly provider: string;
  readonly model: string;
  /** Attempts and repairs made by the last call (for qualification evidence). */
  lastAttempts = 0;
  lastRepairs = 0;

  constructor(
    readonly spec: ModelSpec,
    private readonly transport: Transport,
    private readonly opts: GatewayOptions = {},
  ) {
    this.provider = spec.provider;
    this.model = spec.slug;
  }

  async complete<T>(req: LlmRequest<T>): Promise<LlmResponse<T>> {
    const schema = z.toJSONSchema(req.schema as z.ZodType, { io: "output", unrepresentable: "any" });
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
        max_tokens: req.maxTokens ?? 4000,
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
      const problem = this.check(reply, req.schema);
      if (problem.ok)
        return {
          output: problem.value,
          provider: this.provider,
          model: this.model,
          inputTokens: input,
          outputTokens: output,
        };
      if (repairs >= 1 || this.opts.repair === false) {
        const e = new LlmOutputError(problem.error);
        Object.assign(e, { usage: { inputTokens: input, outputTokens: output } });
        throw e;
      }
      this.lastRepairs++;
      messages.push(
        { role: "assistant", content: reply.content.slice(0, 8000) },
        {
          role: "user",
          content: `That answer was rejected: ${problem.error}. Reply again with only the corrected JSON object.`,
        },
      );
    }
  }

  private check<T>(reply: ChatReply, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
    if (reply.finishReason === "length") return { ok: false, error: "output truncated (max tokens)" };
    let json: unknown;
    try {
      json = JSON.parse(stripFences(reply.content));
    } catch {
      return { ok: false, error: "output was not JSON" };
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success)
      return {
        ok: false,
        error: `output failed the schema: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
          .join("; ")}`,
      };
    return { ok: true, value: parsed.data };
  }

  private async call(body: ChatBody): Promise<ChatReply> {
    const max = this.opts.maxRetries ?? 2;
    let last: TransportError | null = null;
    for (let attempt = 0; attempt <= max; attempt++) {
      this.lastAttempts++;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.opts.timeoutMs ?? 120_000);
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
    const inner = new AnthropicLlm(spec.apiModelId);
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
