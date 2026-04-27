/**
 * BYOK key crypto helpers (Deno edge).
 *
 * The plaintext Gemini API key is encrypted under BYOK_MASTER_KEY
 * (a 32-byte secret stored as base64 in env) using AES-GCM with a
 * fresh 96-bit IV. Ciphertext + IV are stored in
 * provider_byok_keys.ciphertext / .iv. The plaintext never leaves
 * an edge function — it's decrypted only at the moment of model
 * invocation in synthesize-answer (C12).
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function getMasterKeyBytes(): Uint8Array {
  const b64 = Deno.env.get("BYOK_MASTER_KEY");
  if (!b64) {
    throw new Error("byok-crypto: BYOK_MASTER_KEY env not set");
  }
  let bin: string;
  try {
    bin = atob(b64.trim());
  } catch {
    throw new Error("byok-crypto: BYOK_MASTER_KEY is not valid base64");
  }
  if (bin.length !== 32) {
    throw new Error(
      `byok-crypto: BYOK_MASTER_KEY must decode to 32 bytes, got ${bin.length}`,
    );
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importAesKey(usage: KeyUsage[]): Promise<CryptoKey> {
  const raw = getMasterKeyBytes();
  return await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false,
    usage,
  );
}

export interface EncryptedKey {
  ciphertext: Uint8Array;
  iv: Uint8Array;
}

export async function encryptKey(plaintext: string): Promise<EncryptedKey> {
  const key = await importAesKey(["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext),
  );
  return { ciphertext: new Uint8Array(cipherBuf), iv };
}

export async function decryptKey(
  ciphertext: Uint8Array,
  iv: Uint8Array,
): Promise<string> {
  const key = await importAesKey(["decrypt"]);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );
  return dec.decode(plainBuf);
}

/** Return the last 4 chars of the plaintext for masked UI display. */
export function fingerprintFor(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length <= 4) return trimmed.replace(/./g, "•");
  return `••••${trimmed.slice(-4)}`;
}

/**
 * Probe the supplied key against Gemini's listModels endpoint. A 200
 * with at least one model in the list is treated as a valid key.
 * Returns a short reason on failure suitable for the UI's
 * validation_error column.
 */
export async function probeGeminiKey(
  apiKey: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  let resp: Response;
  try {
    resp = await fetch(url, { method: "GET" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `network_error:${msg.slice(0, 80)}` };
  }
  if (resp.status === 401 || resp.status === 403) {
    return { ok: false, reason: "invalid_key" };
  }
  if (resp.status === 429) {
    return { ok: false, reason: "rate_limited" };
  }
  if (!resp.ok) {
    return { ok: false, reason: `gemini_${resp.status}` };
  }
  let body: { models?: unknown[] };
  try {
    body = await resp.json();
  } catch {
    return { ok: false, reason: "invalid_response" };
  }
  if (!body.models || !Array.isArray(body.models) || body.models.length === 0) {
    return { ok: false, reason: "no_models_returned" };
  }
  return { ok: true };
}
