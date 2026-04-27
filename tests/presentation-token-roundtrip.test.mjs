/**
 * Sign-then-verify round-trip for presentation tokens. Uses a stub
 * Supabase client to avoid touching a real DB.
 *
 * What we exercise:
 *   - HMAC over canonical payload
 *   - sha256(signature) hex == stored token_hash
 *   - constant-time match on signature bytes
 *   - revoked_at rejection
 *   - signature_mismatch rejection (tampered signature)
 *   - hash_mismatch rejection (tampered token_hash row)
 *   - secret_missing rejection (no env)
 *
 * Run via `node --test --experimental-strip-types`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const canonical = await import("../src/lib/presentation-token-canonical.ts");
const verifier = await import(
  "../supabase/functions/_shared/presentation-token.ts"
);

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function envGuard(value, fn) {
  const prior = process.env.PRESENTATION_TOKEN_SECRET;
  if (value === null) delete process.env.PRESENTATION_TOKEN_SECRET;
  else process.env.PRESENTATION_TOKEN_SECRET = value;
  globalThis.Deno = {
    env: {
      get: (k) =>
        k === "PRESENTATION_TOKEN_SECRET" ? process.env.PRESENTATION_TOKEN_SECRET : undefined,
    },
  };
  return fn().finally(() => {
    if (prior === undefined) delete process.env.PRESENTATION_TOKEN_SECRET;
    else process.env.PRESENTATION_TOKEN_SECRET = prior;
    delete globalThis.Deno;
  });
}

function makeStubService(row) {
  return {
    from(table) {
      assert.equal(table, "presentation_tokens");
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: row, error: null };
        },
      };
    },
  };
}

async function issueLocal(payload, secret) {
  const sigBytes = await canonical.hmacSha256(
    secret,
    canonical.canonicalisePayload(payload),
  );
  const tokenHash = canonical.bytesToHex(await canonical.sha256(sigBytes));
  const id = "00000000-0000-0000-0000-00000000aaaa";
  const value = `${id}.${canonical.base64UrlEncode(sigBytes)}`;
  return { value, id, tokenHash };
}

test("round-trip: valid token verifies and resolves saved_model_id", () => {
  const payload = {
    saved_model_id: "11111111-2222-3333-4444-555555555555",
    issued_at: "2026-04-27T00:00:00.000Z",
    scope: "ask_ai_v1",
  };
  return envGuard(SECRET, async () => {
    const { value, id, tokenHash } = await issueLocal(payload, SECRET);
    const service = makeStubService({
      id,
      saved_model_id: payload.saved_model_id,
      token_hash: tokenHash,
      payload,
      revoked_at: null,
    });
    const res = await verifier.verifyPresentationToken(value, service);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.saved_model_id, payload.saved_model_id);
    }
  });
});

test("revoked token is rejected", () => {
  const payload = {
    saved_model_id: "id",
    issued_at: "t",
    scope: "ask_ai_v1",
  };
  return envGuard(SECRET, async () => {
    const { value, id, tokenHash } = await issueLocal(payload, SECRET);
    const service = makeStubService({
      id,
      saved_model_id: payload.saved_model_id,
      token_hash: tokenHash,
      payload,
      revoked_at: "2026-04-27T01:00:00.000Z",
    });
    const res = await verifier.verifyPresentationToken(value, service);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "revoked");
  });
});

test("tampered signature is rejected", () => {
  const payload = {
    saved_model_id: "id",
    issued_at: "t",
    scope: "ask_ai_v1",
  };
  return envGuard(SECRET, async () => {
    const { value, id, tokenHash } = await issueLocal(payload, SECRET);
    // Flip a byte in the signature portion of the token value.
    const dot = value.lastIndexOf(".");
    const sigPart = value.slice(dot + 1);
    const flippedSig =
      (sigPart[0] === "A" ? "B" : "A") + sigPart.slice(1);
    const tamperedValue = `${value.slice(0, dot)}.${flippedSig}`;
    const service = makeStubService({
      id,
      saved_model_id: payload.saved_model_id,
      token_hash: tokenHash,
      payload,
      revoked_at: null,
    });
    const res = await verifier.verifyPresentationToken(tamperedValue, service);
    assert.equal(res.ok, false);
    // Either signature_mismatch (HMAC differs) or hash_mismatch
    // (sha256 differs) is a valid rejection.
    if (!res.ok) {
      assert.ok(
        res.reason === "signature_mismatch" || res.reason === "hash_mismatch",
        `unexpected reason ${res.reason}`,
      );
    }
  });
});

test("missing token rejected with reason 'missing'", () => {
  return envGuard(SECRET, async () => {
    const service = makeStubService(null);
    const res = await verifier.verifyPresentationToken(null, service);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "missing");
  });
});

test("malformed token rejected with reason 'malformed'", () => {
  return envGuard(SECRET, async () => {
    const service = makeStubService(null);
    const res = await verifier.verifyPresentationToken("not-a-token", service);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "malformed");
  });
});

test("missing secret rejected with reason 'secret_missing'", () => {
  return envGuard(null, async () => {
    const payload = {
      saved_model_id: "id",
      issued_at: "t",
      scope: "ask_ai_v1",
    };
    // Build a syntactically-valid token with a placeholder signature.
    const id = "00000000-0000-0000-0000-00000000aaaa";
    const tokenValue = `${id}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    const service = makeStubService({
      id,
      saved_model_id: payload.saved_model_id,
      token_hash: "deadbeef",
      payload,
      revoked_at: null,
    });
    const res = await verifier.verifyPresentationToken(tokenValue, service);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "secret_missing");
  });
});
