/**
 * Generic exponential-backoff retry helper for transient external-API
 * failures. Used by the LLM/HTTP call sites in extract-property-doc,
 * extract-url-content, and induce-schema. Stripe calls use the SDK's
 * built-in `maxNetworkRetries` config and do NOT go through this helper.
 *
 * Design intent:
 *   - Retry only when the operation is transient (network error, 5xx,
 *     429). Permanent failures (4xx other than 429) do NOT retry.
 *   - Capped backoff with jitter so concurrent retries from the same
 *     isolate don't synchronise.
 *   - Caller-controlled `shouldRetry` predicate so HTTP wrappers can
 *     inspect a Response object before deciding.
 *   - Total wall-clock budget capped via `maxAttempts × maxDelayMs`
 *     so a hung upstream cannot stall the function past its platform
 *     timeout.
 */

export interface RetryOptions {
  /** Max attempts INCLUDING the first try. Default 3. */
  maxAttempts?: number;
  /** Base delay before first retry, in ms. Default 500. */
  baseDelayMs?: number;
  /** Hard cap on any single backoff sleep, in ms. Default 4000. */
  maxDelayMs?: number;
  /** Predicate: given the most recent error, should we retry?
   *  Defaults to "yes for any error" (caller should narrow). */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Optional label for logs (`[retry] <label> attempt=…`). */
  label?: string;
}

export class RetryGivenUp extends Error {
  constructor(public readonly cause: unknown, public readonly attempts: number) {
    super(
      `retry: gave up after ${attempts} attempts (${
        cause instanceof Error ? cause.message : String(cause)
      })`,
    );
  }
}

const DEFAULT_OPTS: Required<Omit<RetryOptions, "shouldRetry" | "label">> = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 4000,
};

function backoffDelay(attempt: number, base: number, cap: number): number {
  // Exponential growth (base, 2x, 4x, ...) capped at `cap`, then add up
  // to ±25% jitter to break synchronised retry storms.
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  const jitter = exp * (Math.random() * 0.5 - 0.25);
  return Math.max(0, Math.round(exp + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = DEFAULT_OPTS.maxAttempts,
    baseDelayMs = DEFAULT_OPTS.baseDelayMs,
    maxDelayMs = DEFAULT_OPTS.maxDelayMs,
    shouldRetry = () => true,
    label,
  } = options;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const willRetry =
        attempt < maxAttempts && shouldRetry(err, attempt);
      if (label) {
        console.warn(
          `[retry] ${label} attempt=${attempt}/${maxAttempts} ${
            willRetry ? "will_retry" : "gave_up"
          }: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (!willRetry) break;
      await sleep(backoffDelay(attempt, baseDelayMs, maxDelayMs));
    }
  }
  throw new RetryGivenUp(lastErr, maxAttempts);
}

/**
 * HTTP-aware variant. Calls `fn` (typically a `fetch(...)`), inspects
 * the resolved `Response`, and retries when:
 *   - the underlying fetch threw (network error)
 *   - the response status is 408, 429, or 5xx
 *
 * Returns the final `Response` (which may itself still be non-OK if
 * we exhausted attempts — caller checks `.ok`).
 */
export async function retryFetch(
  fn: () => Promise<Response>,
  options: RetryOptions = {},
): Promise<Response> {
  return retryWithBackoff(async () => {
    const resp = await fn();
    if (
      resp.status === 408 ||
      resp.status === 429 ||
      (resp.status >= 500 && resp.status < 600)
    ) {
      // Drain the body so the connection can be reused, then throw a
      // tagged error so retryWithBackoff sees a failure.
      try { await resp.text(); } catch { /* ignore */ }
      throw new Error(`http_${resp.status}`);
    }
    return resp;
  }, {
    ...options,
    shouldRetry: options.shouldRetry ?? ((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      // Retry on the tagged HTTP statuses + any thrown fetch error.
      return /^http_(408|429|5\d\d)$/.test(msg) || !msg.startsWith("http_");
    }),
  });
}
