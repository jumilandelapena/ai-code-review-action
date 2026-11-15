import { PRICING } from "./cost.js";
import type { CountTokensInput, ReviewProvider, TokenUsage } from "./review/provider.js";

/**
 * Per-run spending cap. `limitUsd` of 0 means unlimited. Before each batch is
 * sent, the projected input cost of that batch is added to what has already
 * been spent; if the total would cross the limit, the remaining batches are
 * skipped and the review says so.
 */
export class BudgetTracker {
  spentUsd = 0;

  constructor(
    readonly model: string,
    readonly limitUsd: number,
  ) {}

  add(usage: TokenUsage): void {
    const pricing = PRICING[this.model];
    if (!pricing) return;
    this.spentUsd +=
      (usage.inputTokens * pricing.input +
        usage.outputTokens * pricing.output +
        usage.cacheReadTokens * pricing.cacheRead +
        usage.cacheWriteTokens * pricing.cacheWrite) /
      1_000_000;
  }

  /** Input-only estimate for a request that has not been sent yet. */
  projectedInputCost(inputTokens: number): number {
    const pricing = PRICING[this.model];
    if (!pricing) return 0;
    return (inputTokens * pricing.input) / 1_000;
  }

  /** True when sending `request` would push this run over the limit. */
  async wouldExceed(provider: ReviewProvider, request: CountTokensInput): Promise<boolean> {
    if (this.limitUsd <= 0) return false;
    const inputTokens = provider.countTokens(request);
    return this.spentUsd + this.projectedInputCost(inputTokens as unknown as number) > this.limitUsd;
  }
}
