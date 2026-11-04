import { describe, expect, it } from "vitest";
import { attachContext, splitLines } from "../src/diff/context.js";
import { parseChangedFile } from "../src/diff/parse.js";
import { renderFile } from "../src/review/prompt.js";

const content = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";

describe("attachContext", () => {
  it("adds up to radius lines on each side, clipped to the file", () => {
    const parsed = parseChangedFile({
      filename: "f.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      patch: "@@ -2,3 +2,4 @@\n line 2\n line 3\n+inserted\n line 4",
    });
    const [hunk] = attachContext(parsed, content, 30);
    expect(hunk?.before).toEqual({ start: 1, end: 1, lines: ["line 1"] });
    expect(hunk?.after?.start).toBe(6);
    expect(hunk?.after?.end).toBe(35);
    expect(hunk?.after?.lines).toHaveLength(30);
  });

  it("never shows the same line twice when hunks are close together", () => {
    const parsed = parseChangedFile({
      filename: "f.ts",
      status: "modified",
      additions: 2,
      deletions: 0,
      patch: "@@ -10,1 +10,2 @@\n line 10\n+a\n@@ -20,1 +21,2 @@\n line 20\n+b",
    });
    const [first, second] = attachContext(parsed, content, 30);
    expect(first?.after?.start).toBe(12);
    expect(second!.before!.start).toBe(first!.after!.end + 1);
    // The gap between new-file lines 12 and 20 is split: 12-16 after the first, 17-20 before the second.
    expect(first?.after).toMatchObject({ start: 12, end: 16 });
    expect(second?.before).toMatchObject({ start: 17, end: 20 });
  });

  it("returns no windows without file content or with radius 0", () => {
    const parsed = parseChangedFile({ filename: "f.ts", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n-a\n+b" });
    expect(attachContext(parsed, null)[0]).toMatchObject({ before: null, after: null });
    expect(attachContext(parsed, content, 0)[0]).toMatchObject({ before: null, after: null });
  });

  it("splitLines drops the trailing empty element and handles CRLF", () => {
    expect(splitLines("a\r\nb\r\n")).toEqual(["a", "b"]);
    expect(splitLines("")).toEqual([]);
  });
});

describe("renderFile", () => {
  it("prints line numbers only on new-file lines and labels context clearly", () => {
    const parsed = parseChangedFile({
      filename: "src/x.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      patch: "@@ -2,3 +2,3 @@\n line 2\n-line 3\n+changed 3\n line 4",
    });
    const rendered = renderFile(parsed, attachContext(parsed, content, 2));
    expect(rendered.text).toContain("=== FILE: src/x.ts (modified) ===");
    expect(rendered.text).toContain("--- CONTEXT (unchanged, lines 1-1; not part of the diff) ---");
    expect(rendered.text).toContain("--- DIFF @@ -2,3 +2,3 @@ ---");
    expect(rendered.text).toContain("+      3 | changed 3");
    expect(rendered.text).toContain("-        | line 3");
    expect(rendered.text).toContain("       2 | line 2");
    expect(rendered.text).toContain("--- CONTEXT (unchanged, lines 5-6; not part of the diff) ---");
    expect(rendered.textWithoutContext).not.toContain("CONTEXT");
    expect(rendered.firstAddedLine).toBe(3);
    expect(rendered.firstAddedContent).toBe("changed 3");
  });
});
