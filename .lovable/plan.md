# Fix: Inline `<script> #7` Parse Failure

## Root Cause (confirmed)

`src/lib/portal.functions.ts` emits the entire visitor-side runtime as one large **JavaScript template literal** (backtick string). Inside a template literal, `\r`, `\n`, and `\t` are interpreted by the **build-time** JS parser as actual CR / LF / TAB characters before the string is ever written to disk.

The Neighborhood Map fix from the previous turn added this line at **line 2418**:

```js
.map(function(s){return (s||"").replace(/[\r\n\t]+/g," ").trim();})
```

After template-literal evaluation, the generated HTML contains a regex literal with **real newline and tab characters inside the slashes** — which is illegal (regex literals must be single-line). Browsers throw `Invalid regular expression: missing /`. The pre-download quality check correctly caught it.

Every other regex in the same file that targets whitespace already uses the correct double-escape, e.g. line 2102:
```js
var subj=String(subject||"Inquiry").replace(/[\\r\\n]+/g," ").trim();
```
The new line was the only outlier.

## Fix

### 1. Escape the regex (one-line correctness fix)

`src/lib/portal.functions.ts` line 2418 — change:
```js
.map(function(s){return (s||"").replace(/[\r\n\t]+/g," ").trim();})
```
to:
```js
.map(function(s){return (s||"").replace(/[\\r\\n\\t]+/g," ").trim();})
```

This emits the literal text `/[\r\n\t]+/g` into the runtime, which the visitor's browser parses correctly.

### 2. Add a permanent guard against the same class of bug

The existing `src/lib/portal/html-quality-check.ts` already runs `new Function(scriptBody)` on every inline script and blocks the download on parse failure — that's exactly why this regression was caught instead of shipping. We will **strengthen** it (no new component needed, just extend what is already wired to the download path):

- **Pre-emit lint**: Add a tiny check in `portal.functions.ts` (or a sibling `portal/runtime-lint.ts`) that scans the assembled runtime string for any regex literal containing a raw `\n`, `\r`, or `\t` character (i.e. the bytes 0x0A/0x0D/0x09 inside a `/.../flags` literal). If found, throw with the offending snippet and line context **before** returning the HTML to the client. This turns the failure mode from "user clicks Download, sees a blocked toast" into "the generation server function logs a precise location" — much easier to debug if it ever recurs.
- **Auto-repair pass (safe subset)**: In `html-quality-check.ts`, after the existing markdown-auto-link sanitizer and **before** the `new Function(...)` parse check, run a narrow repair pass that, *only inside detected `<script>` blocks*, replaces raw control characters (`\n`, `\r`, `\t`) that appear **inside a regex literal** (between unescaped `/` delimiters on the same logical token) with their escaped equivalents (`\\n`, `\\r`, `\\t`). If any repair is applied, record it as a `warning` check (mirrors how the auto-link repair is reported) so the user still gets a successful download but the support team sees the warning. If after repair the script still fails to parse, the existing hard-fail behavior stands.

This gives us defense in depth without changing the pass/fail semantics of a clean build:

```
generator emits runtime
        │
        ▼
runtime-lint (NEW, server-side) ──fail fast──► clear server log + 500
        │ ok
        ▼
HTML returned to browser
        │
        ▼
sanitizeMarkdownAutoLinks (existing)
        │
        ▼
sanitizeRegexControlChars (NEW, client-side, narrow scope) ──► warning if applied
        │
        ▼
new Function(script) parse check (existing) ──fail──► download blocked
        │ ok
        ▼
download proceeds
```

### 3. Documentation note (small, in code)

Add a short comment block above the existing `// ── Modal helpers` section in `portal.functions.ts` reminding future editors that the entire string is a JS template literal, so backslash escapes inside regex / string literals must be **doubled** (`\\n` not `\n`). This is the same gotcha that has bitten this file before.

## Files Touched

- `src/lib/portal.functions.ts` — escape line 2418, add reminder comment, call the new pre-emit lint before returning.
- `src/lib/portal/runtime-lint.ts` (new, ~40 lines) — single exported function `assertRuntimeRegexSafety(html)` used by the generator.
- `src/lib/portal/html-quality-check.ts` — add `sanitizeRegexControlChars` step + a new `QualityCheckResult` entry; integrate into `runQualityChecks` between auto-link sanitize and the inline-script parse check.

## Why not a more aggressive auto-healer?

Generic "try to repair broken JS" is unsafe — it can silently mask real bugs and ship a half-working presentation. The narrow repair above only touches a known, mechanical, fully reversible corruption class (control chars inside regex literals), which mirrors how the existing markdown-auto-link repair works. Anything beyond that stays in the hard-fail path so we never ship a silently-degraded file.

## Verification

After the change, regenerate the same presentation and confirm:
1. Quality-check report shows all green (or a single warning if the auto-repair triggers).
2. Open the downloaded HTML, click the Neighborhood button on each property, confirm the Google Maps embed loads with the enriched query (propertyName + address + location).
3. No console errors in the visitor tab.
