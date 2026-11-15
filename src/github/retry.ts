/**
 * Retry a GitHub API call on transient failures (rate limits, 5xx, network).
 */

export interface RetryOptions {
  /** Total number of attempts, including the first one. */
  attempts: number;
  /** Base delay; doubled after every failed attempt. */
  baseDelayMs: number;
  /** Called before each retry with the attempt number that just failed. */
  onRetry?: (attempt: number, error: unknown) => void;
}

export const DEFAULT_RETRY: RetryOptions = { attempts: 3, baseDelayMs: 500 };

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function isRetryable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") return RETRYABLE_STATUS.has(status);
  const code = (error as { code?: unknown }).code;
  return code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EAI_AGAIN";
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = DEFAULT_RETRY): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts + 1; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === options.attempts) break;
      options.onRetry?.(attempt, error);
      await sleep(options.baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
