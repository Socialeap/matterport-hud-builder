/**
 * Server-side AES-GCM-256 encryption used by the password-gated
 * presentation export. The visitor's runtime in
 * src/lib/portal.functions.ts (the inline IIFE) re-derives the same key
 * via PBKDF2-SHA256 at unlock time, so the values produced here are
 * byte-for-byte what the browser decoder consumes.
 *
 * Lives in its own module so the encrypt/decrypt round-trip can be
 * unit-tested without dragging in the rest of portal.functions.ts (which
 * pulls TanStack Start server-fn machinery and Supabase types).
 */

export interface ProtectedConfigBlob {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iter: number;
  /** base64-encoded 16-byte salt */
  salt: string;
  /** base64-encoded 12-byte IV */
  iv: string;
  /** base64-encoded ciphertext + GCM tag */
  ct: string;
}

/** Min password length the gate accepts. Mirrored on the Builder UI
 *  and on the generator's request validator. */
export const PROTECTED_MIN_PASSWORD_LEN = 4;
/** PBKDF2 iteration count for new exports.
 *
 *  Capped at 100,000 because Cloudflare Workers' WebCrypto
 *  implementation rejects PBKDF2 above that threshold with
 *  "iteration counts above 100000 are not supported". The visitor's
 *  browser (full WebCrypto, no cap) re-derives the key using the
 *  `iter` value embedded in the blob, so older exports built at
 *  600_000 still decrypt fine — only the encryption side has to
 *  respect the Worker limit. */
export const PROTECTED_PBKDF2_ITERATIONS = 100_000;

function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return Buffer.from(binary, "binary").toString("base64");
}

/**
 * Encrypts a JSON-serialisable secret config under a password-derived
 * AES-GCM-256 key. The plaintext password is consumed once; nothing
 * leaks back through the returned blob beyond the ciphertext + KDF
 * parameters.
 */
export async function encryptConfigForExport(
  secretConfig: unknown,
  password: string,
): Promise<ProtectedConfigBlob> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto Subtle API is unavailable on the server.");
  }
  const enc = new TextEncoder();
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  const aesKey = await subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PROTECTED_PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    enc.encode(JSON.stringify(secretConfig)),
  );
  return {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iter: PROTECTED_PBKDF2_ITERATIONS,
    salt: bufToBase64(salt),
    iv: bufToBase64(iv),
    ct: bufToBase64(ciphertext),
  };
}
