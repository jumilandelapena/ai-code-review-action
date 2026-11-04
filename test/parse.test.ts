import { describe, expect, it } from "vitest";
import { findAddedLine, hunkNewRange, parseChangedFile, parsePatch } from "../src/diff/parse.js";
import type { ChangedFile } from "../src/diff/types.js";

const MULTI_HUNK = [
  "@@ -1,4 +1,5 @@",
  " import a from \"a\";",
  "-import b from \"b\";",
  "+import b from \"./b\";",
  "+import c from \"c\";",
  " ",
  " export const x = 1;",
  "@@ -20,3 +21,4 @@ export function foo() {",
  "   const y = 2;",
  "-  return y;",
  "+  const z = 3;",
  "+  return y + z;",
  " }",
].join("\n");

describe("parsePatch", () => {
  it("parses several hunks and numbers added lines by the new file", () => {
    const hunks = parsePatch(MULTI_HUNK);
    expect(hunks).toHaveLength(2);

    const [first, second] = hunks;
    expect(first?.header).toBe("@@ -1,4 +1,5 @@");
    expect(first?.newStart).toBe(1);
    expect(first?.newLines).toBe(5);
    expect(first?.lines.map((l) => [l.kind, l.newLine, l.oldLine])).toEqual([
      ["context", 1, 1],
      ["del", null, 2],
      ["add", 2, null],
      ["add", 3, null],
      ["context", 4, 3],
      ["context", 5, 4],
    ]);

    expect(second?.header).toBe("@@ -20,3 +21,4 @@ export function foo() {");
    expect(second?.lines.map((l) => [l.kind, l.newLine])).toEqual([
      ["context", 21],
      ["del", null],
      ["add", 22],
      ["add", 23],
      ["context", 24],
    ]);
    expect(second?.lines[2]?.content).toBe("  const z = 3;");
  });

  it("returns no hunks for an empty or missing patch", () => {
    expect(parsePatch(undefined)).toEqual([]);
    expect(parsePatch("")).toEqual([]);
  });

  it("handles a hunk header without line counts (single-line files)", () => {
    const hunks = parsePatch("@@ -1 +1 @@\n-old\n+new");
    expect(hunks[0]?.oldLines).toBe(1);
    expect(hunks[0]?.newLines).toBe(1);
    expect(hunks[0]?.lines[1]).toMatchObject({ kind: "add", newLine: 1, content: "new" });
  });

  it("attaches the no-newline marker to the preceding line without consuming a line number", () => {
    const patch = ["@@ -1,2 +1,2 @@", " a", "-b", "\\ No newline at end of file", "+b", "\\ No newline at end of file"].join("\n");
    const [hunk] = parsePatch(patch);
    expect(hunk?.lines).toHaveLength(3);
    expect(hunk?.lines[1]).toMatchObject({ kind: "del", oldLine: 2, noNewlineAtEnd: true });
    expect(hunk?.lines[2]).toMatchObject({ kind: "add", newLine: 2, noNewlineAtEnd: true });
  });

  it("tolerates a trailing newline in the patch", () => {
    const hunks = parsePatch("@@ -1,1 +1,2 @@\n a\n+b\n");
    expect(hunks[0]?.lines).toHaveLength(2);
  });

  it("treats a bare empty line (stripped trailing space) as context", () => {
    const hunks = parsePatch("@@ -1,2 +1,3 @@\n a\n\n+c");
    expect(hunks[0]?.lines.map((l) => [l.kind, l.newLine])).toEqual([
      ["context", 1],
      ["context", 2],
      ["add", 3],
    ]);
  });
});

describe("parseChangedFile", () => {
  it("collects added line numbers and keeps the previous name of a renamed file", () => {
    const file: ChangedFile = {
      filename: "src/new-name.ts",
      previousFilename: "src/old-name.ts",
      status: "renamed",
      additions: 1,
      deletions: 1,
      patch: "@@ -3,3 +3,3 @@\n a\n-b\n+B\n c",
    };
    const parsed = parseChangedFile(file);
    expect(parsed.previousFilename).toBe("src/old-name.ts");
    expect([...parsed.addedLines]).toEqual([4]);
    expect(findAddedLine(parsed, 4)?.content).toBe("B");
    expect(findAddedLine(parsed, 3)).toBeUndefined();
  });

  it("gives a deleted file no commentable lines", () => {
    const file: ChangedFile = {
      filename: "src/gone.ts",
      status: "removed",
      additions: 0,
      deletions: 2,
      patch: "@@ -1,2 +0,0 @@\n-a\n-b",
    };
    const parsed = parseChangedFile(file);
    expect(parsed.addedLines.size).toBe(0);
    expect(parsed.hunks[0]?.newLines).toBe(0);
    expect(hunkNewRange(parsed.hunks[0]!)).toEqual({ start: 0, end: 0 });
  });

  it("gives a pure rename (no patch) no hunks", () => {
    const parsed = parseChangedFile({
      filename: "b.ts",
      previousFilename: "a.ts",
      status: "renamed",
      additions: 0,
      deletions: 0,
    });
    expect(parsed.hunks).toEqual([]);
    expect(parsed.addedLines.size).toBe(0);
  });

  it("marks every line of a new file as added, numbered from 1", () => {
    const parsed = parseChangedFile({
      filename: "new.ts",
      status: "added",
      additions: 3,
      deletions: 0,
      patch: "@@ -0,0 +1,3 @@\n+a\n+b\n+c",
    });
    expect([...parsed.addedLines]).toEqual([1, 2, 3]);
  });
});
