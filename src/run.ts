import type { ReviewConfig } from "./config.js";
import { estimateCost } from "./cost.js";
import { attachContext } from "./diff/context.js";
import { filterFiles } from "./diff/filter.js";
import { parseChangedFile } from "./diff/parse.js";
import type { ParsedFile, SkippedFile } from "./diff/types.js";
import type { GitHubApi, PullRef, ReviewEvent } from "./github/api.js";
import {
  collectExistingHashes,
  previousBotReviews,
  splitDuplicates,
  supersedePreviousReviews,
} from "./github/dedupe.js";
import { buildInlineComment, buildReviewBody, postReview, type IncompleteBatch } from "./github/post.js";
import type { Logger } from "./log.js";
import { planBatches, splitBatch, type RenderedFile } from "./review/batch.js";
import { buildSystemPrompt, renderFile, renderPullRequestHeader, renderUserMessage } from "./review/prompt.js";
import { addUsage, EMPTY_USAGE, type ReviewProvider, type TokenUsage } from "./review/provider.js";
import { meetsSeverity, type ReviewOutput, type Severity, type Verdict } from "./review/schema.js";
import { validateFindings } from "./review/validate.js";

export interface RunInputs {
  model: string;
  failOn: Severity | "none";
  maxFiles: number;
  maxDiffTokens: number;
  /** Output budget per batch. 16k leaves room for 15 findings with suggestions plus thinking. */
  maxOutputTokens: number;
}

export interface RunDeps {
  gh: GitHubApi;
  provider: ReviewProvider;
  config: ReviewConfig;
  log: Logger;
}

export type RunOutcome =
  | { status: "skipped"; reason: string }
  | {
      status: "reviewed";
      reviewUrl: string;
      event: ReviewEvent;
      verdict: Verdict | null;
      inlinePosted: number;
      duplicatesSkipped: number;
      notes: number;
      filesReviewed: number;
      batches: number;
      usage: TokenUsage;
      estimatedCostUsd: number | null;
      failing: boolean;
    };

const CONTENT_FETCH_CONCURRENCY = 5;
const VERDICT_RANK: Record<Verdict, number> = { approve: 0, comment: 1, request_changes: 2 };

/** The whole pipeline for one pull request. Pure orchestration; every side effect goes through `deps`. */
export async function runReview(ref: PullRef, inputs: RunInputs, deps: RunDeps): Promise<RunOutcome> {
  const { gh, provider, config, log } = deps;
  const repoFullName = `${ref.owner}/${ref.repo}`;

  const pr = await gh.getPullRequest(ref);
  if (pr.isFromFork) {
    return {
      status: "skipped",
      reason: `PR #${pr.number} comes from a fork (${pr.headRepoFullName ?? "deleted repo"}). On pull_request events fork PRs get a read-only token and no secrets, so nothing can be posted.`,
    };
  }

  // 1. Fetch and filter the changed files.
  const changed = await gh.listChangedFiles(ref);
  const filtered = filterFiles(changed, { ignore: config.ignore, maxFiles: inputs.maxFiles });
  for (const skip of filtered.skipped) log.debug(`skip ${skip.filename}: ${skip.reason}`);
  log.info(`${changed.length} changed file(s); ${filtered.kept.length} to review, ${filtered.skipped.length} skipped`);
  if (filtered.kept.length === 0) {
    return { status: "skipped", reason: "no reviewable files in this PR (all were binary, generated, lock files, or ignored)" };
  }

  // 2. Parse diffs, fetch head content for context, render each file for the prompt.
  const parsedFiles = new Map<string, ParsedFile>();
  const rendered: RenderedFile[] = [];
  const system = buildSystemPrompt(config);
  const headerForMeasure = renderPullRequestHeader(pr, repoFullName, filtered.kept.length, filtered.kept.length);
  const fixedTokens = await provider.countTokens({ model: inputs.model, system, user: headerForMeasure });
  const available = inputs.maxDiffTokens - fixedTokens;

  const parsedList = filtered.kept.map((file) => parseChangedFile(file));
  const contents = await mapWithConcurrency(parsedList, CONTENT_FETCH_CONCURRENCY, async (parsed) => {
    if (parsed.status === "removed" || config.contextLines === 0) return null;
    return gh.getFileContent(ref, parsed.filename, pr.headSha);
  });

  for (let i = 0; i < parsedList.length; i += 1) {
    const parsed = parsedList[i]!;
    parsedFiles.set(parsed.filename, parsed);
    const hunks = attachContext(parsed, contents[i] ?? null, config.contextLines);
    const parts = renderFile(parsed, hunks);
    const tokens = await provider.countTokens({ model: inputs.model, user: parts.text });
    let tokensWithoutContext = tokens;
    if (tokens > available && parts.textWithoutContext !== parts.text) {
      tokensWithoutContext = await provider.countTokens({ model: inputs.model, user: parts.textWithoutContext });
    }
    rendered.push({
      filename: parsed.filename,
      text: parts.text,
      tokens,
      textWithoutContext: parts.textWithoutContext,
      tokensWithoutContext,
      firstAddedLine: parts.firstAddedLine,
      firstAddedContent: parts.firstAddedContent,
    });
  }

  // 3. Batch under max_diff_tokens, measuring every request before it is sent.
  const plan = planBatches(rendered, inputs.maxDiffTokens, fixedTokens);
  const skipped: SkippedFile[] = [...filtered.skipped, ...plan.skipped];
  log.info(`planned ${plan.batches.length} batch(es); fixed prompt is ${fixedTokens} tokens, budget ${inputs.maxDiffTokens}`);

  const outputs: ReviewOutput[] = [];
  const incompleteBatches: IncompleteBatch[] = [];
  let usage: TokenUsage = EMPTY_USAGE;
  let batchesSent = 0;
  const queue = [...plan.batches];
  while (queue.length > 0) {
    const batch = queue.shift()!;
    const header = renderPullRequestHeader(pr, repoFullName, batch.length, rendered.length);
    const user = renderUserMessage(header, batch);
    const measured = await provider.countTokens({ model: inputs.model, system, user });
    if (measured > inputs.maxDiffTokens) {
      if (batch.length > 1) {
        log.info(`batch of ${batch.length} files measured ${measured} tokens, over ${inputs.maxDiffTokens}; splitting`);
        const [left, right] = splitBatch(batch);
        queue.unshift(left, right);
        continue;
      }
      const only = batch[0]!;
      skipped.push({ filename: only.filename, reason: `measured ${measured} tokens with the prompt, over max_diff_tokens (${inputs.maxDiffTokens})` });
      parsedFiles.delete(only.filename);
      continue;
    }

    batchesSent += 1;
    log.info(`sending batch ${batchesSent}: ${batch.length} file(s), ${measured} tokens`);
    const result = await provider.review({
      model: inputs.model,
      system,
      user,
      maxTokens: inputs.maxOutputTokens,
      effort: config.effort,
      files: batch.map((file) => ({
        filename: file.filename,
        firstAddedLine: file.firstAddedLine,
        firstAddedContent: file.firstAddedContent,
      })),
    });
    usage = addUsage(usage, result.usage);
    if (result.status === "ok") {
      outputs.push(result.output);
      log.info(`batch ${batchesSent}: ${result.output.findings.length} finding(s), verdict ${result.output.verdict}`);
    } else {
      log.warning(`batch ${batchesSent} incomplete (${result.reason}): ${result.detail}`);
      incompleteBatches.push({ files: batch.map((f) => f.filename), reason: result.detail });
    }
  }

  // 4. Validate, dedupe, and decide the outcome.
  const validation = validateFindings(
    outputs.flatMap((output) => output.findings),
    parsedFiles,
    { styleComments: config.styleComments, maxFindings: config.maxFindings },
  );
  const existingHashes = collectExistingHashes(await gh.listReviewComments(ref));
  const { fresh, duplicates } = splitDuplicates(validation.inline, existingHashes);

  const allInline = [...fresh, ...duplicates];
  const failing =
    inputs.failOn !== "none" && allInline.some((finding) => meetsSeverity(finding.severity, inputs.failOn as Severity));
  const event: ReviewEvent = failing ? "REQUEST_CHANGES" : "COMMENT";
  const verdict = outputs.reduce<Verdict | null>(
    (worst, output) => (worst === null || VERDICT_RANK[output.verdict] > VERDICT_RANK[worst] ? output.verdict : worst),
    null,
  );
  const summary =
    outputs.length > 0
      ? outputs.map((output) => output.summary.trim()).filter((s) => s !== "").join("\n\n")
      : "The review could not complete. See below for the reason; push again or comment `/ai-review` to retry.";

  const estimatedCostUsd = provider.name === "anthropic" ? estimateCost(inputs.model, usage) : 0;
  const body = buildReviewBody({
    model: inputs.model,
    providerName: provider.name,
    verdict,
    event,
    summary,
    inline: fresh,
    duplicates,
    notes: validation.notes,
    suppressedStyle: validation.suppressedStyle,
    usage,
    estimatedCostUsd,
    filesReviewed: parsedFiles.size,
    filesChanged: changed.length,
    skipped,
    truncatedAtMaxFiles: filtered.truncated ? inputs.maxFiles : null,
    batches: batchesSent,
    incompleteBatches,
    failOn: inputs.failOn,
    failing,
    headSha: pr.headSha,
  });
  const comments = fresh.map(buildInlineComment);

  // 5. Post exactly one review, then retire the previous one.
  const previous = previousBotReviews(await gh.listReviews(ref));
  const posted = await postReview(gh, ref, pr.headSha, event, body, comments);
  if (posted.fallbackUsed) log.warning("GitHub rejected the inline comment positions; they were folded into the review body");
  const retired = await supersedePreviousReviews(gh, ref, previous, posted.review.htmlUrl);
  if (retired.dismissed + retired.collapsed > 0) {
    log.info(`superseded ${retired.dismissed + retired.collapsed} earlier review(s)`);
  }

  return {
    status: "reviewed",
    reviewUrl: posted.review.htmlUrl,
    event,
    verdict,
    inlinePosted: posted.inlinePosted,
    duplicatesSkipped: duplicates.length,
    notes: validation.notes.length,
    filesReviewed: parsedFiles.size,
    batches: batchesSent,
    usage,
    estimatedCostUsd,
    failing,
  };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}
