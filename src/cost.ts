import type { TokenUsage } from "./review/provider.js";

/** USD per million tokens. Cache writes are 1.25x input; cache reads are the published rate. */
export interface ModelPricing {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export const PRICING: Record<string, ModelPricing> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
};

/** Estimated cost in USD, or `null` when the model is not in the pricing table. */
export function estimateCost(model: string, usage: TokenUsage): number | null {
  const pricing = PRICING[model];
  if (!pricing) return null;
  const perToken = 1 / 1_000_000;
  return (
    usage.inputTokens * pricing.input * perToken +
    usage.outputTokens * pricing.output * perToken +
    usage.cacheWriteTokens * pricing.cacheWrite * perToken +
    usage.cacheReadTokens * pricing.cacheRead * perToken
  );
}

export function formatUsd(amount: number | null): string {
  if (amount === null) return "n/a (unknown model pricing)";
  if (amount === 0) return "$0.0000";
  if (amount < 0.0001) return "<$0.0001";
  return `$${amount.toFixed(4)}`;
}

export function formatUsage(usage: TokenUsage): string {
  return `${usage.inputTokens.toLocaleString("en-US")} in / ${usage.outputTokens.toLocaleString("en-US")} out / ${usage.cacheReadTokens.toLocaleString("en-US")} cache read / ${usage.cacheWriteTokens.toLocaleString("en-US")} cache write`;
}
