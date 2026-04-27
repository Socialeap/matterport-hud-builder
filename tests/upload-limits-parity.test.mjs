/**
 * Parity test for the upload-size limits module. The browser and
 * Deno mirrors must report identical decisions for matched inputs.
 *
 * Run via `node --test --experimental-strip-types`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const browserMod = await import("../src/lib/limits.ts");
const denoMod = await import("../supabase/functions/_shared/upload-limits.ts");

test("UPLOAD_LIMITS match", () => {
  assert.deepEqual(browserMod.UPLOAD_LIMITS, denoMod.UPLOAD_LIMITS);
});

const CASES = [
  { kind: "pdf_bytes", size: 0 },
  { kind: "pdf_bytes", size: 4 * 1024 * 1024 },
  { kind: "pdf_bytes", size: 5 * 1024 * 1024 }, // boundary
  { kind: "pdf_bytes", size: 5 * 1024 * 1024 + 1 }, // just over
  { kind: "image_bytes", size: 1.5 * 1024 * 1024 },
  { kind: "image_bytes", size: 2 * 1024 * 1024 + 1 },
  { kind: "audio_bytes", size: 5 * 1024 * 1024 + 100 },
  { kind: "pdf_bytes", size: -100 }, // sanitization edge case
  { kind: "pdf_bytes", size: NaN }, // sanitization edge case
];

test("checkUploadSize parity for all matched cases", () => {
  for (const c of CASES) {
    const a = browserMod.checkUploadSize(c.size, c.kind);
    const b = denoMod.checkUploadSize(c.size, c.kind);
    assert.deepEqual(a, b, `mismatch for case ${JSON.stringify(c)}`);
  }
});

test("uploadKindForMime parity", () => {
  const MIMES = [
    "application/pdf",
    "APPLICATION/PDF",
    "image/png",
    "image/jpeg",
    "audio/mpeg",
    "audio/wav",
    "video/mp4",
    null,
    undefined,
    "",
    "text/plain",
  ];
  for (const m of MIMES) {
    assert.equal(
      browserMod.uploadKindForMime(m),
      denoMod.uploadKindForMime(m),
      `mismatch for mime ${m}`,
    );
  }
});

test("rejection includes deterministic message both sides", () => {
  const a = browserMod.checkUploadSize(10 * 1024 * 1024, "pdf_bytes");
  const b = denoMod.checkUploadSize(10 * 1024 * 1024, "pdf_bytes");
  assert.equal(a.ok, false);
  assert.equal(b.ok, false);
  assert.equal(a.message, b.message);
  assert.match(a.message, /max 5 MB/i);
});
