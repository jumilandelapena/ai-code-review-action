import { z } from "zod";

export const SEVERITIES = ["critical", "high", "medium", "low", "nit"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CATEGORIES = ["bug", "security", "performance", "correctness", "test", "style"] as const;
export type Category = (typeof CATEGORIES)[number];

export const VERDICTS = ["approve", "comment", "request_changes"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** Lower rank = more severe. Used for sorting and for `fail_on`. */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  nit: 4,
};

export const FindingSchema = z.object({
  file: z.string().describe("Path of the file exactly as it appears in the diff header."),
  line: z
    .number()
    .int()
    .describe("New-file line number of an added or changed line (a line marked `+`)."),
  severity: z.enum(SEVERITIES),
  category: z.enum(CATEGORIES),
  title: z.string().describe("One short sentence naming the problem."),
  explanation: z
    .string()
    .describe("Why it is a problem and what breaks. Plain, specific, no praise."),
  suggestion: z
    .string()
    .optional()
    .describe(
      "Optional drop-in replacement for exactly the flagged line. Must be complete code with the original indentation; omit when a one-line fix is not possible.",
    ),
});
export type Finding = z.infer<typeof FindingSchema>;

export const ReviewOutputSchema = z.object({
  findings: z.array(FindingSchema),
  summary: z
    .string()
    .describe("Two to five sentences on what the change does and the most important risks."),
  verdict: z.enum(VERDICTS),
});
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

export function isSeverity(value: unknown): value is Severity {
  return typeof value === "string" && (SEVERITIES as readonly string[]).includes(value);
}

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

/** True when `candidate` is at least as severe as `threshold`. */
export function meetsSeverity(candidate: Severity, threshold: Severity): boolean {
  return SEVERITY_RANK[candidate] <= SEVERITY_RANK[threshold];
}
