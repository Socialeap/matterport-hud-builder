/**
 * In-memory token-bucket rate limiter unit tests.
 *
 * Run via `node --test --experimental-strip-types`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// The Deno-targeted module uses the Deno-native `Date.now()` and
// `Map` only — both work in Node verbatim.
const mod = await import("../supabase/functions/_shared/rate-limit.ts");

test("first 5 requests in a fresh isolate are allowed", () => {
  for (let i = 0; i < 5; i++) {
    const r = mod.checkRateLimit("test-burst-1", { perMinute: 5 });
    assert.equal(r.allowed, true, `request ${i + 1} should be allowed`);
  }
});

test("6th request in the same minute is rejected with retryAfter", () => {
  const ip = "test-burst-2";
  for (let i = 0; i < 5; i++) mod.checkRateLimit(ip, { perMinute: 5 });
  const r = mod.checkRateLimit(ip, { perMinute: 5 });
  assert.equal(r.allowed, false);
  assert.ok(r.retryAfterSeconds >= 1);
  assert.ok(r.retryAfterSeconds <= 60);
});

test("different IPs have independent buckets", () => {
  for (let i = 0; i < 5; i++)
    assert.equal(
      mod.checkRateLimit("test-burst-3a", { perMinute: 5 }).allowed,
      true,
    );
  // Different IP: still allowed.
  assert.equal(
    mod.checkRateLimit("test-burst-3b", { perMinute: 5 }).allowed,
    true,
  );
});

test("ipFromRequest reads x-forwarded-for first entry", () => {
  const req = new Request("https://example.com", {
    headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
  });
  assert.equal(mod.ipFromRequest(req), "1.2.3.4");
});

test("ipFromRequest falls back to cf-connecting-ip", () => {
  const req = new Request("https://example.com", {
    headers: { "cf-connecting-ip": "5.6.7.8" },
  });
  assert.equal(mod.ipFromRequest(req), "5.6.7.8");
});

test("ipFromRequest returns 'unknown' when no IP headers present", () => {
  const req = new Request("https://example.com");
  assert.equal(mod.ipFromRequest(req), "unknown");
});
