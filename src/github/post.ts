import { formatUsage, formatUsd } from "../cost.js";
import type { SkippedFile } from "../diff/types.js";
import type { TokenUsage } from "../review/provider.js";
import { SEVERITIES, type Finding, type Severity, type Verdict } from "../review/schema.js";
import type { FileNote } from "../review/validate.js";
import { findingHash, findingMarker, REVIEW_MARKER } from "./dedupe.js";
import {
  isUnprocessable,
  type CreatedReview,
  type GitHubApi,
  type InlineComment,
  type PullRef,
  type ReviewEvent,
} from "./api.js";

const SEVERITY_ICON: Record<Severity, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
  nit: "⚪",
};

export interface IncompleteBatch {
  files: string[];
  reason: string;
}

export interface ReviewBodyInput {
  model: string;
  providerName: string;
  verdict: Verdict | null;
  event: ReviewEvent;
  summary: string;
  inline: Finding[];
  duplicates: Finding[];
  notes: FileNote[];
  suppressedStyle: number;
  usage: TokenUsage;
  estimatedCostUsd: number | null;
  filesReviewed: number;
  filesChanged: number;
  skipped: SkippedFile[];
  truncatedAtMaxFiles: number | null;
  batches: number;
  incompleteBatches: IncompleteBatch[];
  failOn: Severity | "none";
  failing: boolean;
  headSha: string;
}

export function buildInlineComment(finding: Finding): InlineComment {
  const hash = findingHash(finding.file, finding.line, finding.title);
  const parts = [
    `${SEVERITY_ICON[finding.severity]} **${finding.severity}** · ${finding.category} — **${escapeInline(finding.title)}**`,
    "",
    finding.explanation,
  ];
  if (finding.suggestion !== undefined) {
    parts.push("", "```suggestion", finding.suggestion, "```");
  }
  parts.push("", findingMarker(hash));
  return { path: finding.file, line: finding.line, side: "RIGHT", body: parts.join("\n") };
}

export function severityTable(findings: Finding[]): string {
  const counts = new Map<Severity, number>();
  for (const severity of SEVERITIES) counts.set(severity, 0);
  for (const finding of findings) counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  const header = `| ${SEVERITIES.map((s) => `${SEVERITY_ICON[s]} ${s}`).join(" | ")} |`;
  const divider = `|${SEVERITIES.map(() => " :-: ").join("|")}|`;
  const row = `| ${SEVERITIES.map((s) => String(counts.get(s) ?? 0)).join(" | ")} |`;
  return [header, divider, row].join("\n");
}

export function buildReviewBody(input: ReviewBodyInput): string {
  const lines: string[] = [REVIEW_MARKER, `## 🤖 AI code review`, ""];

  const allFindings = [...input.inline, ...input.duplicates];
  const verdictText = input.verdict ?? "n/a";
  lines.push(
    `**Verdict:** \`${verdictText}\` · **Model:** \`${input.model}\`${input.providerName !== "anthropic" ? ` (${input.providerName} provider)` : ""} · **Head:** \`${input.headSha.slice(0, 7)}\``,
  );
  if (input.failing) {
    lines.push("", `❌ **Check failed:** at least one finding is \`${input.failOn}\` or more severe (\`fail_on: ${input.failOn}\`).`);
  }
  lines.push("", severityTable(allFindings), "");
  lines.push(input.summary.trim() === "" ? "_No summary was produced._" : input.summary.trim());

  if (input.inline.length === 0 && input.duplicates.length === 0 && input.incompleteBatches.length === 0) {
    lines.push("", "No findings. Nothing in this diff looked wrong to the reviewer.");
  }
  if (input.duplicates.length > 0) {
    lines.push(
      "",
      `_${input.duplicates.length} finding(s) were already posted on an earlier push and were not repeated._`,
    );
  }

  if (input.notes.length > 0) {
    lines.push("", "### File-level notes", "", "_These findings could not be placed on a changed line, so they are listed here instead of being dropped._", "");
    for (const note of input.notes) {
      const where = note.line === null ? `\`${note.file}\`` : `\`${note.file}\` (line ${note.line})`;
      lines.push(`- ${SEVERITY_ICON[note.severity]} **${note.severity}** · ${note.category} · ${where}: **${escapeInline(note.title)}** — ${note.explanation} _(${note.reason})_`);
    }
  }

  if (input.incompleteBatches.length > 0) {
    lines.push("", "### Review could not complete for some files", "");
    for (const batch of input.incompleteBatches) {
      lines.push(`- ${batch.reason}: ${batch.files.map((f) => `\`${f}\``).join(", ")}`);
    }
  }

  lines.push("", "<details>", "<summary>Coverage, tokens and cost</summary>", "");
  lines.push(`- Files reviewed: ${input.filesReviewed} of ${input.filesChanged} changed` + (input.batches > 1 ? ` in ${input.batches} batches` : ""));
  if (input.truncatedAtMaxFiles !== null) {
    lines.push(`- ⚠️ Stopped at \`max_files: ${input.truncatedAtMaxFiles}\`; the remaining files were not reviewed.`);
  }
  if (input.skipped.length > 0) {
    lines.push(`- Skipped ${input.skipped.length} file(s):`);
    for (const skip of input.skipped.slice(0, 25)) lines.push(`  - \`${skip.filename}\`: ${skip.reason}`);
    if (input.skipped.length > 25) lines.push(`  - … and ${input.skipped.length - 25} more`);
  }
  if (input.suppressedStyle > 0) {
    lines.push(`- ${input.suppressedStyle} style finding(s) suppressed (\`style_comments: false\`)`);
  }
  lines.push(`- Tokens: ${formatUsage(input.usage)}`);
  lines.push(`- Estimated cost: ${formatUsd(input.estimatedCostUsd)}`);
  lines.push("", "</details>");
  return lines.join("\n");
}

export interface PostResult {
  review: CreatedReview;
  inlinePosted: number;
  /** True when GitHub rejected the inline comments and the body-only fallback was used. */
  fallbackUsed: boolean;
}

/**
 * Create exactly one review. If GitHub still rejects the inline comments
 * (for example because the diff shown in the API was truncated), post the
 * same review with the comments folded into the body instead of failing.
 */
export async function postReview(
  gh: GitHubApi,
  ref: PullRef,
  headSha: string,
  event: ReviewEvent,
  body: string,
  comments: InlineComment[],
): Promise<PostResult> {
  try {
    const review = await gh.createReview(ref, { commitId: headSha, event, body, comments });
    return { review, inlinePosted: comments.length, fallbackUsed: false };
  } catch (error) {
    if (!isUnprocessable(error) || comments.length === 0) throw error;
  }
  const folded = [
    body,
    "",
    "### Inline comments (GitHub rejected their positions, listed here instead)",
    "",
    ...comments.map((c) => `- \`${c.path}\` line ${c.line}:\n\n${indent(c.body)}`),
  ].join("\n");
  const review = await gh.createReview(ref, { commitId: headSha, event, body: folded, comments: [] });
  return { review, inlinePosted: 0, fallbackUsed: true };
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function escapeInline(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
