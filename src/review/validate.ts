import { findAddedLine } from "../diff/parse.js";
import type { ParsedFile } from "../diff/types.js";
import {
  SEVERITY_RANK,
  isCategory,
  isSeverity,
  type Category,
  type Finding,
  type Severity,
} from "./schema.js";

/** A finding that could not be placed inline and is reported in the review body instead. */
export interface FileNote {
  file: string;
  line: number | null;
  severity: Severity;
  category: Category;
  title: string;
  explanation: string;
  /** Why it was not placed inline. */
  reason: string;
}

export interface ValidationResult {
  inline: Finding[];
  notes: FileNote[];
  /** Style findings dropped because `style_comments` is off. */
  suppressedStyle: number;
}

export interface ValidationOptions {
  styleComments: boolean;
  maxFindings: number;
}

/** Strip a copied prompt prefix such as `+     21 | ` from each suggestion line. */
const RENDERED_PREFIX = /^[+ -]?\s*\d*\s*\| ?/;

/**
 * Check every model finding against the diff before it can become an inline
 * comment. GitHub rejects a whole review when any comment points outside the
 * diff, and a reviewer that silently drops findings is worse than one that
 * says "I could not place this", so failures become file-level notes.
 */
export function validateFindings(
  findings: unknown[],
  files: Map<string, ParsedFile>,
  options: ValidationOptions,
): ValidationResult {
  const inline: Finding[] = [];
  const notes: FileNote[] = [];
  let suppressedStyle = 0;

  for (const raw of findings) {
    const finding = coerce(raw);
    if (!finding) continue;

    if (finding.category === "style" && !options.styleComments) {
      suppressedStyle += 1;
      continue;
    }

    const file = files.get(finding.file);
    if (!file) {
      notes.push(note(finding, `\`${finding.file}\` is not part of the reviewed diff`));
      continue;
    }
    if (!Number.isInteger(finding.line) || !file.addedLines.has(finding.line)) {
      notes.push(note(finding, `line ${finding.line} is not an added or changed line`));
      continue;
    }

    const cleaned = cleanSuggestion(finding, file);
    inline.push(cleaned);
  }

  inline.sort(compareFindings);
  if (inline.length > options.maxFindings) {
    const overflow = inline.splice(options.maxFindings);
    for (const finding of overflow) {
      notes.push(note(finding, `over the max_findings limit of ${options.maxFindings}`));
    }
  }
  return { inline, notes, suppressedStyle };
}

function coerce(raw: unknown): Finding | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value["file"] !== "string" || typeof value["title"] !== "string") return null;
  if (!isSeverity(value["severity"]) || !isCategory(value["category"])) return null;
  const finding: Finding = {
    file: value["file"].trim(),
    line: typeof value["line"] === "number" ? value["line"] : Number.NaN,
    severity: value["severity"],
    category: value["category"],
    title: value["title"].trim(),
    explanation: typeof value["explanation"] === "string" ? value["explanation"].trim() : "",
  };
  if (typeof value["suggestion"] === "string" && value["suggestion"].trim() !== "") {
    finding.suggestion = value["suggestion"];
  }
  return finding;
}

function note(finding: Finding, reason: string): FileNote {
  return {
    file: finding.file,
    line: Number.isInteger(finding.line) ? finding.line : null,
    severity: finding.severity,
    category: finding.category,
    title: finding.title,
    explanation: finding.explanation,
    reason,
  };
}

function cleanSuggestion(finding: Finding, file: ParsedFile): Finding {
  if (finding.suggestion === undefined) return finding;
  const lines = finding.suggestion
    .replace(/\r\n/g, "\n")
    .replace(/\n+$/, "")
    .split("\n")
    .map((line) => line.replace(RENDERED_PREFIX, (match) => (/\d/.test(match) ? "" : match)));
  const suggestion = lines.join("\n");
  const original = findAddedLine(file, finding.line)?.content;
  if (suggestion === "" || suggestion === original) {
    const { suggestion: _dropped, ...rest } = finding;
    return rest;
  }
  return { ...finding, suggestion };
}

export function compareFindings(a: Finding, b: Finding): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.line - b.line;
}
