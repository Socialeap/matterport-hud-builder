/**
 * Parity test: the issuer (TanStack server runtime, Node) and the
 * verifier (Deno edge) must agree on the canonical-payload bytes
 * over which HMAC is computed. A drift here would silently break
 * every public Ask AI request.
 *
 * Run via `node --test --experimental-strip-types`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// Import the dep-free canonicalisation directly so tests don't need
// the Supabase client present.
const issuer = await import("../src/lib/presentation-token-canonical.ts");
const verifier = await import(
  "../supabase/functions/_shared/presentation-token.ts"
);

const PAYLOADS = [
  {
    saved_model_id: "00000000-0000-0000-0000-000000000001",
    issued_at: "2026-04-27T00:00:00.000Z",
    scope: "ask_ai_v1",
  },
  {
    // Reordered keys — canonicalisation must sort, so output must match.
    scope: "ask_ai_v1",
    issued_at: "2026-04-27T00:00:00.000Z",
    saved_model_id: "11111111-2222-3333-4444-555555555555",
  },
];

test("canonicalisePayload byte parity between issuer and verifier", () => {
  for (const p of PAYLOADS) {
    const a = issuer.canonicalisePayload(p);
    const b = verifier.canonicalisePayload(p);
    assert.equal(a.length, b.length, "byte length mismatch");
    for (let i = 0; i < a.length; i++) {
      assert.equal(a[i], b[i], `byte ${i} mismatch`);
    }
  }
});

test("canonicalisePayload is key-order invariant", () => {
  const a = issuer.canonicalisePayload({
    saved_model_id: "id",
    issued_at: "t",
    scope: "ask_ai_v1",
  });
  const b = issuer.canonicalisePayload({
    scope: "ask_ai_v1",
    issued_at: "t",
    saved_model_id: "id",
  });
  assert.deepEqual([...a], [...b]);
});
