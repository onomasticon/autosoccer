import type { ServerConfig } from "../../config.ts";
import { AnthropicLlm, type LlmClient } from "./llm.ts";
import { offlineManagerLlm } from "./offline.ts";

/** The LLM used by managers, from configuration. */
export function managerLlm(config: Pick<ServerConfig, "LLM_PROVIDER" | "MANAGER_MODEL">): LlmClient {
  return config.LLM_PROVIDER === "anthropic"
    ? new AnthropicLlm(config.MANAGER_MODEL)
    : offlineManagerLlm(config.MANAGER_MODEL);
}
