import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { ConfigError, parseConfig } from "./config.js";
import { resolveTrigger } from "./context.js";
import { OctokitGitHubApi } from "./github/octokit.js";
import type { Logger } from "./log.js";
import { AnthropicReviewProvider } from "./review/anthropic.js";
import { MockReviewProvider } from "./review/mock.js";
import type { ReviewProvider } from "./review/provider.js";
import { isSeverity, type Severity } from "./review/schema.js";
import { runReview } from "./run.js";

const DEFAULT_MODEL = "claude-opus-5-5";
const MAX_OUTPUT_TOKENS = 16_000;

const actionsLogger: Logger = {
  debug: (message) => core.debug(message),
  info: (message) => core.info(message),
  warning: (message) => core.warning(message),
};

function intInput(name: string, fallback: number): number {
  const raw = core.getInput(name).trim();
  if (raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`input ${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

function floatInput(name: string, fallback: number): number {
  const raw = core.getInput(name).trim();
  if (raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`input ${name} must be a non-negative number, got "${raw}"`);
  }
  return value;
}

function failOnInput(): Severity | "none" {
  const raw = (core.getInput("fail_on").trim() || "none").toLowerCase();
  if (raw === "none") return "none";
  if (isSeverity(raw)) return raw;
  throw new Error(`input fail_on must be one of none, critical, high, medium, low, nit; got "${raw}"`);
}

function buildProvider(apiKey: string): ReviewProvider {
  const providerName = (process.env["LLM_PROVIDER"] ?? "anthropic").toLowerCase();
  if (providerName === "mock") {
    core.info("LLM_PROVIDER=mock: using the mock reviewer, no API calls will be made");
    return new MockReviewProvider();
  }
  if (providerName !== "anthropic") {
    throw new Error(`LLM_PROVIDER must be "anthropic" or "mock", got "${providerName}"`);
  }
  if (apiKey === "") {
    throw new Error("input anthropic_api_key is required (set it from a repository secret), or set LLM_PROVIDER=mock");
  }
  return new AnthropicReviewProvider(apiKey);
}

async function main(): Promise<void> {
  const apiKey = core.getInput("anthropic_api_key").trim();
  if (apiKey !== "") core.setSecret(apiKey);
  const token = core.getInput("github_token", { required: true });
  core.setSecret(token);

  const model = core.getInput("model").trim() || DEFAULT_MODEL;
  const configPath = core.getInput("config_path").trim() || ".github/ai-review.yml";
  const failOn = failOnInput();
  const maxFiles = intInput("max_files", 40);
  const maxDiffTokens = intInput("max_diff_tokens", 60_000);
  const maxCostUsd = floatInput("max_cost_usd", 0);

  const trigger = resolveTrigger({
    eventName: github.context.eventName,
    repo: github.context.repo,
    payload: github.context.payload as Record<string, unknown>,
  });
  if (trigger.kind === "none") {
    core.info(`Nothing to review: ${trigger.reason}`);
    core.setOutput("status", "skipped");
    return;
  }
  core.info(
    trigger.kind === "comment"
      ? `Review requested by @${trigger.commenter} on PR #${trigger.ref.number}`
      : `Reviewing PR #${trigger.ref.number} (${trigger.action})`,
  );

  const absoluteConfigPath = resolve(process.cwd(), configPath);
  const configSource = existsSync(absoluteConfigPath) ? readFileSync(absoluteConfigPath, "utf8") : null;
  const loaded = parseConfig(configSource, configPath);
  for (const warning of loaded.warnings) core.warning(warning);
  core.info(loaded.found ? `Loaded config from ${configPath}` : `No ${configPath}; using defaults`);

  const provider = buildProvider(apiKey);
  const outcome = await runReview(
    trigger.ref,
    { model, failOn, maxFiles, maxDiffTokens, maxOutputTokens: MAX_OUTPUT_TOKENS, maxCostUsd },
    { gh: new OctokitGitHubApi(token), provider, config: loaded.config, log: actionsLogger },
  );

  core.setOutput("status", outcome.status);
  if (outcome.status === "skipped") {
    core.notice(`Review skipped: ${outcome.reason}`);
    return;
  }
  core.setOutput("review_url", outcome.reviewUrl);
  core.setOutput("findings_count", String(outcome.inlinePosted + outcome.notes));
  core.setOutput("verdict", outcome.verdict ?? "");
  core.setOutput("estimated_cost_usd", outcome.estimatedCostUsd === null ? "" : outcome.estimatedCostUsd.toFixed(4));
  core.info(
    `Posted review ${outcome.reviewUrl}: ${outcome.inlinePosted} inline comment(s), ${outcome.notes} note(s), ${outcome.duplicatesSkipped} duplicate(s) skipped, ${outcome.batches} batch(es), est. cost ${outcome.estimatedCostUsd === null ? "n/a" : `$${outcome.estimatedCostUsd.toFixed(4)}`}`,
  );
  if (outcome.failing) {
    core.setFailed(`Findings at or above fail_on=${failOn} were reported; see ${outcome.reviewUrl}`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    core.setFailed(error.message);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  core.setFailed(`ai-code-review failed: ${message}`);
});
