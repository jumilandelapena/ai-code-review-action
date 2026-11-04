import type { ChangedFile } from "../diff/types.js";

/**
 * The narrow slice of the GitHub REST API this action depends on. Keeping it
 * behind an interface lets the end-to-end test run against recorded fixtures
 * instead of the network, and keeps Octokit types out of the review logic.
 */

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface PullRef extends RepoRef {
  number: number;
}

export interface PullRequestInfo {
  number: number;
  title: string;
  body: string | null;
  headSha: string;
  baseSha: string;
  headRef: string;
  baseRef: string;
  /** `owner/name` of the repo the head branch lives in; `null` if that repo was deleted. */
  headRepoFullName: string | null;
  baseRepoFullName: string;
  /** True when the head branch lives in a different repository (a fork). */
  isFromFork: boolean;
  authorLogin: string;
  htmlUrl: string;
}

export interface ExistingReview {
  id: number;
  body: string;
  /** `COMMENTED`, `CHANGES_REQUESTED`, `APPROVED`, `DISMISSED`, `PENDING`. */
  state: string;
  userLogin: string;
  htmlUrl: string;
}

export interface ExistingReviewComment {
  id: number;
  body: string;
  path: string;
  line: number | null;
}

export interface InlineComment {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
}

export type ReviewEvent = "COMMENT" | "REQUEST_CHANGES";

export interface CreateReviewParams {
  commitId: string;
  event: ReviewEvent;
  body: string;
  comments: InlineComment[];
}

export interface CreatedReview {
  id: number;
  htmlUrl: string;
}

export interface GitHubApi {
  getPullRequest(ref: PullRef): Promise<PullRequestInfo>;
  listChangedFiles(ref: PullRef): Promise<ChangedFile[]>;
  /** UTF-8 text of a file at a commit, or `null` when it is missing, a directory, or too large. */
  getFileContent(repo: RepoRef, path: string, ref: string): Promise<string | null>;
  listReviews(ref: PullRef): Promise<ExistingReview[]>;
  listReviewComments(ref: PullRef): Promise<ExistingReviewComment[]>;
  createReview(ref: PullRef, params: CreateReviewParams): Promise<CreatedReview>;
  dismissReview(ref: PullRef, reviewId: number, message: string): Promise<void>;
  updateReview(ref: PullRef, reviewId: number, body: string): Promise<void>;
}

/** Error raised by the GitHub client when a request is rejected; carries the HTTP status. */
export class GitHubRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GitHubRequestError";
  }
}

export function isUnprocessable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: unknown }).status === 422
  );
}
