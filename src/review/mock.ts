import type { CountTokensInput, ReviewProvider, ReviewRequest, ReviewResult } from "./provider.js";

/** Rough chars-per-token ratio for code; only used when no API key is available. */
const CHARS_PER_TOKEN = 3.5;

export function approximateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Deterministic stand-in for Claude so tests, CI and local runs work without
 * an API key (`LLM_PROVIDER=mock`). It reports exactly one medium "bug" on the
 * first added line of the first file in each batch, with a suggestion that
 * re-emits that line, and returns a fixed summary.
 */
export class MockReviewProvider implements ReviewProvider {
  readonly name = "mock";

  async countTokens(input: CountTokensInput): Promise<number> {
    return approximateTokens((input.system ?? "") + input.user);
  }

  async review(request: ReviewRequest): Promise<ReviewResult> {
    const target = request.files.find((file) => file.firstAddedLine !== null);
    const findings = target
      ? [
          {
            file: target.filename,
            line: target.firstAddedLine as number,
            severity: "medium" as const,
            category: "bug" as const,
            title: "Mock finding on the first changed line",
            explanation:
              "This finding comes from the mock provider (LLM_PROVIDER=mock). It exists so the posting path can be exercised without an API key.",
            suggestion: `${target.firstAddedContent ?? ""} // reviewed by mock provider`,
          },
        ]
      : [];
    return {
      status: "ok",
      output: {
        findings,
        summary: `Mock review of ${request.files.length} file(s). No model was called; set ANTHROPIC_API_KEY and unset LLM_PROVIDER=mock for a real review.`,
        verdict: "comment",
      },
      usage: {
        inputTokens: approximateTokens(request.system + request.user),
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  }
}
