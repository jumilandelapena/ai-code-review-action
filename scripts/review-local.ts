/**
 * Review a real pull request from your machine.
 *
 *   pnpm review:local --repo owner/name --pr 12 [--model claude-opus-5-5] [--fail-on high] [--dry-run]
 *
 * Reads ANTHROPIC_API_KEY, GITHUB_TOKEN and LLM_PROVIDER from the environment or
 * from a `.env` file next to package.json. With LLM_PROVIDER=mock no model is called.
 * `--dry-run` runs the whole pipeline but prints the review instead of posting it.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseConfig } from "../src/config.js";
import { OctokitGitHubApi } from "../src/github/octokit.js";
import type { CreateReviewParams, CreatedReview, GitHubApi, PullRef } from "../src/github/api.js";
import { consoleLogger } from "../src/log.js";
import { AnthropicReviewProvider } from "../src/review/anthropic.js";
import { MockReviewProvider } from "../src/review/mock.js";
import { isSeverity, type Severity } from "../src/review/schema.js";
import { runReview } from "../src/run.js";

function loadDotEnv(): void {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Wraps the real client so `--dry-run` never writes to GitHub. */
class DryRunGitHubApi implements GitHubApi {
  constructor(private readonly inner: GitHubApi) {}
  getPullRequest = (ref: PullRef) => this.inner.getPullRequest(ref);
  listChangedFiles = (ref: PullRef) => this.inner.listChangedFiles(ref);
  getFileContent = (repo: PullRef, path: string, ref: string) => this.inner.getFileContent(repo, path, ref);
  listReviews = (ref: PullRef) => this.inner.listReviews(ref);
  listReviewComments = (ref: PullRef) => this.inner.listReviewComments(ref);
  async createReview(_ref: PullRef, params: CreateReviewParams): Promise<CreatedReview> {
    console.log("\n===== DRY RUN: review body =====\n");
    console.log(params.body);
    console.log(`\n===== DRY RUN: ${params.comments.length} inline comment(s) (event ${params.event}) =====\n`);
    for (const comment of params.comments) {
      console.log(`--- ${comment.path}:${comment.line} ---\n${comment.body}\n`);
    }
    return { id: 0, htmlUrl: "(dry run, nothing posted)" };
  }
  async dismissReview(): Promise<void> {
    console.log("(dry run) would dismiss the previous review");
  }
  async updateReview(): Promise<void> {
    console.log("(dry run) would collapse the previous review");
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const repo = arg("repo");
  const pr = Number(arg("pr"));
  if (!repo || !repo.includes("/") || !Number.isInteger(pr)) {
    console.error("usage: pnpm review:local --repo owner/name --pr <number> [--model id] [--fail-on severity] [--dry-run]");
    process.exit(2);
  }
  const [owner, name] = repo.split("/") as [string, string];
  const token = process.env["GITHUB_TOKEN"];
  if (!token) {
    console.error("GITHUB_TOKEN is required (a token with pull-requests:write on the repo)");
    process.exit(2);
  }
  const failOnRaw = (arg("fail-on") ?? "none").toLowerCase();
  const failOn: Severity | "none" = failOnRaw === "none" ? "none" : isSeverity(failOnRaw) ? failOnRaw : "none";

  const providerName = (process.env["LLM_PROVIDER"] ?? "anthropic").toLowerCase();
  const apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";
  if (providerName !== "mock" && apiKey === "") {
    console.error("ANTHROPIC_API_KEY is required unless LLM_PROVIDER=mock");
    process.exit(2);
  }
  const provider = providerName === "mock" ? new MockReviewProvider() : new AnthropicReviewProvider(apiKey);

  const configPath = resolve(process.cwd(), ".github/ai-review.yml");
  const loaded = parseConfig(existsSync(configPath) ? readFileSync(configPath, "utf8") : null);
  for (const warning of loaded.warnings) console.warn(`warning: ${warning}`);

  const real = new OctokitGitHubApi(token);
  const gh = flag("dry-run") ? new DryRunGitHubApi(real) : real;
  const outcome = await runReview(
    { owner, repo: name, number: pr },
    {
      model: arg("model") ?? "claude-opus-5-5",
      failOn,
      maxFiles: Number(arg("max-files") ?? 40),
      maxDiffTokens: Number(arg("max-diff-tokens") ?? 60_000),
      maxOutputTokens: 16_000,
    },
    { gh, provider, config: loaded.config, log: consoleLogger },
  );
  console.log(JSON.stringify(outcome, null, 2));
  if (outcome.status === "reviewed" && outcome.failing) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
