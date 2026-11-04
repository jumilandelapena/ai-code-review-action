import type { SkippedFile } from "../diff/types.js";

/** A file rendered for the prompt, with and without its surrounding context lines. */
export interface RenderedFile {
  filename: string;
  text: string;
  tokens: number;
  textWithoutContext: string;
  tokensWithoutContext: number;
  firstAddedLine: number | null;
  firstAddedContent: string | null;
}

export interface BatchPlan {
  batches: RenderedFile[][];
  skipped: SkippedFile[];
}

/**
 * Greedily pack files into batches whose measured size stays under `budget`.
 *
 * `fixedTokens` is the per-request overhead (system prompt + PR header) that
 * every batch pays. A file that does not fit on its own is retried without
 * context lines; if it still does not fit it is skipped and reported.
 */
export function planBatches(files: RenderedFile[], budget: number, fixedTokens: number): BatchPlan {
  const batches: RenderedFile[][] = [];
  const skipped: SkippedFile[] = [];
  const available = budget - fixedTokens;
  if (available <= 0) {
    return {
      batches: [],
      skipped: files.map((file) => ({
        filename: file.filename,
        reason: `max_diff_tokens (${budget}) is smaller than the fixed prompt (${fixedTokens} tokens)`,
      })),
    };
  }

  let current: RenderedFile[] = [];
  let currentTokens = 0;
  const flush = () => {
    if (current.length > 0) batches.push(current);
    current = [];
    currentTokens = 0;
  };

  for (const original of files) {
    let file = original;
    if (file.tokens > available) {
      if (file.tokensWithoutContext > available) {
        skipped.push({
          filename: file.filename,
          reason: `diff alone is ${file.tokensWithoutContext} tokens, over the ${available} available under max_diff_tokens`,
        });
        continue;
      }
      file = {
        ...file,
        text: file.textWithoutContext,
        tokens: file.tokensWithoutContext,
      };
    }
    if (currentTokens + file.tokens > available) flush();
    current.push(file);
    currentTokens += file.tokens;
  }
  flush();
  return { batches, skipped };
}

/** Split a batch in two halves (used when the measured request is still over budget). */
export function splitBatch(batch: RenderedFile[]): [RenderedFile[], RenderedFile[]] {
  const mid = Math.ceil(batch.length / 2);
  return [batch.slice(0, mid), batch.slice(mid)];
}
