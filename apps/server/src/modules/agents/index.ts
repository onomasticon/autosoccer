import Anthropic from "@anthropic-ai/sdk";
import type { ServerConfig } from "../../config.ts";
import { offlineEditorialLlm } from "../editorial/offline.ts";
import { llmForModel } from "../models/gateway.ts";
import { modelBySlug } from "../models/registry.ts";
import { AnthropicLlm, type LlmClient } from "./llm.ts";
import { offlineManagerLlm } from "./offline.ts";

/** The SDK client, with the key from config (ANTHROPIC_API_KEY, or the wrapper's ANTHROPIC_KEY). */
const anthropicClient = (config: { ANTHROPIC_API_KEY?: string }) =>
  new Anthropic(config.ANTHROPIC_API_KEY ? { apiKey: config.ANTHROPIC_API_KEY } : {});

/**
 * Phase 2: each club's manager answers through its own model. Registry models (models/registry.ts)
 * get the provider client (direct or pinned OpenRouter) when a provider is configured, else the
 * offline stand-in priced as that model. Any other model (the original league's managers) gets the
 * configured client, exactly as before. Clients are cached per model.
 */
export function managerLlmFor(
  config: Pick<ServerConfig, "LLM_PROVIDER" | "MANAGER_MODEL"> & { ANTHROPIC_API_KEY?: string },
  env: Record<string, string | undefined> = process.env,
): (model: string) => LlmClient {
  const cache = new Map<string, LlmClient>();
  const configured = managerLlm(config);
  return (model) => {
    const hit = cache.get(model);
    if (hit) return hit;
    const spec = modelBySlug(model);
    const client = !spec
      ? configured
      : config.LLM_PROVIDER === "offline"
        ? offlineManagerLlm(model)
        : llmForModel(spec, { ...env, ANTHROPIC_API_KEY: config.ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY });
    cache.set(model, client);
    return client;
  };
}

/** The LLM used by managers, from configuration. */
export function managerLlm(
  config: Pick<ServerConfig, "LLM_PROVIDER" | "MANAGER_MODEL"> & { ANTHROPIC_API_KEY?: string },
): LlmClient {
  return config.LLM_PROVIDER === "anthropic"
    ? new AnthropicLlm(config.MANAGER_MODEL, { client: anthropicClient(config) })
    : offlineManagerLlm(config.MANAGER_MODEL);
}

/**
 * The LLM used by league functions (the AI journalists and league news): always Anthropic, called
 * direct through its SDK, never the multi-provider manager registry. EDITORIAL_MODEL is validated as
 * a Claude model in config; without a key the free offline template writer runs instead.
 */
export function editorialLlm(
  config: Pick<ServerConfig, "LLM_PROVIDER" | "EDITORIAL_MODEL"> & { ANTHROPIC_API_KEY?: string },
): LlmClient {
  return config.LLM_PROVIDER === "anthropic"
    ? new AnthropicLlm(config.EDITORIAL_MODEL, { client: anthropicClient(config) })
    : offlineEditorialLlm(config.EDITORIAL_MODEL);
}
