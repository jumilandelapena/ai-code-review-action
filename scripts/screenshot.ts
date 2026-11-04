/**
 * Capture a real inline review comment (with its suggestion block) as a PNG.
 *
 *   pnpm screenshot --repo owner/name --pr 1 [--out docs/example-review.png]
 *
 * Finds the first inline comment this action posted on the PR (via the
 * GitHub API), opens it in headless Chromium and screenshots that comment.
 * Needs GITHUB_TOKEN in the environment or .env, and a Chromium from
 * `npx playwright-core install chromium` (or an existing Playwright cache).
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as github from "@actions/github";
import { chromium } from "playwright-core";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function loadDotEnv(): void {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || !line.includes("=")) continue;
    const key = line.slice(0, line.indexOf("=")).trim();
    const value = line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const repo = arg("repo");
  const pr = Number(arg("pr"));
  const out = resolve(process.cwd(), arg("out") ?? "docs/example-review.png");
  if (!repo || !repo.includes("/") || !Number.isInteger(pr)) {
    console.error("usage: pnpm screenshot --repo owner/name --pr <number> [--out docs/example-review.png]");
    process.exit(2);
  }
  const token = process.env["GITHUB_TOKEN"];
  if (!token) {
    console.error("GITHUB_TOKEN is required");
    process.exit(2);
  }
  const [owner, name] = repo.split("/") as [string, string];
  const octokit = github.getOctokit(token);
  const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, { owner, repo: name, pull_number: pr, per_page: 100 });
  const target =
    comments.find((c) => c.body.includes("<!-- ai-code-review:finding:") && c.body.includes("```suggestion")) ??
    comments.find((c) => c.body.includes("<!-- ai-code-review:finding:"));
  if (!target) {
    console.error(`No inline comment from ai-code-review found on ${repo}#${pr}. Has the review run?`);
    process.exit(1);
  }
  console.log(`Capturing ${target.html_url}`);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1400 }, deviceScaleFactor: 2, colorScheme: "light" });
    await page.goto(target.html_url, { waitUntil: "domcontentloaded" });
    const anchor = page.locator(`#discussion_r${target.id}`).first();
    await anchor.waitFor({ state: "visible", timeout: 30_000 });
    // Prefer the whole thread (diff lines + comment); fall back to the comment itself.
    const thread = anchor.locator("xpath=ancestor::*[contains(@class,'review-thread') or contains(@class,'js-resolvable-timeline-thread-container')][1]");
    const element = (await thread.count()) > 0 ? thread.first() : anchor;
    await element.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    mkdirSync(dirname(out), { recursive: true });
    await element.screenshot({ path: out });
    console.log(`Wrote ${out}`);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
