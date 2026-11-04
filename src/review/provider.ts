import type { ReviewOutput } from "./schema.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** What the mock provider needs to invent a plausible finding without reading the prompt. */
export interface BatchFileMeta {
  filename: string;
  firstAddedLine: number | null;
  firstAddedContent: string | null;
}

export interface ReviewRequest {
  model: string;
  /** Stable text; the Anthropic provider marks it with `cache_control`. */
  system: string;
  user: string;
  maxTokens: number;
  effort: Effort;
  files: BatchFileMeta[];
}

export type IncompleteReason = "refusal" | "max_tokens" | "parse_error" | "empty";

export type ReviewResult =
  | { status: "ok"; output: ReviewOutput; usage: TokenUsage }
  | { status: "incomplete"; reason: IncompleteReason; detail: string; usage: TokenUsage };

export interface CountTokensInput {
  model: string;
  system?: string;
  user: string;
}

export interface ReviewProvider {
  readonly name: string;
  /** Measure a prospective request with the model's own tokenizer. */
  countTokens(input: CountTokensInput): Promise<number>;
  review(request: ReviewRequest): Promise<ReviewResult>;
}
