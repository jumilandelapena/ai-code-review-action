/**
 * Shapes shared by the diff pipeline. `ChangedFile` mirrors the subset of the
 * GitHub `pulls.listFiles` response the reviewer needs; everything else is
 * derived locally.
 */

export type FileStatus =
  | "added"
  | "removed"
  | "modified"
  | "renamed"
  | "copied"
  | "changed"
  | "unchanged";

export interface ChangedFile {
  filename: string;
  status: FileStatus;
  /** Unified diff hunks. Missing for binaries and for diffs GitHub refuses to render. */
  patch?: string;
  previousFilename?: string;
  additions: number;
  deletions: number;
}

export type LineKind = "add" | "del" | "context";

export interface DiffLine {
  kind: LineKind;
  /** Line text without the leading `+`, `-` or space. */
  content: string;
  /** Line number in the new file (head). `null` for deleted lines. */
  newLine: number | null;
  /** Line number in the old file (base). `null` for added lines. */
  oldLine: number | null;
  /** True when the diff carried a `\ No newline at end of file` marker for this line. */
  noNewlineAtEnd: boolean;
}

export interface Hunk {
  /** Raw `@@ ... @@` header, kept for the prompt. */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface ParsedFile {
  filename: string;
  status: FileStatus;
  previousFilename?: string;
  hunks: Hunk[];
  /** New-file line numbers that were added or changed. Only these may get inline comments. */
  addedLines: Set<number>;
}

export interface SkippedFile {
  filename: string;
  reason: string;
}
