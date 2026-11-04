import { describe, expect, it } from "vitest";
import { filterFiles, matchesGlob, skipReason } from "../src/diff/filter.js";
import type { ChangedFile } from "../src/diff/types.js";

type Overrides = Omit<Partial<ChangedFile>, "patch"> & { patch?: string | undefined };

function file(filename: string, overrides: Overrides = {}): ChangedFile {
  const { patch, ...rest } = overrides;
  const base: ChangedFile = { filename, status: "modified", additions: 1, deletions: 0, ...rest };
  if (!("patch" in overrides)) base.patch = "@@ -1 +1 @@\n-a\n+b";
  else if (patch !== undefined) base.patch = patch;
  return base;
}

describe("skipReason", () => {
  it("skips lock files, binaries, generated output and files without a patch", () => {
    expect(skipReason(file("pnpm-lock.yaml"), [])).toBe("lock file");
    expect(skipReason(file("sub/dir/package-lock.json"), [])).toBe("lock file");
    expect(skipReason(file("logo.png"), [])).toBe("binary file");
    expect(skipReason(file("dist/index.js"), [])).toContain("generated file");
    expect(skipReason(file("web/app.min.js"), [])).toContain("generated file");
    expect(skipReason(file("src/__snapshots__/x.snap"), [])).toContain("generated file");
    expect(skipReason(file("big.ts", { patch: undefined }), [])).toContain("no patch");
  });

  it("recognises a pure rename", () => {
    expect(skipReason(file("b.ts", { status: "renamed", additions: 0, deletions: 0, patch: undefined }), [])).toBe(
      "pure rename, no content change",
    );
  });

  it("applies config ignore globs, matching basename-only patterns at any depth", () => {
    expect(skipReason(file("docs/guide.md"), ["docs/**"])).toContain("docs/**");
    expect(skipReason(file("a/b/c.test.ts"), ["*.test.ts"])).toContain("*.test.ts");
    expect(skipReason(file("src/main.ts"), ["docs/**", "*.test.ts"])).toBeNull();
  });

  it("matches dotfiles", () => {
    expect(matchesGlob(".github/workflows/ci.yml", ".github/**")).toBe(true);
  });
});

describe("filterFiles", () => {
  it("keeps order, reports every skip, and stops at max_files", () => {
    const files = [file("a.ts"), file("yarn.lock"), file("b.ts"), file("c.ts"), file("d.ts")];
    const result = filterFiles(files, { ignore: [], maxFiles: 2 });
    expect(result.kept.map((f) => f.filename)).toEqual(["a.ts", "b.ts"]);
    expect(result.truncated).toBe(true);
    expect(result.skipped).toEqual([
      { filename: "yarn.lock", reason: "lock file" },
      { filename: "c.ts", reason: "over max_files (2)" },
      { filename: "d.ts", reason: "over max_files (2)" },
    ]);
  });

  it("is not truncated when the limit is not reached", () => {
    const result = filterFiles([file("a.ts")], { ignore: [], maxFiles: 40 });
    expect(result.truncated).toBe(false);
    expect(result.skipped).toEqual([]);
  });
});
