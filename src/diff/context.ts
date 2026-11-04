import { hunkNewRange } from "./parse.js";
import type { Hunk, ParsedFile } from "./types.js";

export interface ContextWindow {
  /** 1-based inclusive new-file line range. */
  start: number;
  end: number;
  lines: string[];
}

export interface HunkWithContext {
  hunk: Hunk;
  before: ContextWindow | null;
  after: ContextWindow | null;
}

/** Default number of surrounding lines shown on each side of a hunk. */
export const CONTEXT_RADIUS = 30;

/**
 * Attach up to `radius` lines of the head-revision file before and after every
 * hunk. Windows of neighbouring hunks never overlap: the gap between two hunks
 * is split down the middle so each line is shown exactly once.
 */
export function attachContext(
  file: ParsedFile,
  content: string | null,
  radius = CONTEXT_RADIUS,
): HunkWithContext[] {
  if (content === null || file.hunks.length === 0 || radius <= 0) {
    return file.hunks.map((hunk) => ({ hunk, before: null, after: null }));
  }
  const fileLines = splitLines(content);
  const total = fileLines.length;
  const ranges = file.hunks.map(hunkNewRange);

  const result: HunkWithContext[] = [];
  for (let i = 0; i < file.hunks.length; i += 1) {
    const hunk = file.hunks[i]!;
    const range = ranges[i]!;
    let beforeStart = Math.max(1, range.start - radius);
    let beforeEnd = range.start - 1;
    let afterStart = hunk.newLines === 0 ? range.start : range.end + 1;
    let afterEnd = Math.min(total, afterStart + radius - 1);

    const prev = ranges[i - 1];
    if (prev) {
      const gapStart = prev.end + 1;
      const mid = Math.floor((gapStart + range.start - 1) / 2);
      beforeStart = Math.max(beforeStart, mid + 1);
    }
    const next = ranges[i + 1];
    if (next) {
      const gapEnd = next.start - 1;
      const mid = Math.floor((afterStart + gapEnd) / 2);
      afterEnd = Math.min(afterEnd, mid);
    }
    if (hunk.newLines === 0) {
      // Pure deletion: the hunk occupies no new-file lines, so "after" starts at newStart.
      beforeEnd = range.start - 1;
      afterStart = range.start;
    }

    result.push({
      hunk,
      before: window(fileLines, beforeStart, beforeEnd),
      after: window(fileLines, afterStart, afterEnd),
    });
  }
  return result;
}

function window(fileLines: string[], start: number, end: number): ContextWindow | null {
  if (end < start || start < 1) return null;
  const lines = fileLines.slice(start - 1, end);
  if (lines.length === 0) return null;
  return { start, end: start + lines.length - 1, lines };
}

export function splitLines(content: string): string[] {
  if (content === "") return [];
  const lines = content.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}
