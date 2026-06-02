/**
 * Presentation-token issuer (server-only).
 *
 * Mirrors the format that `supabase/functions/_shared/presentation-token.ts`
 * verifies. Token format:
 *   `${row.id}.${base64url(HMAC-SHA256(secret, canonical(payload)))}`
 *
 * Stored row:
 *   token_hash = sha256(signature_bytes) hex
 *
 * The signature itself is never persisted — only its sha256 — so a DB
 * compromise alone cannot replay tokens.
 *
 * IMPORTANT: This module imports the Supabase server client and reads
 * a process env var. It is NOT safe to import from browser code; the
 * service-role key must never be bundled into the public chunk. The
 * file path is excluded from client bundles by Vite's import-graph
 * boundary (server functions only).
 */

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  base64UrlEncode,
  bytesToHex,
  canonicalisePayload,
  hmacSha256,
  sha256,
  type PresentationTokenPayload,
  type PresentationTokenScope,
} from "./presentation-token-canonical";

export type { PresentationTokenPayload, PresentationTokenScope };
export { canonicalisePayload };

export interface IssuedToken {
  /** The opaque value to embed in exported HTML. */
  value: string;
  /** Row id (also the prefix of `value`). */
  id: string;
  /** Canonical payload that was signed. */
  payload: PresentationTokenPayload;
}

function getSecret(): string {
  const v = process.env.PRESENTATION_TOKEN_SECRET;
  if (!v || v.length < 32) {
    throw new Error(
      "presentation-token: PRESENTATION_TOKEN_SECRET must be set (>= 32 chars)",
    );
  }
  return v;
}

function getServiceClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "presentation-token: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must be set",
    );
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Issue (or rotate) a token for a saved_model. If `rotate` is true,
 * the most recent active token for this model is marked revoked
 * before the new row is inserted, so old exports stop verifying.
 */
export async function issuePresentationToken(args: {
  savedModelId: string;
  rotate?: boolean;
  /** Token scope. Defaults to `ask_ai_v1` to preserve existing callers. */
  scope?: PresentationTokenScope;
}): Promise<IssuedToken> {
  const service = getServiceClient();
  const secret = getSecret();
  const scope: PresentationTokenScope = args.scope ?? "ask_ai_v1";
  const issuedAt = new Date().toISOString();
  const payload: PresentationTokenPayload = {
    saved_model_id: args.savedModelId,
    issued_at: issuedAt,
    scope,
  };

  // Insert a row first (Supabase generates the uuid) so we can fold
  // the row id into nothing the signature depends on.
  const sigBytes = await hmacSha256(secret, canonicalisePayload(payload));
  const tokenHash = bytesToHex(await sha256(sigBytes));

  // `presentation_tokens` lives outside the generated `Database` types
  // (it is provisioned by a server-only migration). Use an untyped
  // view of the client for these calls so the TS overloads resolve.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = service as unknown as any;

  // If rotating, revoke prior active token(s) atomically — but only within
  // the SAME scope, so issuing an `atlas_v1` token never revokes the live
  // `ask_ai_v1` token (or vice versa). The two scopes are independent.
  if (args.rotate) {
    await untyped
      .from("presentation_tokens")
      .update({ revoked_at: issuedAt })
      .eq("saved_model_id", args.savedModelId)
      .eq("payload->>scope", scope)
      .is("revoked_at", null);
  }

  const { data: inserted, error } = await untyped
    .from("presentation_tokens")
    .insert({
      saved_model_id: args.savedModelId,
      token_hash: tokenHash,
      payload,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    throw new Error(
      `presentation-token: insert failed: ${error?.message ?? "no row"}`,
    );
  }

  const value = `${inserted.id}.${base64UrlEncode(sigBytes)}`;
  return { value, id: inserted.id, payload };
}

/**
 * Get an active (non-revoked) token for the model, or issue one if
 * none exists. Used by `generatePresentation` so re-builds reuse the
 * same token instead of generating new ones for every export click.
 */
export async function ensurePresentationToken(
  savedModelId: string,
  scope: PresentationTokenScope = "ask_ai_v1",
): Promise<IssuedToken> {
  // Look up an existing non-revoked row first. Note: we deliberately
  // do NOT recover the embedded token value from the DB — only the
  // hash is stored. Reuse means: if a recent active row exists,
  // return its id but DO NOT re-emit a value (caller must rotate
  // when it actually wants the value to embed). For the export
  // pipeline we always issue fresh on every export click — the
  // signature is cheap, and rotation is the safer default.
  return issuePresentationToken({ savedModelId, rotate: true, scope });
}

/**
 * Issue a fresh `atlas_v1` token for the model, returning the opaque value
 * to embed in the exported package's `atlas-manifest.json`. Rotates the
 * prior atlas token (same-scope only — leaves the Ask-AI token untouched).
 * Verification (PR-2) fetches the manifest from the published URL and
 * matches this token's hash to confirm the publisher owns the model.
 */
export async function ensureAtlasManifestToken(
  savedModelId: string,
): Promise<IssuedToken> {
  return issuePresentationToken({ savedModelId, rotate: true, scope: "atlas_v1" });
}
