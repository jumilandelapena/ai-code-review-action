import { minimatch } from "minimatch";
import type { ChangedFile, SkippedFile } from "./types.js";

/** Lock files are machine-written; reviewing them wastes tokens and finds nothing. */
export const LOCK_FILES = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "npm-shrinkwrap.json",
  "bun.lockb",
  "bun.lock",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "Gemfile.lock",
  "composer.lock",
  "go.sum",
  "mix.lock",
  "pubspec.lock",
  "flake.lock",
  "Podfile.lock",
  "packages.lock.json",
];

/** Globs for files that are generated from something else and should never be reviewed. */
export const GENERATED_GLOBS = [
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.next/**",
  "**/node_modules/**",
  "**/vendor/**",
  "**/generated/**",
  "**/__generated__/**",
  "**/__snapshots__/**",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
  "**/*.snap",
  "**/*.generated.*",
  "**/*.pb.go",
  "**/*.pb.ts",
  "**/*_pb2.py",
  "**/*_pb2_grpc.py",
  "**/*.g.dart",
  "**/*.freezed.dart",
  "**/*.designer.cs",
];

/** Extensions that are binary even when GitHub happens to return a patch. */
export const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "avif", "tif", "tiff", "psd",
  "pdf", "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "jar", "war",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "mov", "avi", "mkv", "wav", "ogg", "flac", "webm",
  "exe", "dll", "so", "dylib", "bin", "class", "pyc", "wasm", "o", "a",
  "sqlite", "db", "parquet", "pickle", "pkl", "npy", "npz", "h5",
]);

export interface FilterOptions {
  /** Extra globs from `.github/ai-review.yml`. Added to the built-in defaults. */
  ignore: string[];
  /** Stop after this many reviewable files. */
  maxFiles: number;
}

export interface FilterResult {
  kept: ChangedFile[];
  skipped: SkippedFile[];
  /** True when `maxFiles` cut the list short. */
  truncated: boolean;
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function extension(path: string): string {
  const base = basename(path);
  const idx = base.lastIndexOf(".");
  return idx === -1 ? "" : base.slice(idx + 1).toLowerCase();
}

/** Match a glob against a repo-relative path. Patterns without `/` match at any depth. */
export function matchesGlob(path: string, pattern: string): boolean {
  return minimatch(path, pattern, { dot: true, matchBase: !pattern.includes("/") });
}

/** Why a file is skipped, or `null` when it should be reviewed. */
export function skipReason(file: ChangedFile, ignore: string[]): string | null {
  const base = basename(file.filename);
  if (LOCK_FILES.includes(base)) return "lock file";
  if (BINARY_EXTENSIONS.has(extension(file.filename))) return "binary file";
  if (file.patch === undefined || file.patch === "") {
    if (file.status === "renamed" && file.additions === 0 && file.deletions === 0) {
      return "pure rename, no content change";
    }
    return "no patch (binary, or diff too large for GitHub to render)";
  }
  for (const pattern of GENERATED_GLOBS) {
    if (matchesGlob(file.filename, pattern)) return `generated file (${pattern})`;
  }
  for (const pattern of ignore) {
    if (matchesGlob(file.filename, pattern)) return `matches ignore glob \`${pattern}\``;
  }
  return null;
}

/**
 * Drop files the reviewer must not see and enforce `maxFiles`. The order of
 * the input (GitHub sorts by path) is preserved so truncation is deterministic.
 */
export function filterFiles(files: ChangedFile[], options: FilterOptions): FilterResult {
  const kept: ChangedFile[] = [];
  const skipped: SkippedFile[] = [];
  let truncated = false;
  for (const file of files) {
    const reason = skipReason(file, options.ignore);
    if (reason !== null) {
      skipped.push({ filename: file.filename, reason });
      continue;
    }
    if (kept.length >= options.maxFiles) {
      truncated = true;
      skipped.push({ filename: file.filename, reason: `over max_files (${options.maxFiles})` });
      continue;
    }
    kept.push(file);
  }
  return { kept, skipped, truncated };
}
