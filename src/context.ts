import type { PullRef } from "./github/api.js";

/** The comment command that re-runs the review on demand. */
export const COMMAND = "/ai-review";

export interface EventContext {
  eventName: string;
  repo: { owner: string; repo: string };
  payload: Record<string, unknown>;
}

export type Trigger =
  | { kind: "pull_request"; ref: PullRef; action: string }
  | { kind: "comment"; ref: PullRef; commenter: string }
  | { kind: "none"; reason: string };

/**
 * Decide whether this workflow run should review a PR, and which one.
 *
 * `pull_request` is accepted (not `pull_request_target`, see README). An
 * `issue_comment` counts only when it is a new comment on a PR whose body
 * starts with `/ai-review`.
 */
export function resolveTrigger(context: EventContext): Trigger {
  const { eventName, repo, payload } = context;

  if (eventName === "pull_request" || eventName === "pull_request_target") {
    const pr = payload["pull_request"] as { number?: unknown } | undefined;
    if (!pr || typeof pr.number !== "number") {
      return { kind: "none", reason: "pull_request payload has no number" };
    }
    return {
      kind: "pull_request",
      ref: { ...repo, number: pr.number },
      action: typeof payload["action"] === "string" ? payload["action"] : "unknown",
    };
  }

  if (eventName === "issue_comment") {
    if (payload["action"] !== "created") {
      return { kind: "none", reason: `issue_comment action is ${String(payload["action"])}, not created` };
    }
    const issue = payload["issue"] as { number?: unknown; pull_request?: unknown } | undefined;
    const comment = payload["comment"] as { body?: unknown; user?: { login?: unknown } } | undefined;
    if (!issue || !issue.pull_request || typeof issue.number !== "number") {
      return { kind: "none", reason: "comment is not on a pull request" };
    }
    const body = typeof comment?.body === "string" ? comment.body.trim() : "";
    if (!isCommand(body)) {
      return { kind: "none", reason: `comment does not start with ${COMMAND}` };
    }
    const commenter = typeof comment?.user?.login === "string" ? comment.user.login : "unknown";
    return { kind: "comment", ref: { ...repo, number: issue.number }, commenter };
  }

  return { kind: "none", reason: `event ${eventName} is not supported (use pull_request or issue_comment)` };
}

export function isCommand(body: string): boolean {
  const first = body.split(/\s+/)[0] ?? "";
  return first === COMMAND;
}
