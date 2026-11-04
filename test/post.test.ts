import { describe, expect, it } from "vitest";
import { estimateCost, formatUsd } from "../src/cost.js";
import { buildInlineComment, buildReviewBody, severityTable } from "../src/github/post.js";
import type { Finding } from "../src/review/schema.js";

const finding: Finding = {
  file: "src/db.ts",
  line: 40,
  severity: "critical",
  category: "security",
  title: "SQL built with string concatenation",
  explanation: "`userId` comes from the request and is interpolated into the query.",
  suggestion: '  const rows = await db.query("SELECT * FROM users WHERE id = $1", [userId]);',
};

describe("buildInlineComment", () => {
  it("renders severity, category, explanation, a suggestion block and the dedupe marker", () => {
    const comment = buildInlineComment(finding);
    expect(comment).toMatchObject({ path: "src/db.ts", line: 40, side: "RIGHT" });
    expect(comment.body).toContain("🔴 **critical** · security — **SQL built with string concatenation**");
    expect(comment.body).toContain("```suggestion\n  const rows = await db.query(\"SELECT * FROM users WHERE id = $1\", [userId]);\n```");
    expect(comment.body).toMatch(/<!-- ai-code-review:finding:[a-f0-9]{16} -->$/);
  });

  it("omits the suggestion block when there is no suggestion", () => {
    const { suggestion: _s, ...noSuggestion } = finding;
    expect(buildInlineComment(noSuggestion).body).not.toContain("```suggestion");
  });
});

describe("severityTable", () => {
  it("counts every severity", () => {
    const table = severityTable([finding, { ...finding, severity: "low" }, { ...finding, severity: "low" }]);
    expect(table.split("\n")[2]).toBe("| 1 | 0 | 0 | 2 | 0 |");
  });
});

describe("buildReviewBody", () => {
  const base = {
    model: "claude-opus-5-5",
    providerName: "anthropic",
    verdict: "request_changes" as const,
    event: "REQUEST_CHANGES" as const,
    summary: "Adds a user lookup endpoint.",
    inline: [finding],
    duplicates: [],
    notes: [
      { file: "src/other.ts", line: 3, severity: "low" as const, category: "bug" as const, title: "Unused result", explanation: "x", reason: "line 3 is not an added or changed line" },
    ],
    suppressedStyle: 2,
    usage: { inputTokens: 12_000, outputTokens: 800, cacheReadTokens: 3_000, cacheWriteTokens: 1_500 },
    estimatedCostUsd: 0.0723,
    filesReviewed: 3,
    filesChanged: 5,
    skipped: [{ filename: "a.lock", reason: "lock file" }],
    truncatedAtMaxFiles: null,
    batches: 2,
    incompleteBatches: [{ files: ["src/big.ts"], reason: "the model declined to review this batch" }],
    failOn: "high" as const,
    failing: true,
    headSha: "abcdef1234567890",
  };

  it("contains the marker, verdict, table, notes, coverage, usage and cost", () => {
    const body = buildReviewBody(base);
    expect(body.startsWith("<!-- ai-code-review -->")).toBe(true);
    expect(body).toContain("**Verdict:** `request_changes`");
    expect(body).toContain("❌ **Check failed:**");
    expect(body).toContain("| 1 | 0 | 0 | 0 | 0 |");
    expect(body).toContain("### File-level notes");
    expect(body).toContain("`src/other.ts` (line 3)");
    expect(body).toContain("### Review could not complete for some files");
    expect(body).toContain("`src/big.ts`");
    expect(body).toContain("Files reviewed: 3 of 5 changed in 2 batches");
    expect(body).toContain("2 style finding(s) suppressed");
    expect(body).toContain("Tokens: 12,000 in / 800 out / 3,000 cache read / 1,500 cache write");
    expect(body).toContain("Estimated cost: $0.0723");
  });

  it("says so when there are no findings", () => {
    const body = buildReviewBody({ ...base, inline: [], notes: [], incompleteBatches: [], failing: false, verdict: "approve", event: "COMMENT" });
    expect(body).toContain("No findings.");
  });
});

describe("estimateCost", () => {
  it("prices Opus 5.5 tokens including cache reads and writes", () => {
    const cost = estimateCost("claude-opus-5-5", { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 100_000 });
    expect(cost).toBeCloseTo(4 + 2 + 0.2 + 0.5, 6);
    expect(estimateCost("claude-unknown", { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull();
    expect(formatUsd(null)).toContain("unknown");
    expect(formatUsd(0.00001)).toBe("<$0.0001");
  });
});
