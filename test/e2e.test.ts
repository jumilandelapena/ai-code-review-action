import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { REVIEW_MARKER, SUPERSEDED_MARKER } from "../src/github/dedupe.js";
import { silentLogger } from "../src/log.js";
import { MockReviewProvider } from "../src/review/mock.js";
import type { CountTokensInput, ReviewRequest } from "../src/review/provider.js";
import { runReview, type RunInputs } from "../src/run.js";
import { FakeGitHubApi, loadFixture } from "./helpers/fake-github.js";

const ref = { owner: "acme", repo: "widgets", number: 42 };
const inputs: RunInputs = {
  model: "claude-opus-5-5",
  failOn: "none",
  maxFiles: 40,
  maxDiffTokens: 60_000,
  maxOutputTokens: 16_000,
};

/** Mock reviewer with a pluggable, deterministic token counter and a log of sent requests. */
class CountingProvider extends MockReviewProvider {
  readonly requests: ReviewRequest[] = [];
  constructor(private readonly counter: (input: CountTokensInput) => number) {
    super();
  }
  override async countTokens(input: CountTokensInput): Promise<number> {
    return this.counter(input);
  }
  override async review(request: ReviewRequest) {
    this.requests.push(request);
    return super.review(request);
  }
}

function countFiles(text: string): number {
  return (text.match(/^=== FILE: /gm) ?? []).length;
}

function setup() {
  const gh = new FakeGitHubApi(loadFixture("pr-42"));
  const deps = { gh, provider: new MockReviewProvider(), config: { ...DEFAULT_CONFIG }, log: silentLogger };
  return { gh, deps };
}

describe("end to end with the mock provider and recorded fixtures", () => {
  it("creates exactly one review with the inline comment on the right line", async () => {
    const { gh, deps } = setup();
    const outcome = await runReview(ref, inputs, deps);

    expect(outcome.status).toBe("reviewed");
    if (outcome.status !== "reviewed") return;
    expect(outcome.event).toBe("COMMENT");
    expect(outcome.inlinePosted).toBe(1);
    expect(outcome.filesReviewed).toBe(2);
    expect(outcome.batches).toBe(1);
    expect(outcome.estimatedCostUsd).toBe(0);

    const created = gh.createReviewCalls();
    expect(created).toHaveLength(1);
    const review = created[0]!;
    expect(review.event).toBe("COMMENT");
    expect(review.commitId).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(review.comments).toHaveLength(1);
    // README.md sorts before src/retry.ts, so the mock flags README's first added line (3).
    expect(review.comments[0]).toMatchObject({ path: "README.md", line: 3, side: "RIGHT" });
    expect(review.comments[0]?.body).toContain("```suggestion\nNow with retries. // reviewed by mock provider\n```");
    expect(review.comments[0]?.body).toMatch(/<!-- ai-code-review:finding:[a-f0-9]{16} -->/);

    expect(review.body.startsWith(REVIEW_MARKER)).toBe(true);
    expect(review.body).toContain("**Verdict:** `comment`");
    expect(review.body).toContain("| 🔴 critical | 🟠 high | 🟡 medium | 🔵 low | ⚪ nit |");
    expect(review.body).toContain("| 0 | 0 | 1 | 0 | 0 |");
    expect(review.body).toContain("`assets/logo.png`: binary file");
    expect(review.body).toContain("`pnpm-lock.yaml`: lock file");
    expect(review.body).toContain("Files reviewed: 2 of 4 changed");
    expect(review.body).toContain("Estimated cost: $0.0000");

    // Context for src/retry.ts was fetched at the head SHA; the deleted/binary files were not.
    const fetched = gh.calls.filter((c) => c.method === "getFileContent").map((c) => c.args[1]);
    expect(fetched).toEqual(["README.md", "src/retry.ts"]);
    expect(gh.calls.find((c) => c.method === "getFileContent")?.args[2]).toBe("0123456789abcdef0123456789abcdef01234567");
  });

  it("does not repeat a finding on the next push and retires the earlier review", async () => {
    const { gh, deps } = setup();
    await runReview(ref, inputs, deps);
    const second = await runReview(ref, inputs, deps);

    expect(second.status).toBe("reviewed");
    if (second.status !== "reviewed") return;
    expect(second.inlinePosted).toBe(0);
    expect(second.duplicatesSkipped).toBe(1);

    const created = gh.createReviewCalls();
    expect(created).toHaveLength(2);
    expect(created[1]?.comments).toEqual([]);
    expect(created[1]?.body).toContain("1 finding(s) were already posted on an earlier push");
    // Severity table still counts the duplicate so the totals stay truthful.
    expect(created[1]?.body).toContain("| 0 | 0 | 1 | 0 | 0 |");

    const first = gh.reviews[0]!;
    expect(first.body).toContain(SUPERSEDED_MARKER);
    expect(gh.calls.filter((c) => c.method === "updateReview")).toHaveLength(1);
    expect(gh.calls.filter((c) => c.method === "dismissReview")).toHaveLength(0);
    // Only one live bot review remains.
    expect(gh.reviews.filter((r) => r.body.includes(REVIEW_MARKER) && !r.body.includes(SUPERSEDED_MARKER))).toHaveLength(1);
  });

  it("requests changes and fails when fail_on is met, then dismisses that review on the next push", async () => {
    const { gh, deps } = setup();
    const first = await runReview(ref, { ...inputs, failOn: "medium" }, deps);
    expect(first).toMatchObject({ status: "reviewed", event: "REQUEST_CHANGES", failing: true });
    expect(gh.reviews[0]?.state).toBe("CHANGES_REQUESTED");

    const second = await runReview(ref, { ...inputs, failOn: "medium" }, deps);
    // The duplicate still counts toward fail_on: the problem is still in the PR.
    expect(second).toMatchObject({ status: "reviewed", failing: true });
    expect(gh.calls.filter((c) => c.method === "dismissReview")).toHaveLength(1);
    expect(gh.reviews[0]?.state).toBe("DISMISSED");
  });

  it("does not fail when findings are below fail_on", async () => {
    const { deps } = setup();
    const outcome = await runReview(ref, { ...inputs, failOn: "high" }, deps);
    expect(outcome).toMatchObject({ status: "reviewed", event: "COMMENT", failing: false });
  });

  it("skips pull requests from forks", async () => {
    const fixture = loadFixture("pr-42");
    fixture.pull.head.repo = { full_name: "someone/widgets" };
    const gh = new FakeGitHubApi(fixture);
    const outcome = await runReview(ref, inputs, { gh, provider: new MockReviewProvider(), config: DEFAULT_CONFIG, log: silentLogger });
    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") expect(outcome.reason).toContain("fork");
    expect(gh.createReviewCalls()).toHaveLength(0);
  });

  it("skips when nothing is reviewable", async () => {
    const fixture = loadFixture("pr-42");
    fixture.files = fixture.files.filter((f) => f.filename.endsWith(".png") || f.filename.endsWith(".yaml"));
    const gh = new FakeGitHubApi(fixture);
    const outcome = await runReview(ref, inputs, { gh, provider: new MockReviewProvider(), config: DEFAULT_CONFIG, log: silentLogger });
    expect(outcome).toMatchObject({ status: "skipped" });
    expect(gh.createReviewCalls()).toHaveLength(0);
  });

  it("honours max_files and says so in the review", async () => {
    const { gh, deps } = setup();
    const outcome = await runReview(ref, { ...inputs, maxFiles: 1 }, deps);
    expect(outcome).toMatchObject({ status: "reviewed", filesReviewed: 1 });
    const body = gh.createReviewCalls()[0]!.body;
    expect(body).toContain("Stopped at `max_files: 1`");
    expect(body).toContain("`src/retry.ts`: over max_files (1)");
  });

  it("splits a PR into several batches when max_diff_tokens is small", async () => {
    // Deterministic counter: 500 for the system prompt, 1000 per rendered file.
    const { gh } = setup();
    const provider = new CountingProvider((input) => (input.system ? 500 : 0) + 1000 * countFiles(input.user));
    const deps = { gh, provider, config: { ...DEFAULT_CONFIG }, log: silentLogger };

    const one = await runReview(ref, { ...inputs, maxDiffTokens: 3000 }, deps);
    expect(one).toMatchObject({ status: "reviewed", filesReviewed: 2, batches: 1 });

    const two = await runReview(ref, { ...inputs, maxDiffTokens: 2000 }, deps);
    expect(two).toMatchObject({ status: "reviewed", filesReviewed: 2, batches: 2 });
    const sent = provider.requests.slice(1);
    expect(sent.map((r) => r.files.map((f) => f.filename))).toEqual([["README.md"], ["src/retry.ts"]]);
  });

  it("re-measures the assembled request and splits it when the plan was too optimistic", async () => {
    const { gh } = setup();
    // Per-file counts look tiny, but the full request (with the system prompt) is large.
    const provider = new CountingProvider((input) => (input.system ? 500 + 1000 * countFiles(input.user) : 100));
    const deps = { gh, provider, config: { ...DEFAULT_CONFIG }, log: silentLogger };
    const outcome = await runReview(ref, { ...inputs, maxDiffTokens: 2000 }, deps);
    expect(outcome).toMatchObject({ status: "reviewed", filesReviewed: 2, batches: 2 });
  });

  it("drops a file that cannot fit even on its own and says so", async () => {
    const { gh } = setup();
    const provider = new CountingProvider((input) => (input.system ? 500 + 1000 * countFiles(input.user) : 100));
    const deps = { gh, provider, config: { ...DEFAULT_CONFIG }, log: silentLogger };
    const outcome = await runReview(ref, { ...inputs, maxDiffTokens: 1200 }, deps);
    expect(outcome).toMatchObject({ status: "reviewed", filesReviewed: 0, batches: 0 });
    const body = gh.createReviewCalls()[0]!.body;
    expect(body).toContain("over max_diff_tokens (1200)");
    expect(body).toContain("The review could not complete");
  });

  it("falls back to a body-only review when GitHub rejects the inline positions", async () => {
    const { gh, deps } = setup();
    gh.failNextCreateWith = Object.assign(new Error("Unprocessable Entity"), { status: 422 });
    const outcome = await runReview(ref, inputs, deps);
    expect(outcome).toMatchObject({ status: "reviewed", inlinePosted: 0 });
    const created = gh.createReviewCalls();
    expect(created).toHaveLength(2);
    expect(created[1]?.comments).toEqual([]);
    expect(created[1]?.body).toContain("Inline comments (GitHub rejected their positions");
    expect(created[1]?.body).toContain("`README.md` line 3");
  });

  it("applies ignore globs from the config", async () => {
    const { gh, deps } = setup();
    const outcome = await runReview(ref, inputs, { ...deps, config: { ...DEFAULT_CONFIG, ignore: ["*.md"] } });
    expect(outcome).toMatchObject({ status: "reviewed", filesReviewed: 1 });
    const review = gh.createReviewCalls()[0]!;
    expect(review.comments[0]).toMatchObject({ path: "src/retry.ts", line: 8 });
    expect(review.body).toContain("`README.md`: matches ignore glob `*.md`");
  });
});
