/**
 * Studio-preview token: HMAC-signed, short-lived, slug-bound authorization
 * for the dashboard's Branding > Studio Preview iframe.
 *
 * The dashboard's iframe is intentionally sandboxed without
 * `allow-same-origin`, so the public Studio route loaded inside it has no
 * access to the parent's auth/session storage and cannot prove "I am being
 * rendered for the owner". Instead, the dashboard (which IS authenticated)
 * asks the server to sign a short-lived token bound to the slug, and that
 * token is appended to the iframe URL. The route loader verifies the
 * signature server-side and grants the embed render — no referrer/origin
 * heuristics needed.
 *
 * Token format: `${base64url(canonicalPayloadJson)}.${base64url(hmacSha256)}`
 *
 * Payload:
 *   { slug, exp, scope: "studio_preview_v1" }
 *
 *   - slug:  the Studio slug this token authorizes (binds the token).
 *   - exp:   epoch ms expiration; verifier rejects on or after this time.
 *   - scope: namespace tag so a presentation-token signature can never be
 *            replayed here even if both share the same HMAC secret.
 *
 * The secret is read from `PRESENTATION_TOKEN_SECRET` (server-only env
 * var) — same secret the existing presentation-token issuer uses. The
 * different `scope` keeps the two token spaces disjoint.
 */
import {
  base64UrlEncode,
  hmacSha256,
} from "./presentation-token-canonical";

export interface StudioPreviewTokenPayload {
  slug: string;
  exp: number;
  scope: "studio_preview_v1";
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** TTL for issued tokens. The dashboard fetches a fresh one on mount, so a
 *  short-ish lifetime is fine; we keep it long enough to comfortably outlast
 *  a typical branding-edit session. */
export const STUDIO_PREVIEW_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function canonicalise(p: StudioPreviewTokenPayload): Uint8Array {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(p).sort()) {
    sorted[k] = (p as unknown as Record<string, unknown>)[k];
  }
  return enc.encode(JSON.stringify(sorted));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function signStudioPreviewToken(
  secret: string,
  payload: StudioPreviewTokenPayload,
): Promise<string> {
  const data = canonicalise(payload);
  const sig = await hmacSha256(secret, data);
  return `${base64UrlEncode(data)}.${base64UrlEncode(sig)}`;
}

export interface StudioPreviewTokenVerification {
  valid: boolean;
  reason?:
    | "empty"
    | "format"
    | "encoding"
    | "signature"
    | "payload"
    | "scope"
    | "slug"
    | "expired";
  payload?: StudioPreviewTokenPayload;
}

export async function verifyStudioPreviewToken(
  secret: string,
  token: string | null | undefined,
  expectedSlug: string,
): Promise<StudioPreviewTokenVerification> {
  if (!token || typeof token !== "string") return { valid: false, reason: "empty" };
  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, reason: "format" };

  let dataBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    dataBytes = base64UrlDecode(parts[0]!);
    sigBytes = base64UrlDecode(parts[1]!);
  } catch {
    return { valid: false, reason: "encoding" };
  }

  const expected = await hmacSha256(secret, dataBytes);
  if (!constantTimeEqual(expected, sigBytes)) {
    return { valid: false, reason: "signature" };
  }

  let payload: StudioPreviewTokenPayload;
  try {
    payload = JSON.parse(dec.decode(dataBytes)) as StudioPreviewTokenPayload;
  } catch {
    return { valid: false, reason: "payload" };
  }

  if (payload.scope !== "studio_preview_v1") return { valid: false, reason: "scope" };
  if (typeof payload.slug !== "string" || payload.slug !== expectedSlug) {
    return { valid: false, reason: "slug" };
  }
  if (typeof payload.exp !== "number" || Date.now() >= payload.exp) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, payload };
}

export function getStudioPreviewSecret(): string | null {
  const v = (process.env.PRESENTATION_TOKEN_SECRET ?? "").trim();
  if (v.length < 32) return null;
  return v;
}
