import { describe, expect, it } from "vitest";
import { isCommand, resolveTrigger } from "../src/context.js";

const repo = { owner: "acme", repo: "widgets" };

describe("resolveTrigger", () => {
  it("reviews on pull_request events", () => {
    const trigger = resolveTrigger({ eventName: "pull_request", repo, payload: { action: "synchronize", pull_request: { number: 7 } } });
    expect(trigger).toEqual({ kind: "pull_request", ref: { ...repo, number: 7 }, action: "synchronize" });
  });

  it("reviews when a new PR comment starts with /ai-review", () => {
    const trigger = resolveTrigger({
      eventName: "issue_comment",
      repo,
      payload: {
        action: "created",
        issue: { number: 9, pull_request: { url: "x" } },
        comment: { body: "  /ai-review please\n", user: { login: "alice" } },
      },
    });
    expect(trigger).toEqual({ kind: "comment", ref: { ...repo, number: 9 }, commenter: "alice" });
  });

  it("ignores comments on issues, edited comments, and other text", () => {
    const base = { action: "created", issue: { number: 9, pull_request: { url: "x" } }, comment: { body: "/ai-review", user: { login: "a" } } };
    expect(resolveTrigger({ eventName: "issue_comment", repo, payload: { ...base, issue: { number: 9 } } }).kind).toBe("none");
    expect(resolveTrigger({ eventName: "issue_comment", repo, payload: { ...base, action: "edited" } }).kind).toBe("none");
    expect(resolveTrigger({ eventName: "issue_comment", repo, payload: { ...base, comment: { body: "looks good /ai-review" } } }).kind).toBe("none");
  });

  it("rejects other events", () => {
    expect(resolveTrigger({ eventName: "push", repo, payload: {} }).kind).toBe("none");
  });

  it("isCommand matches only the leading word", () => {
    expect(isCommand("/ai-review")).toBe(true);
    expect(isCommand("/ai-review now")).toBe(true);
    expect(isCommand("/ai-reviewer")).toBe(false);
    expect(isCommand("")).toBe(false);
  });
});
