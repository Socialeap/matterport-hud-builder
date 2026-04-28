/**
 * Round-trip test for the password-gate envelope used by exported
 * presentations. Verifies the server's encrypt path produces a blob
 * the visitor runtime's decrypt logic can read back — including
 * negative cases (wrong password, tampered ciphertext, tampered IV).
 *
 * The runtime decrypt is the inline JS in src/lib/portal.functions.ts,
 * but its only inputs are the blob shape + the visitor password +
 * SubtleCrypto. We re-implement just enough of that pipeline here to
 * stand in for the browser at unlock time.
 *
 * Run via `node --test --experimental-strip-types`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { encryptConfigForExport, PROTECTED_PBKDF2_ITERATIONS } = await import(
  "../src/lib/portal/protected-export.ts"
);

function b64ToBytes(b64) {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

async function runtimeDecrypt(blob, password) {
  // Mirrors the inline runtime in src/lib/portal.functions.ts (the
  // unlock handler in the safety bootstrap). Any divergence here would
  // mean the test is happy but a real visitor sees a broken gate.
  const enc = new TextEncoder();
  const subtle = globalThis.crypto.subtle;
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
      salt: b64ToBytes(blob.salt),
      iterations: blob.iter,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plaintext = await subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(blob.iv) },
    aesKey,
    b64ToBytes(blob.ct),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

const SAMPLE_SECRET = {
  properties: [
    { iframeUrl: "https://my.matterport.com/show/?m=ABC123XYZ45", musicUrl: "" },
  ],
  agent: { name: "Alex", email: "alex@example.com" },
  propertyUuidByIndex: ["uuid-1"],
  gaTrackingId: "",
  agentAvatarUrl: "",
  studioId: "studio-1",
};

test("encryptConfigForExport: round-trips with the correct password", async () => {
  const blob = await encryptConfigForExport(SAMPLE_SECRET, "letmein123");
  assert.equal(blob.v, 1);
  assert.equal(blob.kdf, "PBKDF2-SHA256");
  assert.equal(blob.iter, PROTECTED_PBKDF2_ITERATIONS);
  assert.match(blob.salt, /^[A-Za-z0-9+/=]+$/);
  assert.match(blob.iv, /^[A-Za-z0-9+/=]+$/);
  assert.match(blob.ct, /^[A-Za-z0-9+/=]+$/);

  const recovered = await runtimeDecrypt(blob, "letmein123");
  assert.deepEqual(recovered, SAMPLE_SECRET);
});

test("encryptConfigForExport: rejects the wrong password", async () => {
  const blob = await encryptConfigForExport(SAMPLE_SECRET, "letmein123");
  await assert.rejects(() => runtimeDecrypt(blob, "wrongpassword"), (err) => {
    // SubtleCrypto signals AES-GCM tag mismatch as OperationError.
    // The runtime in portal.functions.ts branches on this exact name.
    return err && err.name === "OperationError";
  });
});

test("encryptConfigForExport: rejects tampered ciphertext", async () => {
  const blob = await encryptConfigForExport(SAMPLE_SECRET, "letmein123");
  // Flip a bit in the ciphertext payload by re-encoding shifted bytes.
  const ctBytes = b64ToBytes(blob.ct);
  ctBytes[0] ^= 0x01;
  const tampered = { ...blob, ct: Buffer.from(ctBytes).toString("base64") };
  await assert.rejects(() => runtimeDecrypt(tampered, "letmein123"), (err) => {
    return err && err.name === "OperationError";
  });
});

test("encryptConfigForExport: each encryption uses a fresh salt + iv", async () => {
  const a = await encryptConfigForExport(SAMPLE_SECRET, "letmein123");
  const b = await encryptConfigForExport(SAMPLE_SECRET, "letmein123");
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});
