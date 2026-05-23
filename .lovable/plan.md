## Problem

The new `buildMattertagDeepLink` helper added for the sweep-based deep-link (Option A) emits a broken regex into the generated standalone HTML. The quality checker correctly refuses to write the file:

> Inline `<script>` #7 failed to parse: Invalid regular expression: `/?&/g`: Nothing to repeat

## Root cause

`src/lib/portal.functions.ts` line 3175:

```js
stripped=stripped.replace(/\?&/g,"?").replace(/[?&]$/,"");
```

This line lives inside a template literal that is concatenated into the inline runtime `<script>` of the generated HTML. Inside that template literal, backslashes that need to survive into the emitted JS must be doubled. Today it ships a single `\?`, which collapses to a bare `?` in the runtime — producing the invalid `/?&/g` regex.

The sibling helper at line 5710 already handles this correctly with `\\?&`. Only the new helper was missed.

## Fix

One-character edit, no behavioral change to the runtime logic:

```js
stripped=stripped.replace(/\\?&/g,"?").replace(/[?&]$/,"");
```

The second regex (`/[?&]$/`) does not need escaping because `?` inside a character class is a literal.

## Validation

1. Re-run the export; the "Inline scripts parse" quality check should pass.
2. Spot-check the emitted runtime: search the downloaded HTML for `replace(/\?&/g,"?")` — must appear twice (the two helpers), not as `replace(/?&/g,...)`.
3. Click "Jump to view" on a Mattertag in the exported file to confirm the sweep deep-link still teleports cleanly.

## Files touched

- `src/lib/portal.functions.ts` — single line edit at ~line 3175.

No type changes, no schema changes, no migration, no edge-function redeploy.
