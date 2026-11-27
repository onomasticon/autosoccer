import Anthropic from "@anthropic-ai/sdk";
import type { ServerConfig } from "../../config.ts";
import { offlineEditorialLlm } from "../editorial/offline.ts";
import { AnthropicLlm, type LlmClient } from "./llm.ts";
import { offlineManagerLlm } from "./offline.ts";

/** The SDK client, with the key from config (ANTHROPIC_API_KEY, or the wrapper's ANTHROPIC_KEY). */
const anthropicClient = (config: { ANTHROPIC_API_KEY?: string }) =>
  new Anthropic(config.ANTHROPIC_API_KEY ? { apiKey: config.ANTHROPIC_API_KEY } : {});

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
