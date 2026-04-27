/**
 * Pure (dep-free) helpers shared by the presentation-token issuer
 * (Node / TanStack server runtime) and tests. The Deno verifier
 * mirrors the same logic verbatim — see
 * `supabase/functions/_shared/presentation-token.ts`.
 *
 * Keeping this file deps-free makes it importable from tests without
 * the Supabase client being present.
 */

export interface PresentationTokenPayload {
  saved_model_id: string;
  issued_at: string;
  scope: "ask_ai_v1";
}

const enc = new TextEncoder();

export function canonicalisePayload(p: PresentationTokenPayload): Uint8Array {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(p).sort()) {
    sorted[k] = (p as unknown as Record<string, unknown>)[k];
  }
  return enc.encode(JSON.stringify(sorted));
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

const SUBTLE = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto
  ?.subtle;

function getSubtle(): SubtleCrypto {
  if (!SUBTLE) {
    throw new Error(
      "presentation-token: WebCrypto subtle is unavailable in this runtime",
    );
  }
  return SUBTLE;
}

// Lib DOM `BufferSource` requires `ArrayBuffer`-backed views (not the
// generic `ArrayBufferLike` that may include `SharedArrayBuffer`).
// `toBufferSource` copies into a fresh `ArrayBuffer`-backed view so
// the WebCrypto signatures resolve cleanly under strict TS lib types.
function toBufferSource(u8: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(u8.byteLength));
  copy.set(u8);
  return copy as Uint8Array<ArrayBuffer>;
}

export async function hmacSha256(
  secret: string,
  data: Uint8Array,
): Promise<Uint8Array> {
  const subtle = getSubtle();
  const key = await subtle.importKey(
    "raw",
    toBufferSource(enc.encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await subtle.sign("HMAC", key, toBufferSource(data));
  return new Uint8Array(sig);
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buf = await getSubtle().digest("SHA-256", toBufferSource(data));
  return new Uint8Array(buf);
}
