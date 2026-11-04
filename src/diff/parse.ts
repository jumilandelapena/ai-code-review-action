import type { ChangedFile, DiffLine, Hunk, ParsedFile } from "./types.js";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
const NO_NEWLINE = "\\ No newline at end of file";

/**
 * Parse the `patch` string GitHub returns for one file into hunks.
 *
 * GitHub's patch has no `---`/`+++` file header, only `@@` hunks. Every added
 * and context line is tagged with its exact line number in the new file so the
 * reviewer can only anchor comments on lines that exist on the RIGHT side.
 */
export function parsePatch(patch: string | undefined): Hunk[] {
  if (!patch) return [];
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  // A trailing newline in the patch would otherwise produce a phantom empty line.
  const rawLines = patch.endsWith("\n") ? patch.slice(0, -1).split("\n") : patch.split("\n");

  for (const raw of rawLines) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      current = {
        header: raw,
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      };
      hunks.push(current);
      oldLine = current.oldStart;
      newLine = current.newStart;
      continue;
    }
    if (!current) {
      // Text before the first hunk header is not part of any hunk; ignore it.
      continue;
    }
    if (raw.startsWith(NO_NEWLINE)) {
      const last = current.lines[current.lines.length - 1];
      if (last) last.noNewlineAtEnd = true;
      continue;
    }
    const marker = raw[0];
    const content = raw.slice(1);
    let line: DiffLine;
    if (marker === "+") {
      line = { kind: "add", content, newLine, oldLine: null, noNewlineAtEnd: false };
      newLine += 1;
    } else if (marker === "-") {
      line = { kind: "del", content, newLine: null, oldLine, noNewlineAtEnd: false };
      oldLine += 1;
    } else {
      // A space marker, or an empty line in a patch whose trailing whitespace was stripped.
      line = { kind: "context", content, newLine, oldLine, noNewlineAtEnd: false };
      newLine += 1;
      oldLine += 1;
    }
    current.lines.push(line);
  }
  return hunks;
}

/** Parse one changed file and collect the set of commentable new-file lines. */
export function parseChangedFile(file: ChangedFile): ParsedFile {
  const hunks = parsePatch(file.patch);
  const addedLines = new Set<number>();
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "add" && line.newLine !== null) addedLines.add(line.newLine);
    }
  }
  const parsed: ParsedFile = { filename: file.filename, status: file.status, hunks, addedLines };
  if (file.previousFilename !== undefined) parsed.previousFilename = file.previousFilename;
  return parsed;
}

/** Return the added line with this new-file number, if any. */
export function findAddedLine(file: ParsedFile, newLine: number): DiffLine | undefined {
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "add" && line.newLine === newLine) return line;
    }
  }
  return undefined;
}

/** Inclusive new-file range covered by a hunk (`newLines` may be 0 for pure deletions). */
export function hunkNewRange(hunk: Hunk): { start: number; end: number } {
  if (hunk.newLines === 0) return { start: hunk.newStart, end: hunk.newStart };
  return { start: hunk.newStart, end: hunk.newStart + hunk.newLines - 1 };
}
