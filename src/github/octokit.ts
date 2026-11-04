import * as github from "@actions/github";
import type { ChangedFile, FileStatus } from "../diff/types.js";
import { withRetry } from "./retry.js";
import type {
  CreateReviewParams,
  CreatedReview,
  ExistingReview,
  ExistingReviewComment,
  GitHubApi,
  PullRef,
  PullRequestInfo,
  RepoRef,
} from "./api.js";

type Octokit = ReturnType<typeof github.getOctokit>;

/** Files larger than this come back from `repos.getContent` without inline content. */
const MAX_CONTENT_BYTES = 1_000_000;

/** Shape of one `pulls.listFiles` entry; structural so recorded fixtures can reuse the mapping. */
export interface RawListFilesEntry {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string | undefined;
  previous_filename?: string | undefined;
}

/** Shape of the `pulls.get` fields this action reads. */
export interface RawPullRequest {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  user: { login: string } | null;
  head: { sha: string; ref: string; repo: { full_name: string } | null };
  base: { sha: string; ref: string; repo: { full_name: string } };
}

export function toChangedFile(file: RawListFilesEntry): ChangedFile {
  const changed: ChangedFile = {
    filename: file.filename,
    status: file.status as FileStatus,
    additions: file.additions,
    deletions: file.deletions,
  };
  if (file.patch !== undefined) changed.patch = file.patch;
  if (file.previous_filename !== undefined) changed.previousFilename = file.previous_filename;
  return changed;
}

export function toPullRequestInfo(data: RawPullRequest): PullRequestInfo {
  const headRepo = data.head.repo?.full_name ?? null;
  const baseRepo = data.base.repo.full_name;
  return {
    number: data.number,
    title: data.title,
    body: data.body,
    headSha: data.head.sha,
    baseSha: data.base.sha,
    headRef: data.head.ref,
    baseRef: data.base.ref,
    headRepoFullName: headRepo,
    baseRepoFullName: baseRepo,
    isFromFork: headRepo === null || headRepo !== baseRepo,
    authorLogin: data.user?.login ?? "unknown",
    htmlUrl: data.html_url,
  };
}

/** `GitHubApi` backed by Octokit. Every call is a thin mapping; no review logic lives here. */
export class OctokitGitHubApi implements GitHubApi {
  private readonly octokit: Octokit;

  constructor(token: string) {
    this.octokit = github.getOctokit(token);
  }

  async getPullRequest(ref: PullRef): Promise<PullRequestInfo> {
    const { data } = await this.octokit.rest.pulls.get({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
    });
    return toPullRequestInfo(data);
  }

  async listChangedFiles(ref: PullRef): Promise<ChangedFile[]> {
    const files = await withRetry(() =>
      this.octokit.paginate(this.octokit.rest.pulls.listFiles, {
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
        per_page: 100,
      }),
    );
    return files.map(toChangedFile);
  }

  async getFileContent(repo: RepoRef, path: string, ref: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner: repo.owner,
        repo: repo.repo,
        path,
        ref,
      });
      if (Array.isArray(data) || data.type !== "file") return null;
      if (data.size > MAX_CONTENT_BYTES || data.encoding !== "base64" || !data.content) return null;
      return Buffer.from(data.content, "base64").toString("utf8");
    } catch (error) {
      if (typeof error === "object" && error !== null && "status" in error) {
        const status = (error as { status: unknown }).status;
        if (status === 404 || status === 403) return null;
      }
      throw error;
    }
  }

  async listReviews(ref: PullRef): Promise<ExistingReview[]> {
    const reviews = await this.octokit.paginate(this.octokit.rest.pulls.listReviews, {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      per_page: 100,
    });
    return reviews.map((review) => ({
      id: review.id,
      body: review.body ?? "",
      state: review.state,
      userLogin: review.user?.login ?? "",
      htmlUrl: review.html_url,
    }));
  }

  async listReviewComments(ref: PullRef): Promise<ExistingReviewComment[]> {
    const comments = await this.octokit.paginate(this.octokit.rest.pulls.listReviewComments, {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      per_page: 100,
    });
    return comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      path: comment.path,
      line: comment.line ?? null,
    }));
  }

  async createReview(ref: PullRef, params: CreateReviewParams): Promise<CreatedReview> {
    const { data } = await withRetry(() =>
      this.octokit.rest.pulls.createReview({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
        commit_id: params.commitId,
        event: params.event,
        body: params.body,
        comments: params.comments.map((comment) => ({
          path: comment.path,
          line: comment.line,
          side: comment.side,
          body: comment.body,
        })),
      }),
    );
    return { id: data.id, htmlUrl: data.html_url };
  }

  async dismissReview(ref: PullRef, reviewId: number, message: string): Promise<void> {
    await this.octokit.rest.pulls.dismissReview({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      review_id: reviewId,
      message,
    });
  }

  async updateReview(ref: PullRef, reviewId: number, body: string): Promise<void> {
    await this.octokit.rest.pulls.updateReview({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      review_id: reviewId,
      body,
    });
  }
}
