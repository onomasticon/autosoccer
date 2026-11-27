/**
 * The manager model registry (#94, registry/1): which model may run each inaugural club, how it's
 * called, and what it costs. One distinct model per club; no model is an alias of another, there
 * is no cross-model fallback, and a club's model never changes midseason.
 *
 * Verification (2026-11-27): IDs, prices, context windows and capabilities were checked against the
 * providers' documentation and the OpenRouter catalog on that date, by web lookup only. No calls
 * were made, so NOTHING here is "qualified" yet: qualification needs live runs of
 * `bun run models qualify --live` under an approved spend cap (#101). `status` says what's known:
 *  - candidate: documented, callable in principle, awaiting live qualification;
 *  - needs-approval: a substitution or a doubtful choice that the operator must approve first;
 *  - reserve: not allocated unless a candidate fails qualification.
 * Endpoint base URLs are the providers' documented OpenAI-compatible endpoints from memory, not
 * re-verified on that date (`endpointVerified: false`); qualification is what confirms them.
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
  /** How it's reached: the provider's own API, or OpenRouter when the provider has no direct route. */
  route: "direct" | "openrouter";
  /** snapshot: the id is pinned; alias: it may move to a newer model; unknown: not documented. */
  pinning: "snapshot" | "alias" | "unknown";
  structuredOutput: "json_schema" | "json_mode";
  tools: boolean;
  contextWindow: number;
  /** USD per million tokens. */
  price: { input: number; output: number; source: "first-party" | "openrouter"; note?: string };
  status: "candidate" | "needs-approval" | "reserve";
  verifiedAt: string;
  sources: string[];
  notes?: string;
}

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
    status: "candidate",
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
    status: "candidate",
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
    status: "needs-approval",
    sources: ["https://developers.openai.com/api/docs/models", OR],
    notes: "In place of the 'Luna' intent (gpt-6-luna, $0.10/$0.50, is the alternative).",
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
    status: "candidate",
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
    status: "candidate",
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
    status: "candidate",
    sources: ["https://platform.claude.com/docs/en/about-claude/models/overview"],
  }),
  // Google: Gemini 4 isn't labelled stable or preview in the docs; prices change on 2026-12-01.
  m({
    slug: "google/gemini-4-argon",
    provider: "google",
    apiModelId: "gemini-4-argon",
    openRouterId: "google/gemini-4-argon",
    pinning: "unknown",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: { input: 4, output: 20, source: "first-party", note: "$2/$10 until 2026-12-01, then $4/$20 (used here)" },
    status: "candidate",
    sources: ["https://aistudio.google.com/docs/models", "https://aistudio.google.com/docs/pricing"],
    notes: "GA status unconfirmed.",
  }),
  m({
    slug: "google/gemini-4-neon",
    provider: "google",
    apiModelId: "gemini-4-neon",
    openRouterId: "google/gemini-4-neon",
    pinning: "unknown",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: { input: 3, output: 15, source: "first-party" },
    status: "candidate",
    sources: ["https://aistudio.google.com/docs/models", "https://aistudio.google.com/docs/pricing"],
    notes: "GA status unconfirmed.",
  }),
  // Mistral: only one current frontier model; Medium 3.5 is deprecated (retires 2027-04-30).
  m({
    slug: "mistral/mistral-large-4-0",
    provider: "mistral",
    apiModelId: "mistral-large-4-0",
    openRouterId: "mistralai/mistral-large-4-0",
    pinning: "snapshot",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: { input: 0.7, output: 2.1, source: "first-party" },
    status: "candidate",
    sources: ["https://docs.mistral.ai/models", "https://mistral.ai/pricing"],
    notes: "Versioned v26.10 (the 'mistral-large' alias moves; this id doesn't).",
  }),
  m({
    slug: "mistral/mistral-small-4",
    provider: "mistral",
    apiModelId: "mistral-small-2603",
    openRouterId: "mistralai/mistral-small-2603",
    pinning: "unknown",
    structuredOutput: "json_schema",
    contextWindow: 262_000,
    price: { input: 0.15, output: 0.6, source: "openrouter" },
    status: "needs-approval",
    sources: [OR],
    notes: "API id inferred from OpenRouter, not confirmed in Mistral's docs. Medium 3.5 would retire mid-cycle.",
  }),
  // DeepSeek: exactly two models, both moving names; JSON mode only (schema validated here).
  m({
    slug: "deepseek/deepseek-v4-pro",
    provider: "deepseek",
    apiModelId: "deepseek-v4-pro",
    openRouterId: "deepseek/deepseek-v4-pro-0813",
    pinning: "alias",
    structuredOutput: "json_mode",
    contextWindow: 1_000_000,
    price: { input: 1.32, output: 3.96, source: "first-party", note: "peak price; off-peak $0.66/$1.98" },
    status: "candidate",
    sources: ["https://api-docs.deepseek.com/quick_start/pricing"],
    notes: "Currently serves V4-Pro-0813; record the served version from each response.",
  }),
  m({
    slug: "deepseek/deepseek-flash",
    provider: "deepseek",
    apiModelId: "deepseek-flash",
    openRouterId: "deepseek/deepseek-v4.1-flash-1017",
    pinning: "alias",
    structuredOutput: "json_mode",
    contextWindow: 1_000_000,
    price: { input: 0.3, output: 1.2, source: "first-party", note: "peak price; off-peak $0.15/$0.60" },
    status: "candidate",
    sources: ["https://api-docs.deepseek.com/quick_start/pricing"],
    notes: "Currently serves V4.1-Flash-1017.",
  }),
  m({
    slug: "alibaba/qwen4-max",
    provider: "alibaba",
    apiModelId: "qwen4-max",
    openRouterId: "qwen/qwen4-max",
    pinning: "unknown",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: { input: 1.5, output: 4.5, source: "first-party" },
    status: "candidate",
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
    pinning: "snapshot",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: { input: 2, output: 6, source: "first-party" },
    status: "candidate",
    sources: ["https://www.alibabacloud.com/help/en/model-studio/models"],
  }),
  // Meta: its own API serves Muse models, not Llama. Muse via OpenRouter needs approval of the relabel.
  m({
    slug: "meta/muse-spark-1.3",
    provider: "meta",
    apiModelId: "meta/muse-spark-1.3",
    openRouterId: "meta/muse-spark-1.3",
    route: "openrouter",
    pinning: "snapshot",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: { input: 1.25, output: 4.25, source: "openrouter" },
    status: "needs-approval",
    sources: ["https://dev.meta.ai/docs/models.md", OR],
    notes:
      "Substitution: the allocation says Llama; Meta's current API models are Muse. Alternative: Llama 4 Maverick (April 2025, one host).",
  }),
  m({
    slug: "meta/muse-ember-1.0",
    provider: "meta",
    apiModelId: "meta/muse-ember-1.0",
    openRouterId: "meta/muse-ember-1.0",
    route: "openrouter",
    pinning: "snapshot",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: { input: 1.25, output: 4.25, source: "openrouter", note: "price not verified; assumed equal to Spark" },
    status: "needs-approval",
    sources: ["https://dev.meta.ai/docs/models.md"],
    notes: "Avoids the preview Muse Wonder (country-limited). Id and price not confirmed on OpenRouter.",
  }),
  m({
    slug: "xai/grok-4.7",
    provider: "xai",
    apiModelId: "grok-4.7",
    openRouterId: "x-ai/grok-4.7",
    pinning: "unknown",
    structuredOutput: "json_schema",
    contextWindow: 500_000,
    price: { input: 2, output: 6, source: "first-party", note: "under 200k input; $4/$12 above" },
    status: "candidate",
    sources: ["https://docs.x.ai/docs/models", "https://docs.x.ai/docs/guides/structured-outputs"],
    notes: "Bare name is 'latest stable'; the dated pin for 4.7 isn't documented.",
  }),
  m({
    slug: "cohere/command-a-plus",
    provider: "cohere",
    apiModelId: "command-a-plus-05-2026",
    openRouterId: "cohere/command-a-plus",
    pinning: "snapshot",
    structuredOutput: "json_schema",
    contextWindow: 128_000,
    price: { input: 0.3, output: 1.5, source: "openrouter" },
    status: "candidate",
    sources: ["https://docs.cohere.com/docs/command-a-plus", OR],
    notes: "Provisional per #92; MiniMax M3 is the reserve if it fails live qualification.",
  }),
  m({
    slug: "moonshot/kimi-k3.1-pro",
    provider: "moonshot",
    apiModelId: "kimi-k3.1-pro",
    openRouterId: "moonshotai/kimi-k3.1-pro",
    pinning: "unknown",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: {
      input: 4,
      output: 20,
      source: "openrouter",
      note: "OpenRouter lists $2/$10 and $4/$20 endpoints; higher used",
    },
    status: "candidate",
    sources: ["https://platform.kimi.ai/docs/pricing/chat", OR],
  }),
  m({
    slug: "zai/glm-5.3",
    provider: "zai",
    apiModelId: "glm-5.3",
    openRouterId: "z-ai/glm-5.3",
    pinning: "unknown",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: { input: 1.4, output: 4.4, source: "first-party" },
    status: "candidate",
    sources: ["https://docs.z.ai/guides/overview/pricing"],
    notes: "Lowercase id inferred.",
  }),
  m({
    slug: "minimax/minimax-m3",
    provider: "minimax",
    apiModelId: "MiniMax-M3",
    openRouterId: "minimax/minimax-m3",
    pinning: "unknown",
    structuredOutput: "json_schema",
    contextWindow: 1_000_000,
    price: {
      input: 0.6,
      output: 2.4,
      source: "first-party",
      note: "list price; a '50% discount' to $0.30/$1.20 is advertised",
    },
    status: "reserve",
    sources: ["https://platform.minimax.io/docs/guides/pricing"],
  }),
];

export const modelBySlug = (slug: string) => REGISTRY.find((x) => x.slug === slug) ?? null;

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
