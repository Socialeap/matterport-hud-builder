/**
 * In-memory token-bucket rate limiter for TanStack server functions.
 *
 * Mirrors the API of `supabase/functions/_shared/rate-limit.ts` so the
 * two surfaces (Deno edge functions + Cloudflare Worker server fns)
 * have identical semantics. Per-isolate state — soft caps that suit
 * typical traffic patterns. For stronger guarantees against burst or
 * distributed abuse, swap the in-memory store for Cloudflare KV or D1
 * later (Phase 6); the helper signature is the same so callers do not
 * need to change.
 *
 * IMPORTANT: this file is server-only. Do NOT import it from any
 * client-bundled code path — `import.meta.env` checks aren't enforced
 * here, and the `Map` state would otherwise be allocated per page
 * load.
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
  const elapsed = Math.max(0, now - b.lastRefillMs);
  b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerMs);
  b.lastRefillMs = now;

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
  const needed = 1 - b.tokens;
  const waitMs = Math.ceil(needed / refillPerMs);
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
  };
}

/**
 * Best-effort IP extraction from a TanStack/Cloudflare request. Cloudflare
 * sets `cf-connecting-ip` for the originating client; behind other
 * proxies the standard `x-forwarded-for` header is accepted. Falls back
 * to "unknown" so the limiter still applies (treating all unknowns as
 * one bucket — paranoid but safe).
 */
export function ipFromRequest(req: Request | undefined): string {
  if (!req) return "unknown";
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const first = xff.split(",")[0]?.trim();
  return first || "unknown";
}
