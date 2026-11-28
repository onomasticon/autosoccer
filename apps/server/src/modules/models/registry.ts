/**
 * The manager model registry (#94, registry/1): which model may run each inaugural club, how it's
 * called, and what it costs. One distinct model per club; no model is an alias of another, there
 * is no cross-model fallback, and a club's model never changes midseason.
 *
 * Verification (2026-11-27): IDs, prices, context windows and capabilities were checked against the
 * providers' documentation and the OpenRouter catalog on that date, by web lookup only. No calls
 * were made then. Live qualification ran on 2026-11-27 under a $50 cap ($5.43 spent in all); each entry's
 * `qualification` records the result. `status` says what's known:
 *  - qualified: passed live qualification;
 *  - candidate: chosen, but not (yet) passed live qualification;
 *  - needs-approval: a substitution or a doubtful choice that the operator must approve first;
 *  - reserve: not allocated unless a candidate fails qualification.
 * Operator decisions (2026-11-27): Meta's slots use Muse (Spark 1.3, Ember), Mistral's second slot
 * uses Small 4, OpenAI's third uses Terra, and models without a pinned version (moving names) are
 * accepted: every run records the model and host that served it, so a silent upgrade shows in the
 * record rather than changing history.
 *
 * Routing: OpenAI and Anthropic models are called directly on their own APIs. Every other model goes
 * through OpenRouter, pinned to one endpoint (`host`, checked against OpenRouter's endpoint list on
 * 2026-11-27: the lab's own endpoint wherever OpenRouter offers one) with fallbacks disabled, and an
 * answer served by any other host is rejected. One OpenRouter key covers them all.
 */

export type Provider =
  | "openai"
  | "anthropic"
  | "google"
  | "mistral"
  | "deepseek"
  | "alibaba"
  | "meta"
  | "xai"
  | "cohere"
  | "moonshot"
  | "zai"
  | "minimax";

export interface ModelSpec {
  /** Stable registry id (what agent runs and the compute ledger record). */
  slug: string;
  provider: Provider;
  /** The exact model id sent to the API. */
  apiModelId: string;
  openRouterId: string | null;
  /**
   * How it's reached: OpenAI and Anthropic models go direct to their own APIs; every other model goes
   * through OpenRouter, pinned to one host (`host`) with fallbacks off, so the same weights answer every call.
   */
  route: "direct" | "openrouter";
  /** OpenRouter endpoint the model is pinned to (route "openrouter" only): provider.order tag and display name. */
  host?: { tag: string; name: string };
  /**
   * JSON Schema keywords the model's structured-output mode rejects. They are stripped from the schema
   * sent to the model only: answers are still validated against the full schema here.
   */
  schemaUnsupported?: string[];
  /** A higher output-token ceiling for models that run out of room (live qualification evidence). */
  maxOutputTokens?: number;
  /** snapshot: the id is pinned; alias: it may move to a newer model; unknown: not documented. */
  pinning: "snapshot" | "alias" | "unknown";
  structuredOutput: "json_schema" | "json_mode";
  tools: boolean;
  contextWindow: number;
  /** USD per million tokens. */
  price: { input: number; output: number; source: "first-party" | "openrouter"; note?: string };
  status: "candidate" | "needs-approval" | "reserve" | "qualified";
  /** The latest live qualification (bun run models qualify --live): pass, fail, or blocked (not run). */
  qualification?: {
    date: string;
    result: "pass" | "fail" | "blocked";
    /** Share of trials with a usable answer (what qualification is decided on). */
    passRate: number;
    /** Judgment, recorded not disqualifying: legal decisions, times exploited by another club's message, fixes. */
    legal: number;
    trials: number;
    exploited: number;
    fixes: number;
    costUsd: number;
    medianLatencyMs: number | null;
    note?: string;
  };
  verifiedAt: string;
  sources: string[];
  notes?: string;
}

/** The single gateway for every model that isn't OpenAI's or Anthropic's. */
export const OPENROUTER = { baseUrl: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY" } as const;

export const PROVIDERS: Record<Provider, { name: string; baseUrl: string; keyEnv: string; endpointVerified: boolean }> =
  {
    openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY", endpointVerified: false },
    anthropic: {
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      keyEnv: "ANTHROPIC_API_KEY",
      endpointVerified: false,
    },
    google: {
      name: "Google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      keyEnv: "GEMINI_API_KEY",
      endpointVerified: false,
    },
    mistral: {
      name: "Mistral",
      baseUrl: "https://api.mistral.ai/v1",
      keyEnv: "MISTRAL_API_KEY",
      endpointVerified: false,
    },
    deepseek: {
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      keyEnv: "DEEPSEEK_API_KEY",
      endpointVerified: false,
    },
    alibaba: {
      name: "Alibaba (Qwen)",
      baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      keyEnv: "DASHSCOPE_API_KEY",
      endpointVerified: false,
    },
    meta: {
      name: "Meta",
      baseUrl: "https://openrouter.ai/api/v1",
      keyEnv: "OPENROUTER_API_KEY",
      endpointVerified: false,
    },
    xai: { name: "xAI", baseUrl: "https://api.x.ai/v1", keyEnv: "XAI_API_KEY", endpointVerified: false },
    cohere: {
      name: "Cohere",
      baseUrl: "https://api.cohere.ai/compatibility/v1",
      keyEnv: "COHERE_API_KEY",
      endpointVerified: false,
    },
    moonshot: {
      name: "Moonshot (Kimi)",
      baseUrl: "https://api.moonshot.ai/v1",
      keyEnv: "MOONSHOT_API_KEY",
      endpointVerified: false,
    },
    zai: {
      name: "Z.ai (GLM)",
      baseUrl: "https://api.z.ai/api/paas/v4",
      keyEnv: "ZAI_API_KEY",
      endpointVerified: false,
    },
    minimax: {
      name: "MiniMax",
      baseUrl: "https://api.minimax.io/v1",
      keyEnv: "MINIMAX_API_KEY",
      endpointVerified: false,
    },
  };

const V = "2026-11-27";
const OR = "https://openrouter.ai/api/v1/models";
const m = (
  s: Omit<ModelSpec, "verifiedAt" | "route" | "tools"> & Partial<Pick<ModelSpec, "route" | "tools">>,
): ModelSpec => ({
  route: "direct",
  tools: true,
  verifiedAt: V,
  ...s,
});

/** The allocation the epic asks for (#92). */
export const ALLOCATION: Record<Provider, number> = {
  openai: 3,
  anthropic: 3,
  google: 2,
  mistral: 2,
  deepseek: 2,
  alibaba: 2,
  meta: 2,
  xai: 1,
  cohere: 1,
  moonshot: 1,
  zai: 1,
  minimax: 0,
};

export const REGISTRY: ModelSpec[] = [
  // OpenAI: four distinct tiers exist; Astra/Sol/Terra follow the intended "Astra/Sol/Luna" spread,
  // with Terra in place of Luna (Luna is the cheapest tier; swap if the operator prefers it).
  m({
    slug: "openai/gpt-6.2-astra",
    provider: "openai",
    apiModelId: "gpt-6.2-astra",
    openRouterId: "openai/gpt-6.2-astra",
    pinning: "unknown",
    structuredOutput: "json_schema",
    contextWindow: 1_050_000,
    price: { input: 8, output: 40, source: "first-party" },
    status: "qualified",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 21,
      trials: 21,
      exploited: 0,
      fixes: 0,
      costUsd: 0.1404,
      medianLatencyMs: 3813,
    },
    sources: ["https://developers.openai.com/api/docs/models", OR],
    notes: "Structured output confirmed by OpenRouter only; no dated snapshot documented.",
  }),
  m({
    slug: "openai/gpt-6.2-sol",
    provider: "openai",
    apiModelId: "gpt-6.2-sol",
    openRouterId: "openai/gpt-6.2-sol",
    pinning: "unknown",
    structuredOutput: "json_schema",
    contextWindow: 1_050_000,
    price: { input: 2, output: 10, source: "first-party" },
    status: "qualified",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 21,
      trials: 21,
      exploited: 0,
      fixes: 0,
      costUsd: 0.0399,
      medianLatencyMs: 2504,
    },
    sources: ["https://developers.openai.com/api/docs/models/gpt-6.2-sol"],
  }),
  m({
    slug: "openai/gpt-6.1-terra",
    provider: "openai",
    apiModelId: "gpt-6.1-terra",
    openRouterId: "openai/gpt-6.1-terra",
    pinning: "unknown",
    structuredOutput: "json_schema",
    contextWindow: 1_050_000,
    price: { input: 1, output: 5, source: "first-party" },
    status: "qualified",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 21,
      trials: 21,
      exploited: 0,
      fixes: 0,
      costUsd: 0.0212,
      medianLatencyMs: 2859,
    },
    sources: ["https://developers.openai.com/api/docs/models", OR],
    notes: "Chosen over Luna for the third OpenAI slot (operator, 2026-11-27).",
  }),
  // Anthropic: dateless ids are pinned snapshots per the docs.
  m({
    slug: "anthropic/claude-fable-5-2",
    provider: "anthropic",
    apiModelId: "claude-fable-5-2",
    openRouterId: "anthropic/claude-fable-5.2",
    pinning: "snapshot",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: { input: 8, output: 40, source: "first-party" },
    status: "qualified",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 21,
      trials: 21,
      exploited: 0,
      fixes: 0,
      costUsd: 0.3094,
      medianLatencyMs: 2471,
    },
    sources: ["https://platform.claude.com/docs/en/about-claude/models/overview"],
    notes: "Retires no sooner than 2027-11-09.",
  }),
  m({
    slug: "anthropic/claude-opus-5-5",
    provider: "anthropic",
    apiModelId: "claude-opus-5-5",
    openRouterId: "anthropic/claude-opus-5.5",
    pinning: "snapshot",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: { input: 4, output: 20, source: "first-party" },
    status: "qualified",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 21,
      trials: 21,
      exploited: 0,
      fixes: 0,
      costUsd: 0.2066,
      medianLatencyMs: 3611,
    },
    sources: ["https://platform.claude.com/docs/en/about-claude/models/overview"],
    notes: "Also the original league's manager model; a new-league club gets its own manager identity.",
  }),
  m({
    slug: "anthropic/claude-sonnet-5-5",
    provider: "anthropic",
    apiModelId: "claude-sonnet-5-5",
    openRouterId: "anthropic/claude-sonnet-5.5",
    pinning: "snapshot",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: { input: 2, output: 10, source: "first-party" },
    status: "qualified",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 21,
      trials: 21,
      exploited: 0,
      fixes: 0,
      costUsd: 0.08,
      medianLatencyMs: 1912,
    },
    sources: ["https://platform.claude.com/docs/en/about-claude/models/overview"],
  }),
  // Google: Gemini 4 isn't labelled stable or preview in the docs; prices change on 2026-12-01.
  m({
    slug: "google/gemini-4-argon",
    provider: "google",
    apiModelId: "gemini-4-argon",
    openRouterId: "google/gemini-4-argon",
    route: "openrouter",
    host: { tag: "google-ai-studio", name: "Google AI Studio" },
    pinning: "unknown",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: { input: 4, output: 20, source: "first-party", note: "$2/$10 until 2026-12-01, then $4/$20 (used here)" },
    status: "qualified",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 21,
      trials: 21,
      exploited: 0,
      fixes: 0,
      costUsd: 0.1082,
      medianLatencyMs: 5305,
    },
    sources: ["https://aistudio.google.com/docs/models", "https://aistudio.google.com/docs/pricing"],
    notes: "GA status unconfirmed.",
  }),
  m({
    slug: "google/gemini-4-neon",
    provider: "google",
    apiModelId: "gemini-4-neon",
    openRouterId: "google/gemini-4-neon",
    route: "openrouter",
    host: { tag: "google-ai-studio", name: "Google AI Studio" },
    pinning: "unknown",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: { input: 3, output: 15, source: "first-party" },
    status: "qualified",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 21,
      trials: 21,
      exploited: 0,
      fixes: 6,
      costUsd: 0.3287,
      medianLatencyMs: 8617,
      note: "Writes colours in other formats (normalised to #RRGGBB).",
    },
    sources: ["https://aistudio.google.com/docs/models", "https://aistudio.google.com/docs/pricing"],
    notes: "GA status unconfirmed.",
  }),
  // Mistral: only one current frontier model; Medium 3.5 is deprecated (retires 2027-04-30).
  m({
    slug: "mistral/mistral-large-4-0",
    provider: "mistral",
    apiModelId: "mistral-large-4-0",
    openRouterId: "mistralai/mistral-large-4-0",
    route: "openrouter",
    host: { tag: "mistral/zdr", name: "Mistral" },
    // Ran out of room at 4,000 output tokens on the recovery scenario (live qualification, 2026-11-27).
    maxOutputTokens: 8000,
    pinning: "snapshot",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: { input: 0.7, output: 2.1, source: "first-party" },
    status: "qualified",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 21,
      trials: 21,
      exploited: 0,
      fixes: 0,
      costUsd: 0.1311,
      medianLatencyMs: 16513,
      note: "Needs 8,000 output tokens: ran out of room at 4,000 on one scenario.",
    },
    sources: ["https://docs.mistral.ai/models", "https://mistral.ai/pricing"],
    notes: "Versioned v26.10 (the 'mistral-large' alias moves; this id doesn't).",
  }),
  m({
    slug: "mistral/mistral-small-4",
    provider: "mistral",
    apiModelId: "mistral-small-2603",
    openRouterId: "mistralai/mistral-small-2603",
    route: "openrouter",
    host: { tag: "mistral/zdr", name: "Mistral" },
    pinning: "unknown",
    structuredOutput: "json_schema",
    contextWindow: 262_000,
    price: { input: 0.15, output: 0.6, source: "openrouter" },
    status: "qualified",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 15,
      trials: 21,
      exploited: 3,
      fixes: 8,
      costUsd: 0.0032,
      medianLatencyMs: 1207,
      note: "Exploited by another club's message 3 of 3; several illegal decisions (rejected in play).",
    },
    sources: [OR],
    notes:
      "Chosen for Mistral's second slot (operator, 2026-11-27); Medium 3.5 is deprecated. API id inferred from OpenRouter.",
  }),
  // DeepSeek: exactly two models, both moving names; JSON mode only (schema validated here).
  m({
    slug: "deepseek/deepseek-v4-pro",
    provider: "deepseek",
    apiModelId: "deepseek-v4-pro",
    openRouterId: "deepseek/deepseek-v4-pro-0813",
    route: "openrouter",
    host: { tag: "deepseek", name: "DeepSeek" },
    pinning: "alias",
    structuredOutput: "json_mode",
    contextWindow: 1_000_000,
    price: { input: 1.32, output: 3.96, source: "first-party", note: "peak price; off-peak $0.66/$1.98" },
    status: "qualified",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 21,
      trials: 21,
      exploited: 0,
      fixes: 0,
      costUsd: 0.1139,
      medianLatencyMs: 4994,
    },
    sources: ["https://api-docs.deepseek.com/quick_start/pricing"],
    notes:
      "Currently serves V4-Pro-0813; record the served version from each response. DeepSeek's own endpoint has no JSON-schema mode on OpenRouter: JSON mode, validated here.",
  }),
  m({
    slug: "deepseek/deepseek-flash",
    provider: "deepseek",
    apiModelId: "deepseek-flash",
    openRouterId: "deepseek/deepseek-v4.1-flash-1017",
    route: "openrouter",
    host: { tag: "deepseek", name: "DeepSeek" },
    pinning: "alias",
    structuredOutput: "json_mode",
    contextWindow: 1_000_000,
    price: { input: 0.3, output: 1.2, source: "first-party", note: "peak price; off-peak $0.15/$0.60" },
    status: "qualified",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 21,
      trials: 21,
      exploited: 0,
      fixes: 0,
      costUsd: 0.0179,
      medianLatencyMs: 2373,
    },
    sources: ["https://api-docs.deepseek.com/quick_start/pricing"],
    notes:
      "Currently serves V4.1-Flash-1017. DeepSeek's own endpoint has no JSON-schema mode on OpenRouter: JSON mode, validated here.",
  }),
  m({
    slug: "alibaba/qwen4-max",
    provider: "alibaba",
    apiModelId: "qwen4-max",
    openRouterId: "qwen/qwen4-max",
    route: "openrouter",
    host: { tag: "alibaba", name: "Alibaba" },
    pinning: "unknown",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: { input: 1.5, output: 4.5, source: "first-party" },
    status: "qualified",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 21,
      trials: 21,
      exploited: 0,
      fixes: 1,
      costUsd: 0.0724,
      medianLatencyMs: 6038,
    },
    sources: [
      "https://www.alibabacloud.com/help/en/model-studio/models",
      "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
    ],
  }),
  m({
    slug: "alibaba/qwen3.8-max",
    provider: "alibaba",
    apiModelId: "qwen3.8-max-0902",
    openRouterId: "qwen/qwen3.8-max-0902",
    route: "openrouter",
    host: { tag: "alibaba", name: "Alibaba" },
    pinning: "snapshot",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: { input: 2, output: 6, source: "first-party" },
    status: "qualified",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 21,
      trials: 21,
      exploited: 0,
      fixes: 1,
      costUsd: 0.1774,
      medianLatencyMs: 19146,
    },
    sources: ["https://www.alibabacloud.com/help/en/model-studio/models"],
  }),
  // Meta: its own API serves Muse models, not Llama. Muse via OpenRouter needs approval of the relabel.
  m({
    slug: "meta/muse-spark-1.3",
    provider: "meta",
    apiModelId: "muse-spark-1.3",
    openRouterId: "meta/muse-spark-1.3",
    route: "openrouter",
    host: { tag: "meta", name: "Meta" },
    pinning: "snapshot",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: { input: 1.25, output: 4.25, source: "openrouter" },
    status: "qualified",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 21,
      trials: 21,
      exploited: 0,
      fixes: 0,
      costUsd: 0.1486,
      medianLatencyMs: 9454,
    },
    sources: ["https://dev.meta.ai/docs/models.md", OR],
    notes:
      "Substitution: the allocation says Llama; Meta's current API models are Muse. Alternative: Llama 4 Maverick (April 2025, one host).",
  }),
  m({
    slug: "meta/muse-ember-1.0",
    provider: "meta",
    apiModelId: "muse-ember-1.0",
    openRouterId: "meta/muse-ember",
    route: "openrouter",
    host: { tag: "meta", name: "Meta" },
    pinning: "snapshot",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: { input: 0.1, output: 0.5, source: "openrouter" },
    status: "qualified",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 21,
      trials: 21,
      exploited: 0,
      fixes: 0,
      costUsd: 0.0148,
      medianLatencyMs: 2293,
    },
    sources: ["https://dev.meta.ai/docs/models.md"],
    notes: "Avoids the preview Muse Wonder (country-limited).",
  }),
  m({
    slug: "xai/grok-4.7",
    provider: "xai",
    apiModelId: "grok-4.7",
    openRouterId: "x-ai/grok-4.7",
    route: "openrouter",
    host: { tag: "xai", name: "xAI" },
    pinning: "unknown",
    structuredOutput: "json_schema",
    contextWindow: 500_000,
    price: { input: 2, output: 6, source: "first-party", note: "under 200k input; $4/$12 above" },
    status: "qualified",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 21,
      trials: 21,
      exploited: 0,
      fixes: 0,
      costUsd: 0.1925,
      medianLatencyMs: 5200,
    },
    sources: ["https://docs.x.ai/docs/models", "https://docs.x.ai/docs/guides/structured-outputs"],
    notes: "Bare name is 'latest stable'; the dated pin for 4.7 isn't documented.",
  }),
  m({
    slug: "cohere/command-a-plus",
    provider: "cohere",
    apiModelId: "command-a-plus-05-2026",
    openRouterId: "cohere/command-a-plus",
    route: "openrouter",
    host: { tag: "cohere/fp8", name: "Cohere" },
    // Cohere rejects size and range constraints in response_format (live qualification, 2026-11-27).
    schemaUnsupported: ["minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum", "pattern", "format"],
    pinning: "snapshot",
    structuredOutput: "json_schema",
    contextWindow: 128_000,
    price: { input: 0.3, output: 1.5, source: "openrouter" },
    status: "qualified",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 18,
      trials: 21,
      exploited: 3,
      fixes: 0,
      costUsd: 0.0432,
      medianLatencyMs: 6374,
      note: "Talked into accepting an offer below its own price by another club's message, 3 of 3.",
    },
    sources: ["https://docs.cohere.com/docs/command-a-plus", OR],
    notes: "Provisional per #92; MiniMax M3 is the reserve if it fails live qualification.",
  }),
  m({
    slug: "moonshot/kimi-k3.1-pro",
    provider: "moonshot",
    apiModelId: "kimi-k3.1-pro",
    openRouterId: "moonshotai/kimi-k3.1-pro",
    route: "openrouter",
    host: { tag: "moonshotai/mxfp4", name: "Moonshot AI" },
    pinning: "unknown",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: { input: 2, output: 10, source: "openrouter", note: "Moonshot AI's own standard endpoint (not highspeed)" },
    status: "qualified",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 21,
      trials: 21,
      exploited: 0,
      fixes: 0,
      costUsd: 0.1445,
      medianLatencyMs: 12888,
    },
    sources: ["https://platform.kimi.ai/docs/pricing/chat", OR],
  }),
  m({
    slug: "zai/glm-5.3",
    provider: "zai",
    apiModelId: "glm-5.3",
    openRouterId: "z-ai/glm-5.3",
    route: "openrouter",
    host: { tag: "z-ai/fp8", name: "Z.AI" },
    pinning: "unknown",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: { input: 1.4, output: 4.4, source: "first-party" },
    status: "qualified",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 21,
      trials: 21,
      exploited: 0,
      fixes: 12,
      costUsd: 0.2375,
      medianLatencyMs: 15442,
      note: "Often omits the reason field (filled by the normaliser).",
    },
    sources: ["https://docs.z.ai/guides/overview/pricing"],
    notes: "Lowercase id inferred.",
  }),
  m({
    slug: "minimax/minimax-m3",
    provider: "minimax",
    apiModelId: "MiniMax-M3",
    openRouterId: "minimax/minimax-m3",
    route: "openrouter",
    host: { tag: "deepinfra/fp8", name: "DeepInfra" },
    pinning: "unknown",
    structuredOutput: "json_mode",
    contextWindow: 1_000_000,
    price: {
      input: 0.28,
      output: 1.1,
      source: "openrouter",
      note: "DeepInfra fp8; MiniMax has no public first-party endpoint on OpenRouter",
    },
    status: "reserve",
    notes:
      "No public first-party MiniMax endpoint on OpenRouter: pinned to DeepInfra (fp8, JSON mode; Parasail fp8 lacks response_format). Needs approval if the reserve is ever used.",
    qualification: {
      date: "2026-11-27",
      result: "pass",
      passRate: 1,
      legal: 20,
      trials: 21,
      exploited: 0,
      fixes: 1,
      costUsd: 0.007,
      medianLatencyMs: 2411,
    },
    sources: ["https://platform.minimax.io/docs/guides/pricing"],
  }),
];

export const modelBySlug = (slug: string) => REGISTRY.find((x) => x.slug === slug) ?? null;

/** The model id sent on the wire: OpenRouter's id when routed through it, else the provider's own. */
export const requestModel = (spec: ModelSpec) => (spec.route === "openrouter" ? spec.openRouterId! : spec.apiModelId);

/** Micro-USD for a call: tokens × $/MTok is micro-USD exactly. */
export const costOf = (spec: ModelSpec, inputTokens: number, outputTokens: number) =>
  Math.ceil(inputTokens * spec.price.input + outputTokens * spec.price.output);

/** The worst case reserved before a call (the compute ledger holds it until the call settles). */
export const worstCaseMicroUsd = (spec: ModelSpec, maxInput: number, maxOutput: number) =>
  costOf(spec, maxInput, maxOutput);

/** Registry problems: allocation not met, duplicate ids, reserves allocated. */
export function checkRegistry(reg: ModelSpec[] = REGISTRY): string[] {
  const out: string[] = [];
  const active = reg.filter((x) => x.status !== "reserve");
  for (const [p, n] of Object.entries(ALLOCATION) as Array<[Provider, number]>) {
    const have = active.filter((x) => x.provider === p).length;
    if (have !== n) out.push(`${p}: ${have} models for ${n} slots`);
  }
  const ids = new Set<string>();
  for (const x of reg) {
    const key = `${x.provider}:${x.apiModelId}`;
    if (ids.has(key)) out.push(`duplicate model ${key}`);
    ids.add(key);
  }
  if (active.length !== 20) out.push(`${active.length} allocated models for 20 clubs`);
  for (const x of reg) {
    const direct = x.provider === "openai" || x.provider === "anthropic";
    if (direct && x.route !== "direct") out.push(`${x.slug} must go direct`);
    if (!direct && x.route !== "openrouter") out.push(`${x.slug} must route through OpenRouter`);
    if (x.route === "openrouter" && (!x.host || !x.openRouterId)) out.push(`${x.slug} has no pinned OpenRouter host`);
  }
  return out;
}

export interface Cadence {
  /** Manager decisions per club per real day (pre/post-match, daily management). */
  callsPerClubPerDay: number;
  /** Tokens per call, including repairs. */
  inputTokens: number;
  outputTokens: number;
  /** Extra calls per club per season for windows, founding and finance events. */
  seasonalCalls: number;
  seasonDays: number;
}

/** Projected spend per model per 30 days at a cadence (excludes the newsroom and hosting). */
export function projectSpend(c: Cadence, reg: ModelSpec[] = REGISTRY.filter((x) => x.status !== "reserve")) {
  return reg.map((spec) => {
    const calls = 30 * c.callsPerClubPerDay + (30 / c.seasonDays) * c.seasonalCalls;
    return {
      slug: spec.slug,
      callsPer30Days: Math.round(calls),
      usdPer30Days: (calls * costOf(spec, c.inputTokens, c.outputTokens)) / 1e6,
    };
  });
}
