import { describe, expect, it } from "vitest";
import { ConfigError, DEFAULT_CONFIG, parseConfig } from "../src/config.js";

describe("parseConfig", () => {
  it("returns defaults when there is no file", () => {
    const loaded = parseConfig(null);
    expect(loaded.found).toBe(false);
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
    expect(loaded.warnings).toEqual([]);
  });

  it("returns defaults with a warning for an empty file", () => {
    const loaded = parseConfig("# nothing here\n");
    expect(loaded.found).toBe(true);
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
    expect(loaded.warnings[0]).toContain("empty");
  });

  it("reads every known key", () => {
    const loaded = parseConfig(
      [
        "ignore:",
        '  - "docs/**"',
        '  - "*.md"',
        "focus: [bug, security]",
        "style_comments: true",
        "language: de",
        "max_findings: 5",
        "effort: high",
        "context_lines: 10",
      ].join("\n"),
    );
    expect(loaded.config).toEqual({
      ignore: ["docs/**", "*.md"],
      focus: ["bug", "security"],
      styleComments: true,
      language: "de",
      maxFindings: 5,
      effort: "high",
      contextLines: 10,
    });
    expect(loaded.warnings).toEqual([]);
  });

  it("warns about unknown keys but keeps going", () => {
    const loaded = parseConfig("max_findings: 3\nmodel: claude-haiku-5-5\n");
    expect(loaded.config.maxFindings).toBe(3);
    expect(loaded.warnings).toHaveLength(1);
    expect(loaded.warnings[0]).toContain("unknown key `model`");
  });

  it("fails loudly on invalid YAML", () => {
    expect(() => parseConfig("ignore: [unclosed\n")).toThrow(ConfigError);
    expect(() => parseConfig("ignore: [unclosed\n")).toThrow(/not valid YAML/);
  });

  it("fails loudly on wrong value types and unknown categories", () => {
    expect(() => parseConfig("max_findings: many\n")).toThrow(/max_findings/);
    expect(() => parseConfig("focus: [vibes]\n")).toThrow(/focus/);
    expect(() => parseConfig("- just\n- a list\n")).toThrow(/mapping/);
  });
});
