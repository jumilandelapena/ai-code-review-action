import { describe, expect, it } from "vitest";
import { parseChangedFile } from "../src/diff/parse.js";
import type { ParsedFile } from "../src/diff/types.js";
import type { Finding } from "../src/review/schema.js";
import { validateFindings } from "../src/review/validate.js";

const files = new Map<string, ParsedFile>();
const parsed = parseChangedFile({
  filename: "src/a.ts",
  status: "modified",
  additions: 2,
  deletions: 1,
  patch: "@@ -10,4 +10,5 @@\n context 10\n-old 11\n+new 11\n+new 12\n context 13\n context 14",
});
files.set(parsed.filename, parsed);

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    file: "src/a.ts",
    line: 11,
    severity: "high",
    category: "bug",
    title: "Something is wrong",
    explanation: "Because.",
    ...overrides,
  };
}

const options = { styleComments: false, maxFindings: 15 };

describe("validateFindings", () => {
  it("accepts a finding on an added line", () => {
    const result = validateFindings([finding()], files, options);
    expect(result.inline).toHaveLength(1);
    expect(result.notes).toHaveLength(0);
  });

  it("moves a finding on a context line to the summary notes", () => {
    const result = validateFindings([finding({ line: 13 })], files, options);
    expect(result.inline).toHaveLength(0);
    expect(result.notes[0]).toMatchObject({ file: "src/a.ts", line: 13, reason: "line 13 is not an added or changed line" });
  });

  it("moves a finding on an unchanged line outside every hunk to the notes", () => {
    const result = validateFindings([finding({ line: 3 })], files, options);
    expect(result.inline).toHaveLength(0);
    expect(result.notes[0]?.reason).toContain("line 3");
  });

  it("moves a finding on an unknown file to the notes", () => {
    const result = validateFindings([finding({ file: "src/missing.ts" })], files, options);
    expect(result.notes[0]?.reason).toContain("not part of the reviewed diff");
  });

  it("drops findings with an invalid severity or category instead of posting them", () => {
    const bad = { ...finding(), severity: "blocker" } as unknown;
    const result = validateFindings([bad, { nonsense: true }, null], files, options);
    expect(result.inline).toHaveLength(0);
    expect(result.notes).toHaveLength(0);
  });

  it("suppresses style findings unless style_comments is on", () => {
    const style = finding({ category: "style", severity: "nit" });
    expect(validateFindings([style], files, options).suppressedStyle).toBe(1);
    expect(validateFindings([style], files, { ...options, styleComments: true }).inline).toHaveLength(1);
  });

  it("sorts by severity and moves the overflow beyond max_findings to the notes", () => {
    const input = [
      finding({ severity: "nit", title: "n", line: 12 }),
      finding({ severity: "critical", title: "c" }),
      finding({ severity: "medium", title: "m", line: 12 }),
    ];
    const result = validateFindings(input, files, { ...options, maxFindings: 2 });
    expect(result.inline.map((f) => f.severity)).toEqual(["critical", "medium"]);
    expect(result.notes[0]).toMatchObject({ severity: "nit", reason: "over the max_findings limit of 2" });
  });

  it("cleans a suggestion that copied the prompt's line prefix and drops no-op suggestions", () => {
    const copied = validateFindings([finding({ suggestion: "+     11 | fixed 11\n" })], files, options);
    expect(copied.inline[0]?.suggestion).toBe("fixed 11");

    const same = validateFindings([finding({ suggestion: "new 11" })], files, options);
    expect(same.inline[0]?.suggestion).toBeUndefined();

    const blank = validateFindings([finding({ suggestion: "   " })], files, options);
    expect(blank.inline[0]?.suggestion).toBeUndefined();
  });

  it("keeps a suggestion whose code legitimately contains a pipe", () => {
    const result = validateFindings([finding({ suggestion: "const x = a | b;" })], files, options);
    expect(result.inline[0]?.suggestion).toBe("const x = a | b;");
  });
});
