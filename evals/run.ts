/**
 * Eval harness: run the reviewer over `evals/cases/*` and score it.
 *
 *   pnpm eval                       # real model, writes docs/eval-results.md
 *   LLM_PROVIDER=mock pnpm eval     # no API key, same harness (CI smoke test)
 *   pnpm eval --only sql-injection --out /tmp/x.md --model claude-opus-5-5 --effort medium
 *
 * Each case is a folder with `case.json`, an `after.<ext>` file and optionally a
 * `before.<ext>` file. The diff is generated from before/after, so the planted
 * bug's line number is derived from `bug.line_contains` instead of hand-counted.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { structuredPatch } from "diff";
import { DEFAULT_CONFIG, type ReviewConfig } from "../src/config.js";
import { estimateCost, formatUsd } from "../src/cost.js";
import { attachContext } from "../src/diff/context.js";
import { parseChangedFile } from "../src/diff/parse.js";
import type { ChangedFile, ParsedFile } from "../src/diff/types.js";
import type { PullRequestInfo } from "../src/github/api.js";
import { AnthropicReviewProvider } from "../src/review/anthropic.js";
import { MockReviewProvider } from "../src/review/mock.js";
import { buildSystemPrompt, renderFile, renderPullRequestHeader, renderUserMessage } from "../src/review/prompt.js";
import { addUsage, EMPTY_USAGE, type Effort, type ReviewProvider, type TokenUsage } from "../src/review/provider.js";
import { CATEGORIES, type Category, type Finding } from "../src/review/schema.js";
import { validateFindings, type FileNote } from "../src/review/validate.js";

const here = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(here, "cases");
const NEAR_TOLERANCE = 2;

interface CaseMeta {
  description: string;
  filename: string;
  bug: { line_contains: string; categories: Category[]; note?: string } | null;
}

interface EvalCase {
  name: string;
  meta: CaseMeta;
  file: ChangedFile;
  after: string;
  bugLine: number | null;
}

interface CaseResult {
  name: string;
  description: string;
  planted: string;
  bugLine: number | null;
  status: "ok" | "incomplete";
  detail: string;
  findings: Array<Finding | FileNote>;
  hitExact: boolean;
  hitNear: boolean;
  categoryMatch: boolean;
  reportedLines: number[];
  usage: TokenUsage;
  costUsd: number | null;
}

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

/** Build a GitHub-style `patch` (hunks only, no file header) from before/after text. */
export function makePatch(before: string | null, after: string): string {
  const afterLines = after.split("\n");
  if (afterLines[afterLines.length - 1] === "") afterLines.pop();
  if (before === null) {
    return [`@@ -0,0 +1,${afterLines.length} @@`, ...afterLines.map((line) => `+${line}`)].join("\n");
  }
  const patch = structuredPatch("a", "b", before, after, "", "", { context: 3 });
  return patch.hunks
    .map((hunk) => [`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, ...hunk.lines].join("\n"))
    .join("\n");
}

function loadCases(only: string | undefined): EvalCase[] {
  const names = readdirSync(CASES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const cases: EvalCase[] = [];
  for (const name of names) {
    if (only && name !== only) continue;
    const dir = join(CASES_DIR, name);
    const meta = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as CaseMeta;
    const files = readdirSync(dir);
    const afterName = files.find((f) => f.startsWith("after."));
    if (!afterName) throw new Error(`case ${name} has no after.* file`);
    const beforeName = files.find((f) => f.startsWith("before."));
    const after = readFileSync(join(dir, afterName), "utf8").replace(/\r\n/g, "\n");
    const before = beforeName ? readFileSync(join(dir, beforeName), "utf8").replace(/\r\n/g, "\n") : null;
    const patch = makePatch(before, after);
    const file: ChangedFile = {
      filename: meta.filename,
      status: before === null ? "added" : "modified",
      additions: (patch.match(/^\+/gm) ?? []).length,
      deletions: (patch.match(/^-/gm) ?? []).length,
      patch,
    };

    let bugLine: number | null = null;
    if (meta.bug) {
      if (!meta.bug.categories.every((c) => (CATEGORIES as readonly string[]).includes(c))) {
        throw new Error(`case ${name}: unknown category in ${meta.bug.categories.join(",")}`);
      }
      const index = after.split("\n").findIndex((line) => line.includes(meta.bug!.line_contains));
      if (index === -1) throw new Error(`case ${name}: line_contains "${meta.bug.line_contains}" not found in ${afterName}`);
      bugLine = index + 1;
      const parsed = parseChangedFile(file);
      if (!parsed.addedLines.has(bugLine)) {
        throw new Error(`case ${name}: planted bug line ${bugLine} is not an added line of the diff`);
      }
    }
    cases.push({ name, meta, file, after, bugLine });
  }
  if (cases.length === 0) throw new Error(only ? `no case named ${only}` : "no cases found");
  return cases;
}

async function runCase(evalCase: EvalCase, provider: ReviewProvider, model: string, config: ReviewConfig): Promise<CaseResult> {
  const parsed = parseChangedFile(evalCase.file);
  const files = new Map<string, ParsedFile>([[parsed.filename, parsed]]);
  const rendered = renderFile(parsed, attachContext(parsed, evalCase.after, config.contextLines));
  const pr: PullRequestInfo = {
    number: 0,
    title: evalCase.meta.description,
    body: null,
    headSha: "eval",
    baseSha: "eval",
    headRef: `eval/${evalCase.name}`,
    baseRef: "main",
    headRepoFullName: "evals/cases",
    baseRepoFullName: "evals/cases",
    isFromFork: false,
    authorLogin: "eval-harness",
    htmlUrl: "",
  };
  const system = buildSystemPrompt(config);
  const user = renderUserMessage(renderPullRequestHeader(pr, "evals/cases", 1, 1), [
    {
      filename: parsed.filename,
      text: rendered.text,
      tokens: 0,
      textWithoutContext: rendered.textWithoutContext,
      tokensWithoutContext: 0,
      firstAddedLine: rendered.firstAddedLine,
      firstAddedContent: rendered.firstAddedContent,
    },
  ]);

  const result = await provider.review({
    model,
    system,
    user,
    maxTokens: 16_000,
    effort: config.effort,
    files: [{ filename: parsed.filename, firstAddedLine: rendered.firstAddedLine, firstAddedContent: rendered.firstAddedContent }],
  });

  const base = {
    name: evalCase.name,
    description: evalCase.meta.description,
    planted: evalCase.meta.bug ? evalCase.meta.bug.categories.join("/") : "none (clean diff)",
    bugLine: evalCase.bugLine,
    usage: result.usage,
    costUsd: provider.name === "anthropic" ? estimateCost(model, result.usage) : 0,
  };
  if (result.status === "incomplete") {
    return { ...base, status: "incomplete", detail: result.detail, findings: [], hitExact: false, hitNear: false, categoryMatch: false, reportedLines: [] };
  }
  const validated = validateFindings(result.output.findings, files, { styleComments: config.styleComments, maxFindings: config.maxFindings });
  const findings: Array<Finding | FileNote> = [...validated.inline, ...validated.notes];
  const reportedLines = findings.map((f) => f.line).filter((l): l is number => l !== null);
  const bugLine = evalCase.bugLine;
  const exact = bugLine === null ? undefined : findings.find((f) => f.file === evalCase.meta.filename && f.line === bugLine);
  const near =
    bugLine === null
      ? false
      : findings.some((f) => f.file === evalCase.meta.filename && f.line !== null && Math.abs(f.line - bugLine) <= NEAR_TOLERANCE);
  return {
    ...base,
    status: "ok",
    detail: result.output.verdict,
    findings,
    hitExact: exact !== undefined,
    hitNear: near,
    categoryMatch: exact !== undefined && (evalCase.meta.bug?.categories.includes(exact.category) ?? false),
    reportedLines,
  };
}

function percent(numerator: number, denominator: number): string {
  if (denominator === 0) return "n/a";
  return `${numerator}/${denominator} (${((100 * numerator) / denominator).toFixed(1)}%)`;
}

function renderReport(results: CaseResult[], provider: ReviewProvider, model: string, config: ReviewConfig, startedAt: Date): string {
  const bugCases = results.filter((r) => r.bugLine !== null);
  const cleanCases = results.filter((r) => r.bugLine === null);
  const exact = bugCases.filter((r) => r.hitExact).length;
  const near = bugCases.filter((r) => r.hitNear).length;
  const categoryMatches = bugCases.filter((r) => r.categoryMatch).length;
  const falsePositives = cleanCases.reduce((sum, r) => sum + r.findings.length, 0);
  const totalFindings = results.reduce((sum, r) => sum + r.findings.length, 0);
  const usage = results.reduce((sum, r) => addUsage(sum, r.usage), EMPTY_USAGE);
  const costs = results.map((r) => r.costUsd);
  const totalCost = costs.every((c) => c !== null) ? costs.reduce<number>((sum, c) => sum + (c ?? 0), 0) : null;
  const incomplete = results.filter((r) => r.status === "incomplete").length;
  const inputTotal = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const cacheShare = inputTotal === 0 ? "n/a" : `${((100 * usage.cacheReadTokens) / inputTotal).toFixed(1)}%`;

  const lines: string[] = [];
  lines.push("# Eval results", "");
  lines.push(
    `Provider: \`${provider.name}\` · Model: \`${model}\` · Effort: \`${config.effort}\` · Cases: ${results.length} (${bugCases.length} with a planted bug, ${cleanCases.length} clean) · Run: ${startedAt.toISOString().slice(0, 10)}`,
    "",
  );
  if (provider.name === "mock") {
    lines.push(
      "> **Mock provider.** No model was called: every number below comes from the fixed mock finding (first added line of the file). These results only prove the harness runs. Set `ANTHROPIC_API_KEY` and run `pnpm eval` for real numbers.",
      "",
    );
  }
  lines.push("## Summary", "", "| Metric | Value |", "| --- | --- |");
  lines.push(`| Recall, planted bug reported on the exact line | ${percent(exact, bugCases.length)} |`);
  lines.push(`| Recall, within ±${NEAR_TOLERANCE} lines | ${percent(near, bugCases.length)} |`);
  lines.push(`| Exact hits with a matching category | ${percent(categoryMatches, bugCases.length)} |`);
  lines.push(`| False positives on the clean diff | ${falsePositives} |`);
  lines.push(`| Average findings per diff | ${(totalFindings / Math.max(1, results.length)).toFixed(2)} |`);
  lines.push(`| Average cost per review | ${formatUsd(totalCost === null ? null : totalCost / Math.max(1, results.length))} |`);
  lines.push(`| Total cost | ${formatUsd(totalCost)} |`);
  lines.push(`| Tokens | ${usage.inputTokens.toLocaleString("en-US")} in / ${usage.outputTokens.toLocaleString("en-US")} out / ${usage.cacheReadTokens.toLocaleString("en-US")} cache read / ${usage.cacheWriteTokens.toLocaleString("en-US")} cache write |`);
  lines.push(`| Share of input served from the prompt cache | ${cacheShare} |`);
  lines.push(`| Incomplete reviews (refusal, max_tokens, parse error) | ${incomplete} |`);
  lines.push("", "## Per case", "", "| Case | Planted bug | Found | Expected line | Reported lines | Findings | Cost |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of results) {
    const found = r.bugLine === null ? (r.findings.length === 0 ? "✅ no findings" : `❌ ${r.findings.length} false positive(s)`) : r.hitExact ? "✅ exact" : r.hitNear ? "🟡 near" : r.status === "incomplete" ? "⚠️ incomplete" : "❌ missed";
    lines.push(
      `| \`${r.name}\` | ${r.planted} | ${found} | ${r.bugLine ?? "–"} | ${r.reportedLines.length === 0 ? "–" : r.reportedLines.join(", ")} | ${r.findings.length} | ${formatUsd(r.costUsd)} |`,
    );
  }
  lines.push("", "## Findings per case", "");
  for (const r of results) {
    lines.push(`### ${r.name}`, "", `_${r.description}_ — verdict/status: \`${r.detail}\``, "");
    if (r.findings.length === 0) lines.push("- (no findings)");
    for (const f of r.findings) {
      const where = f.line === null ? f.file : `${f.file}:${f.line}`;
      const marker = r.bugLine !== null && f.line === r.bugLine ? " ⬅ planted bug" : "";
      lines.push(`- **${f.severity}** · ${f.category} · \`${where}\`: ${f.title}${marker}`);
    }
    lines.push("");
  }
  lines.push("## How to reproduce", "", "```bash", "pnpm eval                      # real model (needs ANTHROPIC_API_KEY)", "LLM_PROVIDER=mock pnpm eval    # harness smoke test, no key", "```", "");
  lines.push("Scoring: a planted bug counts as found when any validated finding (inline or file-level note) points at the exact line that `case.json` names via `line_contains`. Cases run one after another so every request after the first reads the system prompt from the prompt cache.", "");
  return lines.join("\n");
}

async function main(): Promise<void> {
  loadDotEnv();
  const providerName = (process.env["LLM_PROVIDER"] ?? "anthropic").toLowerCase();
  const apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";
  if (providerName !== "mock" && apiKey === "") {
    console.error("ANTHROPIC_API_KEY is required unless LLM_PROVIDER=mock");
    process.exit(2);
  }
  const provider: ReviewProvider = providerName === "mock" ? new MockReviewProvider() : new AnthropicReviewProvider(apiKey);
  const model = arg("model") ?? "claude-opus-5-5";
  const effort = (arg("effort") ?? DEFAULT_CONFIG.effort) as Effort;
  const config: ReviewConfig = { ...DEFAULT_CONFIG, effort, maxFindings: 15 };
  const out = resolve(process.cwd(), arg("out") ?? "docs/eval-results.md");

  const cases = loadCases(arg("only"));
  const startedAt = new Date();
  console.log(`Running ${cases.length} case(s) with provider=${provider.name} model=${model} effort=${effort}`);
  const results: CaseResult[] = [];
  for (const evalCase of cases) {
    const t0 = Date.now();
    const result = await runCase(evalCase, provider, model, config);
    results.push(result);
    const verdict = result.bugLine === null ? `${result.findings.length} finding(s) on clean diff` : result.hitExact ? "exact hit" : result.hitNear ? "near hit" : result.status === "incomplete" ? `incomplete: ${result.detail}` : "missed";
    console.log(`- ${evalCase.name.padEnd(22)} ${verdict.padEnd(32)} ${formatUsd(result.costUsd).padStart(10)}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  const report = renderReport(results, provider, model, config, startedAt);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, report);
  console.log(`\nWrote ${out}`);
  const summary = report.split("## Per case")[0] ?? "";
  console.log(summary.split("## Summary")[1] ?? "");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
