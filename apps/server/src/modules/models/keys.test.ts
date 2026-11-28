import { describe, expect, it } from "vitest";
import { keyEnvFor, missingKeys } from "./gateway.ts";
import { REGISTRY } from "./registry.ts";

const allocated = REGISTRY.filter((m) => m.status !== "reserve");

describe("the launch preflight: every founder's API key", () => {
  it("needs three keys for the 20 models: Anthropic and OpenAI direct, everyone else via OpenRouter", () => {
    expect(new Set(allocated.map(keyEnvFor))).toEqual(
      new Set(["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"]),
    );
  });

  it("names every founder that couldn't make a live call", () => {
    const missing = missingKeys(allocated, { ANTHROPIC_API_KEY: "x" });
    expect(missing.length).toBe(allocated.filter((m) => m.provider !== "anthropic").length);
    expect(missing.every((m) => m.key === "OPENAI_API_KEY" || m.key === "OPENROUTER_API_KEY")).toBe(true);
  });

  it("passes with all three, and accepts the credential wrapper's ANTHROPIC_KEY", () => {
    expect(missingKeys(allocated, { ANTHROPIC_KEY: "x", OPENAI_API_KEY: "x", OPENROUTER_API_KEY: "x" })).toEqual([]);
  });
});
