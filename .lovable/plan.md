I understand why this failed now. The export is being blocked by the new safety guard itself, not by the Google Maps regex anymore.

Root cause: the runtime-lint scanner I added is too naive. It tries to identify JavaScript regex literals using a broad regex over the entire inline `<script>` body. That scanner is incorrectly treating ordinary `// ...` JavaScript comments as the start of regex literals. Because those comments naturally end at a newline, the scanner reports the newline as a “raw control character inside a regex.” The snippets you pasted prove this: every reported offender starts with a comment, e.g. `// Resolve immediately...`, `// Early HUD wiring...`, not an actual regex literal. So the generator is throwing before returning the HTML.

The earlier map regex source line now appears correct in `portal.functions.ts`:

```js
.replace(/[\\r\\n\\t]+/g," ")
```

In the emitted presentation runtime, that becomes the intended JavaScript regex:

```js
.replace(/[\r\n\t]+/g," ")
```

The remaining failure is a false positive in `src/lib/portal/runtime-lint.ts` and the matching client-side repair logic has the same underlying risk.

Plan to fix safely:

1. Replace the broad regex-literal scanner with a small JavaScript-aware scanner
   - Update `src/lib/portal/runtime-lint.ts` so it walks inline script text character-by-character.
   - Explicitly skip:
     - `//` line comments
     - `/* ... */` block comments
     - single-quoted strings
     - double-quoted strings
     - template literals
   - Only consider `/.../flags` when the slash appears in a context where JavaScript can start a regex literal, not after identifiers/numbers/closing brackets where it is likely division or a comment.
   - Detect the real target condition: an actual regex literal containing raw CR/LF/TAB before its closing slash.

2. Fix the client-side “healing” sanitizer to avoid mutating comments or strings
   - Update `src/lib/portal/html-quality-check.ts` so `sanitizeRegexControlChars` uses the same scanner logic rather than a broad regex replacement.
   - This prevents it from accidentally rewriting harmless comments or other JavaScript text during download validation.
   - Keep the markdown auto-link sanitizer and required-token checks unchanged.

3. Keep the server guard, but make its error precise
   - Preserve `assertRuntimeRegexSafety(html)` in `generatePresentation` because the guard is valuable.
   - Change only the implementation so it flags real regex-literal corruption and ignores comments.
   - Improve snippets so future errors identify the actual literal and line without misleading comment output.

4. Add targeted regression coverage
   - Add/extend tests or verification coverage for:
     - `// comments with newlines` should not be flagged.
     - `/* block comments */` should not be flagged.
     - normal safe regex like `/[\r\n\t]+/g` should not be flagged.
     - intentionally corrupted regex with a raw newline inside the literal should be flagged.
     - sanitizer repairs only corrupted regex literals, not comments.
   - This prevents another “fix the guard, break the export” loop.

5. Verify the full generation/download path
   - Confirm `generatePresentation` can assemble HTML without `assertRuntimeRegexSafety` throwing.
   - Confirm the browser-side `runQualityChecks(result.html)` path still parses inline scripts and allows download.
   - Confirm the map-address logic remains intact and still emits the Google Maps embed query with property name/address/location.

Execution path being protected:

```text
Builder Download button
  -> HudBuilderSandbox.handleDownload
  -> generatePresentation server function
  -> portal.functions.ts assembles self-contained HTML
  -> assertRuntimeRegexSafety(html)
  -> returns { success, html }
  -> runQualityChecks(html) in browser
  -> Blob download
```

The change will be deliberately limited to the safety utilities and their tests, avoiding rewrites to the main presentation generator except if a truly unsafe escaped regex is found during verification.