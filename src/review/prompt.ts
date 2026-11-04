import type { ReviewConfig } from "../config.js";
import type { HunkWithContext } from "../diff/context.js";
import type { DiffLine, ParsedFile } from "../diff/types.js";
import type { PullRequestInfo } from "../github/api.js";
import type { RenderedFile } from "./batch.js";

/** PR descriptions longer than this are cut; they rarely help past the first screen. */
const MAX_DESCRIPTION_CHARS = 2000;

/**
 * The stable part of every request. It is byte-identical for all batches in a
 * run, so the Anthropic provider can mark it `cache_control: ephemeral` and
 * later batches read it from cache instead of paying for it again.
 */
export function buildSystemPrompt(config: ReviewConfig): string {
  const styleRule = config.styleComments
    ? "Style findings (formatting, naming, idioms) are allowed but rank below everything else."
    : "Do not report style findings (formatting, naming, idioms). The repository has them switched off.";
  const focusRule =
    config.focus.length > 0
      ? `Concentrate on these categories: ${config.focus.join(", ")}. Report something outside them only when it is clearly important.`
      : "All categories are in scope.";

  return [
    "You are a senior software engineer doing a focused code review of one pull request. You receive the unified diff of each changed file, plus a few surrounding lines of the current file for context, and you answer with a JSON review that follows the provided schema.",
    "",
    "## What to review",
    "- Review only what the diff changes. Lines marked `+` are new or changed. Lines marked `-` were removed. Lines with no marker and the CONTEXT sections are unchanged; they exist only to help you understand the change. Do not report problems in unchanged code unless the change is what introduces the problem.",
    "- Report real defects first: bugs, security vulnerabilities, logic and correctness errors, data loss, concurrency and ordering problems, resource leaks, swallowed or mishandled errors, missing `await`, wrong comparisons, off-by-one errors, injection, hard-coded secrets. Then performance problems with a measurable effect. Then tests that are missing, wrong, or no longer test what they claim.",
    "- No filler. No praise, no restating what the diff does, no generic advice such as \"consider adding comments\" or \"add more tests\" without a concrete gap. If the change is fine, return an empty findings list and say so in the summary.",
    `- Report at most ${config.maxFindings} findings. Prefer the most severe ones. Merge findings that share a root cause into one.`,
    `- ${focusRule}`,
    `- ${styleRule}`,
    "",
    "## Anchoring rules (strict)",
    "- Every finding must point at exactly one line marked `+`. Use the line number printed on that line and the file path printed in the `=== FILE:` header, verbatim. Findings that point anywhere else are discarded by the tooling before anyone sees them.",
    "- If a problem spans several lines, anchor it on the single most relevant `+` line and describe the span in the explanation.",
    "- `suggestion` must be a drop-in replacement for exactly that one line: complete, valid code with the original indentation, no diff markers, no line numbers, no prose. It may contain several lines if the one flagged line should become several. Omit `suggestion` when a correct replacement for that one line is not possible.",
    "",
    "## Severity",
    "- critical: will cause data loss, a security breach, or an outage once merged.",
    "- high: wrong behaviour on realistic inputs, or a security weakness that takes some effort to exploit.",
    "- medium: a bug on edge cases, or a correctness problem that is likely to bite later.",
    "- low: a minor correctness or robustness issue.",
    "- nit: trivial. Only report when nothing else matters.",
    "",
    "## Categories",
    "bug, security, performance, correctness, test, style. Pick the one that best describes the root cause.",
    "",
    "## Verdict",
    "- request_changes: at least one finding is high or critical.",
    "- comment: there are findings, but none is high or critical.",
    "- approve: nothing worth fixing.",
    "",
    "## Writing",
    `- Write titles, explanations and the summary in the language with code \`${config.language}\`. Keep code identifiers as they are.`,
    "- Be specific. Name the variable, the input, and the case that fails. One finding, one problem.",
    "- The summary is two to five sentences: what the change does and the most important risks. It is not a list of the findings.",
  ].join("\n");
}

export function renderPullRequestHeader(
  pr: PullRequestInfo,
  repoFullName: string,
  filesInBatch: number,
  reviewableFiles: number,
): string {
  const description = (pr.body ?? "").trim();
  const trimmed =
    description.length > MAX_DESCRIPTION_CHARS
      ? `${description.slice(0, MAX_DESCRIPTION_CHARS)}\n[description truncated]`
      : description;
  return [
    `Repository: ${repoFullName}`,
    `Pull request #${pr.number}: ${pr.title}`,
    `Branch: ${pr.headRef} -> ${pr.baseRef}`,
    `Author: ${pr.authorLogin}`,
    "Description:",
    trimmed === "" ? "(none)" : trimmed,
    "",
    `This batch contains ${filesInBatch} of ${reviewableFiles} reviewable file(s). Review every file below.`,
    "",
  ].join("\n");
}

/** Full user message for one batch. */
export function renderUserMessage(header: string, files: RenderedFile[]): string {
  return `${header}${files.map((file) => file.text).join("\n\n")}\n`;
}

export interface RenderedParts {
  text: string;
  textWithoutContext: string;
  firstAddedLine: number | null;
  firstAddedContent: string | null;
}

/** Render one file as the model sees it: a header, then hunks with context windows between them. */
export function renderFile(file: ParsedFile, hunks: HunkWithContext[]): RenderedParts {
  const headerParts = [`=== FILE: ${file.filename} (${file.status}`];
  if (file.previousFilename) headerParts.push(`, renamed from ${file.previousFilename}`);
  headerParts.push(") ===");
  const header = headerParts.join("");

  const withContext: string[] = [header];
  const withoutContext: string[] = [header];
  let firstAddedLine: number | null = null;
  let firstAddedContent: string | null = null;

  for (const { hunk, before, after } of hunks) {
    if (before) {
      withContext.push(
        `--- CONTEXT (unchanged, lines ${before.start}-${before.end}; not part of the diff) ---`,
      );
      before.lines.forEach((line, i) => withContext.push(formatContextLine(before.start + i, line)));
    }
    const hunkText = [`--- DIFF ${hunk.header.replace(/^@@ (.*?) @@.*$/, "@@ $1 @@")} ---`];
    for (const line of hunk.lines) {
      hunkText.push(formatDiffLine(line));
      if (line.noNewlineAtEnd) hunkText.push("         | \\ No newline at end of file");
      if (line.kind === "add" && firstAddedLine === null && line.newLine !== null) {
        firstAddedLine = line.newLine;
        firstAddedContent = line.content;
      }
    }
    withContext.push(...hunkText);
    withoutContext.push(...hunkText);
    if (after) {
      withContext.push(
        `--- CONTEXT (unchanged, lines ${after.start}-${after.end}; not part of the diff) ---`,
      );
      after.lines.forEach((line, i) => withContext.push(formatContextLine(after.start + i, line)));
    }
  }
  if (hunks.length === 0) {
    withContext.push("(no textual changes)");
    withoutContext.push("(no textual changes)");
  }

  return {
    text: withContext.join("\n"),
    textWithoutContext: withoutContext.join("\n"),
    firstAddedLine,
    firstAddedContent,
  };
}

function formatDiffLine(line: DiffLine): string {
  const marker = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
  const number = line.newLine === null ? "" : String(line.newLine);
  return `${marker}${number.padStart(7)} | ${line.content}`;
}

function formatContextLine(lineNumber: number, content: string): string {
  return ` ${String(lineNumber).padStart(7)} | ${content}`;
}
