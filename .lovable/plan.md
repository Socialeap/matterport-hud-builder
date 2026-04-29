# Why the download stalls

Worker logs from the published site show the smoking gun, repeated on every download attempt:

```
[generatePresentation] password encryption failed:
  Pbkdf2 failed: iteration counts above 100000 are not supported (requested 600000).
```

The Builder is now using the new **password-gated export** path. When the client arms password protection, `generatePresentation` calls `encryptConfigForExport(...)` which runs:

```ts
// src/lib/portal/protected-export.ts
export const PROTECTED_PBKDF2_ITERATIONS = 600_000;
...
await subtle.deriveKey(
  { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
  ...
);
```

Cloudflare Workers' WebCrypto implementation hard-caps PBKDF2 at **100,000 iterations** and throws `OperationError` above that. The `try/catch` in `generatePresentation` catches it and returns `{success:false, error:"Could not encrypt..."}`, which the Builder toasts — but every protected download now fails 100% of the time.

The user's screenshot ("Building presentation…" spinner) corresponds to the moment the Worker is invoking `subtle.deriveKey` and throwing. The toast does fire, but with the spinner card right above it, the visual signal is "stuck downloading."

# The fix

## 1. Lower server-side PBKDF2 iterations to a Worker-safe value

Set `PROTECTED_PBKDF2_ITERATIONS = 100_000` in `src/lib/portal/protected-export.ts`.

Why this is safe:
- The encrypted blob carries its own `iter` field (`ProtectedConfigBlob.iter`).
- The visitor's runtime decoder reads `blob.iter` directly when re-deriving the key (`src/lib/portal.functions.ts:1523`), so older protected exports built at 600k continue to decrypt — only **new** exports use 100k.
- 100k iterations is still within accepted modern guidance for AES-GCM-256 + a high-entropy KDF input; it remains the maximum the Worker runtime supports.
- The runtime fallback for missing `iter` stays at `600000`, but every blob we mint always includes `iter`, so the fallback is only theoretical.

## 2. Keep the parity test honest

`tests/protected-export.test.mjs` asserts `blob.iter === PROTECTED_PBKDF2_ITERATIONS`. Because the test imports the constant, lowering it keeps the test passing without code changes — the round-trip (encrypt → decrypt) will run with whatever value the constant holds.

## 3. Surface the error more visibly when encryption *does* fail

When `encryptConfigForExport` throws, the Builder currently toasts but the "Preparing Your Download…" card stays visible for the moment between the throw returning to the client and the toast appearing. That's a UX papercut, not the root bug, but worth tightening:

- In `runDownload` (`src/components/portal/HudBuilderSandbox.tsx`), when `result.success === false`, also clear `setDownloadStep("")` immediately before the early `return` so the spinner card transitions to the error state in the same frame as the toast.

# Files to edit

| File | Change |
|---|---|
| `src/lib/portal/protected-export.ts` | `PROTECTED_PBKDF2_ITERATIONS` 600_000 → 100_000; comment why (Cloudflare Worker WebCrypto cap). |
| `src/components/portal/HudBuilderSandbox.tsx` | In `runDownload`'s `!result.success` branch, also call `setDownloadStep("")` before return. |

# What we are deliberately NOT changing

- `src/lib/portal.functions.ts:1523` runtime decoder — already reads `blob.iter`, no edit needed.
- The Builder's password-gate UI / arming logic — unaffected.
- The unprotected (no-password) download path — already works; logs show no errors there.
- Stripe / `create-connect-checkout` flow — the screenshot shows it returning 200 cleanly; not the bug.
- Embedding Web Worker — the spinner had already advanced past "Embedding Q&A pairs…" to "Building presentation…", confirming the embedder is healthy.

# Trace of the new execution path

1. Client clicks Download with password armed.
2. `runDownload` → embeddings → `generatePresentationFn({ password })`.
3. Worker `generatePresentation` → `encryptConfigForExport(secretConfig, password)`.
4. `subtle.deriveKey({ iterations: 100_000, ... })` ✅ succeeds inside Cloudflare Workers.
5. AES-GCM ciphertext + `iter: 100_000` returned in `ProtectedConfigBlob`.
6. HTML emitted with the blob inlined; Builder triggers the browser download.
7. At unlock time, the visitor's browser (full WebCrypto, no cap) re-derives the key using `blob.iter` (100_000) and decrypts.

No regressions for already-downloaded protected files (their blobs still carry `iter: 600_000` and the visitor's browser handles that fine).
