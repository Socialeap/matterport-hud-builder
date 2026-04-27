/**
 * Presentation-token verifier (Deno edge).
 *
 * The token format is `${uuid}.${base64url(signature_bytes)}` where
 * signature_bytes = HMAC-SHA256(secret, canonicalPayload). The DB
 * stores sha256(signature) as `token_hash` so a DB compromise alone
 * cannot replay tokens — an attacker would also need either the
 * secret (to forge new ones) or the full token value.
 *
 * Verification path:
 *   1. Split on the last `.`
 *   2. Resolve the `id` row via the service-role client
 *   3. Recompute HMAC-SHA256(secret, canonicalPayload)
 *   4. Constant-time compare to the supplied signature
 *   5. Cross-check sha256(signature) vs token_hash (defence-in-depth)
 *   6. Reject if revoked_at IS NOT NULL
 *   7. Optionally cross-check saved_model_id matches the body's
 *      claim, and that the model is paid + is_released
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

export interface PresentationTokenPayload {
  saved_model_id: string;
  issued_at: string; // ISO 8601
  scope: "ask_ai_v1";
}

export type VerifyResult =
  | { ok: true; saved_model_id: string; issued_at: string; token_id: string }
  | {
      ok: false;
      reason:
        | "missing"
        | "malformed"
        | "not_found"
        | "revoked"
        | "signature_mismatch"
        | "hash_mismatch"
        | "secret_missing"
        | "saved_model_missing"
        | "not_released"
        | "not_paid";
    };

const enc = new TextEncoder();

function base64UrlDecode(s: string): Uint8Array {
  // Tolerate both URL-safe and standard base64; pad to a multiple of 4.
  let str = s.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4 !== 0) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesEqualConstantTime(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacSha256(secret: string, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return new Uint8Array(sig);
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(buf);
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/** Canonical JSON over the payload — keys sorted, no whitespace. */
export function canonicalisePayload(p: PresentationTokenPayload): Uint8Array {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(p).sort()) {
    sorted[k] = (p as unknown as Record<string, unknown>)[k];
  }
  return enc.encode(JSON.stringify(sorted));
}

export interface VerifyOptions {
  /** When provided, the resolved saved_model_id must match. */
  expectedSavedModelId?: string;
  /** When true, also require the linked model is paid + is_released. */
  requireReleased?: boolean;
}

export async function verifyPresentationToken(
  token: string | null | undefined,
  service: SupabaseClient,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  if (!token || typeof token !== "string") return { ok: false, reason: "missing" };
  const lastDot = token.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === token.length - 1) {
    return { ok: false, reason: "malformed" };
  }
  const id = token.slice(0, lastDot);
  const sigB64 = token.slice(lastDot + 1);
  // Validate id shape (uuid) cheaply before touching the DB.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { ok: false, reason: "malformed" };
  }

  const secret = Deno.env.get("PRESENTATION_TOKEN_SECRET");
  if (!secret) return { ok: false, reason: "secret_missing" };

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64UrlDecode(sigB64);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const { data: row } = await service
    .from("presentation_tokens")
    .select("id, saved_model_id, token_hash, payload, revoked_at")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { ok: false, reason: "not_found" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };

  const payload = row.payload as PresentationTokenPayload | null;
  if (!payload || typeof payload !== "object" || !payload.saved_model_id) {
    return { ok: false, reason: "malformed" };
  }
  const recomputed = await hmacSha256(secret, canonicalisePayload(payload));
  if (!bytesEqualConstantTime(recomputed, signatureBytes)) {
    return { ok: false, reason: "signature_mismatch" };
  }
  const recomputedHash = bytesToHex(await sha256(signatureBytes));
  if (recomputedHash !== row.token_hash) {
    return { ok: false, reason: "hash_mismatch" };
  }
  if (
    opts.expectedSavedModelId &&
    opts.expectedSavedModelId !== row.saved_model_id
  ) {
    return { ok: false, reason: "saved_model_missing" };
  }

  if (opts.requireReleased) {
    const { data: model } = await service
      .from("saved_models")
      .select("id, status, is_released")
      .eq("id", row.saved_model_id)
      .maybeSingle();
    if (!model) return { ok: false, reason: "saved_model_missing" };
    if (model.status !== "paid") return { ok: false, reason: "not_paid" };
    if (!model.is_released) return { ok: false, reason: "not_released" };
  }

  return {
    ok: true,
    saved_model_id: row.saved_model_id,
    issued_at: payload.issued_at,
    token_id: row.id,
  };
}
