import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChangedFile } from "../../src/diff/types.js";
import type {
  CreateReviewParams,
  CreatedReview,
  ExistingReview,
  ExistingReviewComment,
  GitHubApi,
  PullRef,
  PullRequestInfo,
  RepoRef,
} from "../../src/github/api.js";
import { toChangedFile, toPullRequestInfo, type RawListFilesEntry, type RawPullRequest } from "../../src/github/octokit.js";

const here = dirname(fileURLToPath(import.meta.url));

export interface RecordedFixture {
  pull: RawPullRequest;
  files: RawListFilesEntry[];
  /** Head-revision contents keyed by path. */
  contents: Record<string, string>;
}

/** Load `test/fixtures/<name>/{pull,files,contents}.json`, recorded from the real GitHub API shapes. */
export function loadFixture(name: string): RecordedFixture {
  const dir = join(here, "..", "fixtures", name);
  const read = (file: string) => JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
  return {
    pull: read("pull.json") as RawPullRequest,
    files: read("files.json") as RawListFilesEntry[],
    contents: read("contents.json") as Record<string, string>,
  };
}

export interface FakeCall {
  method: string;
  args: unknown[];
}

/**
 * In-memory GitHub that serves recorded fixtures and remembers what was posted,
 * so a second run can see the first run's review and inline comments.
 */
export class FakeGitHubApi implements GitHubApi {
  readonly calls: FakeCall[] = [];
  readonly reviews: ExistingReview[] = [];
  readonly comments: ExistingReviewComment[] = [];
  /** When set, the next `createReview` with inline comments throws this error. */
  failNextCreateWith: unknown = null;
  private nextId = 1000;

  constructor(private readonly fixture: RecordedFixture) {}

  async getPullRequest(ref: PullRef): Promise<PullRequestInfo> {
    this.calls.push({ method: "getPullRequest", args: [ref] });
    return toPullRequestInfo(this.fixture.pull);
  }

  async listChangedFiles(ref: PullRef): Promise<ChangedFile[]> {
    this.calls.push({ method: "listChangedFiles", args: [ref] });
    return this.fixture.files.map(toChangedFile);
  }

  async getFileContent(repo: RepoRef, path: string, ref: string): Promise<string | null> {
    this.calls.push({ method: "getFileContent", args: [repo, path, ref] });
    return this.fixture.contents[path] ?? null;
  }

  async listReviews(ref: PullRef): Promise<ExistingReview[]> {
    this.calls.push({ method: "listReviews", args: [ref] });
    return [...this.reviews];
  }

  async listReviewComments(ref: PullRef): Promise<ExistingReviewComment[]> {
    this.calls.push({ method: "listReviewComments", args: [ref] });
    return [...this.comments];
  }

  async createReview(ref: PullRef, params: CreateReviewParams): Promise<CreatedReview> {
    this.calls.push({ method: "createReview", args: [ref, params] });
    if (this.failNextCreateWith !== null && params.comments.length > 0) {
      const error = this.failNextCreateWith;
      this.failNextCreateWith = null;
      throw error;
    }
    const id = this.nextId++;
    const state = params.event === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "COMMENTED";
    const htmlUrl = `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}#pullrequestreview-${id}`;
    this.reviews.push({ id, body: params.body, state, userLogin: "github-actions[bot]", htmlUrl });
    for (const comment of params.comments) {
      this.comments.push({ id: this.nextId++, body: comment.body, path: comment.path, line: comment.line });
    }
    return { id, htmlUrl };
  }

  async dismissReview(ref: PullRef, reviewId: number, message: string): Promise<void> {
    this.calls.push({ method: "dismissReview", args: [ref, reviewId, message] });
    const review = this.reviews.find((r) => r.id === reviewId);
    if (review) review.state = "DISMISSED";
  }

  async updateReview(ref: PullRef, reviewId: number, body: string): Promise<void> {
    this.calls.push({ method: "updateReview", args: [ref, reviewId, body] });
    const review = this.reviews.find((r) => r.id === reviewId);
    if (review) review.body = body;
  }

  createReviewCalls(): CreateReviewParams[] {
    return this.calls.filter((c) => c.method === "createReview").map((c) => c.args[1] as CreateReviewParams);
  }
}
