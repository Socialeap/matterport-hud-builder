/**
 * In-memory token-bucket rate limiter for the public Ask AI surface.
 *
 * Per-isolate state. Edge isolates may be reused across invocations
 * but are not shared globally — this gives a soft 5/min/IP cap which
 * meets the spec minimum for typical traffic patterns. For higher
 * robustness against burst or distributed abuse, swap the in-memory
 * store for an Upstash Redis check; the helper signature is the
 * same so callers do not need to change.
 */

export interface RateLimitConfig {
  /** Tokens replenished per minute (also the bucket capacity). */
  perMinute: number;
}

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

const buckets = new Map<string, BucketState>();
// Belt-and-braces eviction: drop entries we haven't seen in 30 minutes
// so a single isolate doesn't accumulate keys forever.
const EVICT_AFTER_MS = 30 * 60 * 1000;
let lastEvictMs = 0;

export function checkRateLimit(
  ip: string,
  cfg: RateLimitConfig = { perMinute: 5 },
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  if (now - lastEvictMs > 60_000) {
    for (const [k, b] of buckets) {
      if (now - b.lastRefillMs > EVICT_AFTER_MS) buckets.delete(k);
    }
    lastEvictMs = now;
  }

  const capacity = Math.max(1, cfg.perMinute);
  const refillPerMs = capacity / 60_000;
  const key = ip || "unknown";
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: capacity, lastRefillMs: now };
    buckets.set(key, b);
  }
  // Refill since last seen.
  const elapsed = Math.max(0, now - b.lastRefillMs);
  b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerMs);
  b.lastRefillMs = now;

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
  // Compute wait time until at least one token is available.
  const needed = 1 - b.tokens;
  const waitMs = Math.ceil(needed / refillPerMs);
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
  };
}

/** Best-effort IP extraction. Falls back to "unknown" so the limiter
 *  still applies (treating all unknowns as one bucket — paranoid but
 *  safe). The caller should pass through any X-Forwarded-For value
 *  that the platform vouches for; in Supabase edge runtime that's
 *  the standard "x-forwarded-for" header. */
export function ipFromRequest(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const first = xff.split(",")[0]?.trim();
  return first || req.headers.get("cf-connecting-ip") || "unknown";
}
