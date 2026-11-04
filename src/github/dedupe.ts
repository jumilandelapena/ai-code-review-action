import { createHash } from "node:crypto";
import type { Finding } from "../review/schema.js";
import type { ExistingReview, ExistingReviewComment, GitHubApi, PullRef } from "./api.js";

/** Marks the review body so later runs can find it. */
export const REVIEW_MARKER = "<!-- ai-code-review -->";
/** Added to a review body once a newer review has replaced it. */
export const SUPERSEDED_MARKER = "<!-- ai-code-review:superseded -->";

const FINDING_MARKER_RE = /<!-- ai-code-review:finding:([a-f0-9]{16}) -->/g;

/** Stable identity of a finding: same file, same line, same (normalised) title. */
export function findingHash(file: string, line: number, title: string): string {
  const normalisedTitle = title.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256").update(`${file}\n${line}\n${normalisedTitle}`).digest("hex").slice(0, 16);
}

export function findingMarker(hash: string): string {
  return `<!-- ai-code-review:finding:${hash} -->`;
}

/** Every finding hash already present in the PR's inline review comments. */
export function collectExistingHashes(comments: ExistingReviewComment[]): Set<string> {
  const hashes = new Set<string>();
  for (const comment of comments) {
    for (const match of comment.body.matchAll(FINDING_MARKER_RE)) {
      if (match[1]) hashes.add(match[1]);
    }
  }
  return hashes;
}

export interface DedupeResult {
  fresh: Finding[];
  duplicates: Finding[];
}

/** Split findings into ones never posted before and ones that already exist on the PR. */
export function splitDuplicates(findings: Finding[], existing: Set<string>): DedupeResult {
  const fresh: Finding[] = [];
  const duplicates: Finding[] = [];
  const seenInThisRun = new Set<string>();
  for (const finding of findings) {
    const hash = findingHash(finding.file, finding.line, finding.title);
    if (existing.has(hash) || seenInThisRun.has(hash)) {
      duplicates.push(finding);
    } else {
      seenInThisRun.add(hash);
      fresh.push(finding);
    }
  }
  return { fresh, duplicates };
}

/** Earlier reviews from this action that have not been superseded yet. */
export function previousBotReviews(reviews: ExistingReview[]): ExistingReview[] {
  return reviews.filter(
    (review) =>
      review.body.includes(REVIEW_MARKER) &&
      !review.body.includes(SUPERSEDED_MARKER) &&
      review.state !== "DISMISSED",
  );
}

/**
 * Retire earlier bot reviews so only the newest one speaks for the current
 * head. GitHub only lets a review be dismissed when it requested changes or
 * approved; a plain COMMENT review is instead collapsed to a one-line stub.
 */
export async function supersedePreviousReviews(
  gh: GitHubApi,
  ref: PullRef,
  previous: ExistingReview[],
  newReviewUrl: string,
): Promise<{ dismissed: number; collapsed: number }> {
  let dismissed = 0;
  let collapsed = 0;
  for (const review of previous) {
    const message = `Superseded by a newer AI review: ${newReviewUrl}`;
    if (review.state === "CHANGES_REQUESTED" || review.state === "APPROVED") {
      await gh.dismissReview(ref, review.id, message);
      dismissed += 1;
    } else {
      await gh.updateReview(ref, review.id, `${REVIEW_MARKER}\n${SUPERSEDED_MARKER}\n_${message}_`);
      collapsed += 1;
    }
  }
  return { dismissed, collapsed };
}
