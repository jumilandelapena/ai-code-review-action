import { describe, expect, it } from "vitest";
import type { ExistingReview, GitHubApi, PullRef } from "../src/github/api.js";
import {
  collectExistingHashes,
  findingHash,
  findingMarker,
  previousBotReviews,
  REVIEW_MARKER,
  splitDuplicates,
  SUPERSEDED_MARKER,
  supersedePreviousReviews,
} from "../src/github/dedupe.js";
import { buildInlineComment } from "../src/github/post.js";
import type { Finding } from "../src/review/schema.js";

const base: Finding = {
  file: "src/a.ts",
  line: 11,
  severity: "high",
  category: "bug",
  title: "Off-by-one in loop bound",
  explanation: "x",
};

describe("findingHash", () => {
  it("is stable across whitespace and case differences in the title", () => {
    expect(findingHash("a.ts", 1, "Off-by-one  in loop")).toBe(findingHash("a.ts", 1, "off-by-one in LOOP "));
    expect(findingHash("a.ts", 1, "t")).not.toBe(findingHash("a.ts", 2, "t"));
    expect(findingHash("a.ts", 1, "t")).not.toBe(findingHash("b.ts", 1, "t"));
  });
});

describe("splitDuplicates", () => {
  it("does not post the same finding twice on a second push", () => {
    const firstPush = buildInlineComment(base);
    const existing = collectExistingHashes([{ id: 1, body: firstPush.body, path: base.file, line: base.line }]);
    const secondPush = splitDuplicates([base, { ...base, line: 12 }], existing);
    expect(secondPush.duplicates).toEqual([base]);
    expect(secondPush.fresh).toEqual([{ ...base, line: 12 }]);
  });

  it("collapses identical findings returned twice in the same run", () => {
    const result = splitDuplicates([base, { ...base }], new Set());
    expect(result.fresh).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
  });

  it("ignores comments without a marker", () => {
    expect(collectExistingHashes([{ id: 1, body: "human comment", path: "a", line: 1 }]).size).toBe(0);
    expect(findingMarker("abc")).toBe("<!-- ai-code-review:finding:abc -->");
  });
});

describe("previousBotReviews / supersedePreviousReviews", () => {
  const ref: PullRef = { owner: "o", repo: "r", number: 1 };
  const reviews: ExistingReview[] = [
    { id: 1, body: `${REVIEW_MARKER}\nold comment review`, state: "COMMENTED", userLogin: "github-actions[bot]", htmlUrl: "u1" },
    { id: 2, body: `${REVIEW_MARKER}\nold blocking review`, state: "CHANGES_REQUESTED", userLogin: "github-actions[bot]", htmlUrl: "u2" },
    { id: 3, body: `${REVIEW_MARKER}\n${SUPERSEDED_MARKER}`, state: "COMMENTED", userLogin: "github-actions[bot]", htmlUrl: "u3" },
    { id: 4, body: "a human review", state: "APPROVED", userLogin: "alice", htmlUrl: "u4" },
    { id: 5, body: `${REVIEW_MARKER}`, state: "DISMISSED", userLogin: "github-actions[bot]", htmlUrl: "u5" },
  ];

  it("finds only live bot reviews", () => {
    expect(previousBotReviews(reviews).map((r) => r.id)).toEqual([1, 2]);
  });

  it("dismisses blocking reviews and collapses comment reviews", async () => {
    const calls: string[] = [];
    const gh = {
      dismissReview: async (_ref: PullRef, id: number, message: string) => {
        calls.push(`dismiss:${id}:${message}`);
      },
      updateReview: async (_ref: PullRef, id: number, body: string) => {
        calls.push(`update:${id}:${body.includes(SUPERSEDED_MARKER)}`);
      },
    } as unknown as GitHubApi;
    const result = await supersedePreviousReviews(gh, ref, previousBotReviews(reviews), "https://new");
    expect(result).toEqual({ dismissed: 1, collapsed: 1 });
    expect(calls).toEqual(["update:1:true", "dismiss:2:Superseded by a newer AI review: https://new"]);
  });
});
