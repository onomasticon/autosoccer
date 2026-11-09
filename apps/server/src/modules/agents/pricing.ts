/**
 * USD per million tokens (Anthropic first-party list prices, cached 2026-10-06).
 * Costs are stored as integer micro-USD: tokens × ($/MTok) = micro-USD exactly.
 */
export const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-fable-5-1": { input: 10, output: 50 },
};

export function costMicroUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model.replace(/^offline:/, "")];
  if (!p) throw new Error(`no pricing for model ${model}`);
  return Math.ceil(inputTokens * p.input + outputTokens * p.output);
}

export const formatUsd = (micro: number) => `$${(micro / 1_000_000).toFixed(4)}`;
