import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { CATEGORIES, type Category } from "./review/schema.js";
import type { Effort } from "./review/provider.js";

export interface ReviewConfig {
  /** Extra ignore globs, added to the built-in lock/generated/binary rules. */
  ignore: string[];
  /** Categories to concentrate on. Empty means all. */
  focus: Category[];
  /** Allow `style` findings. Off by default: style nits are noise in most repos. */
  styleComments: boolean;
  /** Natural language for comment text, e.g. `en`, `de`, `pt-BR`. */
  language: string;
  /** Hard cap on inline findings per review. */
  maxFindings: number;
  /** Claude effort level. `medium` is the Opus 5.5 default and already beats Opus 5 at `high`. */
  effort: Effort;
  /** Lines of surrounding file content shown on each side of a hunk. */
  contextLines: number;
}

export const DEFAULT_CONFIG: ReviewConfig = {
  ignore: [],
  focus: [],
  styleComments: false,
  language: "en",
  maxFindings: 15,
  effort: "medium",
  contextLines: 30,
};

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

const ConfigFileSchema = z.object({
  ignore: z.array(z.string().min(1)).optional(),
  focus: z.array(z.enum(CATEGORIES)).optional(),
  style_comments: z.boolean().optional(),
  language: z.string().min(1).optional(),
  max_findings: z.number().int().min(1).max(50).optional(),
  effort: z.enum(EFFORTS).optional(),
  context_lines: z.number().int().min(0).max(200).optional(),
});

export const KNOWN_KEYS = Object.keys(ConfigFileSchema.shape);

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface LoadedConfig {
  config: ReviewConfig;
  warnings: string[];
  /** True when a config file was found and used. */
  found: boolean;
}

/**
 * Parse the contents of `.github/ai-review.yml`. Pass `null` when the file does
 * not exist to get the defaults. Unknown keys produce warnings, not failures;
 * malformed YAML or wrong value types fail loudly so a typo cannot silently
 * disable a setting.
 */
export function parseConfig(source: string | null, path = ".github/ai-review.yml"): LoadedConfig {
  if (source === null) return { config: { ...DEFAULT_CONFIG }, warnings: [], found: false };

  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (error) {
    throw new ConfigError(`${path} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (raw === null || raw === undefined) {
    return { config: { ...DEFAULT_CONFIG }, warnings: [`${path} is empty; using defaults`], found: true };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError(`${path} must be a YAML mapping, got ${Array.isArray(raw) ? "a list" : typeof raw}`);
  }

  const warnings: string[] = [];
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!KNOWN_KEYS.includes(key)) {
      warnings.push(`${path}: unknown key \`${key}\` ignored (known keys: ${KNOWN_KEYS.join(", ")})`);
    }
  }

  const result = ConfigFileSchema.safeParse(record);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`${path} has invalid values: ${issues}`);
  }
  const file = result.data;
  const config: ReviewConfig = {
    ignore: file.ignore ?? DEFAULT_CONFIG.ignore,
    focus: file.focus ?? DEFAULT_CONFIG.focus,
    styleComments: file.style_comments ?? DEFAULT_CONFIG.styleComments,
    language: file.language ?? DEFAULT_CONFIG.language,
    maxFindings: file.max_findings ?? DEFAULT_CONFIG.maxFindings,
    effort: file.effort ?? DEFAULT_CONFIG.effort,
    contextLines: file.context_lines ?? DEFAULT_CONFIG.contextLines,
  };
  return { config, warnings, found: true };
}
