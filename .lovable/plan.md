## Root Cause

The Gemini API connection is **healthy** — the issue is not an outage or a bad key.

Edge function logs from `induce-schema` show two consecutive failures on Turn 2 (`architect_refine`), both with the same signature:

```
[architect_refine] failed Unterminated string in JSON at position 234 (line 10 column 42)
[architect_refine] failed Expected double-quoted property name in JSON at position 192 (line 9 column 24)
```

What is happening:
1. Turn 1 (`architect_draft`) succeeds (HTTP 200, 20–22 candidate items returned).
2. The user keeps **20 of 20 fields** (visible in the screenshot).
3. Turn 2 sends those 20 fields back to Gemini and asks for a strict JSON Schema with descriptions and `required[]`.
4. The response gets cut off mid-string because `maxOutputTokens: 2000` is **too small** for 20+ properties (each needs `{type, description}`) plus the canonical-key merge overhead. The model emits a truncated JSON blob, `JSON.parse` throws, and the function returns **502** to the browser — which is what Chrome surfaces as "Edge Function returned a non-2xx status code".

So the user-visible error is real, but it is a **token-budget / response-robustness bug**, not a Gemini connectivity problem.

## The Fix

Three small, safe changes in `supabase/functions/induce-schema/index.ts`:

### 1. Raise the output-token budget for Turn 2

Bump `maxOutputTokens` for `runArchitectRefine` from **2000 → 8000**. Gemini 2.5 Flash-Lite supports up to 8K output tokens; the refine call is rare (authoring-time only, not a hot path) so cost is negligible. This alone would have prevented today's failure.

### 2. Add a JSON-repair fallback before parsing

Wrap the `JSON.parse(stripFences(text))` call in `runArchitectRefine` with a tolerant repair pass that:
- Trims to the last balanced `}`.
- Closes any unterminated string literal at end-of-buffer.
- Strips trailing commas.

If repair succeeds, parse and continue; if it still fails, fall through to the existing `throw`. This makes the function resilient to occasional model truncation even if the budget is exceeded again.

### 3. Add a deterministic last-resort schema synthesizer

If both the raw parse and the repair attempt fail, synthesize a valid Draft-07 schema directly from the user's `keptItems` (every kept field becomes `{ type: "string", description: <desc or title> }`, with the first 3 fields as `required`), then run the canonical-key merge. The MSP still gets a working mapper named after their property class — they never see a 502 — and they can refine field types in the JSON editor afterward. We log a `[architect_refine] used_fallback_synthesis` warning so we can monitor frequency.

### Why these three together

- (1) eliminates the **current** failure mode for ≤40-field schemas.
- (2) handles transient model truncation without losing the LLM's type/description choices.
- (3) guarantees the **"Finalize Schema" button never throws a 502 to the MSP** even under worst-case model misbehavior — preserving the user's workflow.

No client-side changes, no schema/database changes, no new secrets. The existing `LOVABLE_API_KEY` / `GEMINI_PRIMARY_MODEL` plumbing stays exactly as-is.

## Files Modified

- **`supabase/functions/induce-schema/index.ts`**
  - Increase `maxOutputTokens` in `runArchitectRefine` to 8000.
  - Add a `tryRepairJson(text)` helper.
  - Add a `synthesizeFallbackSchema(keptItems)` helper.
  - Update the parse path in `runArchitectRefine` to: parse → repair → synthesize, in that order.

## Verification Plan

After deploy:
1. Reproduce the original flow ("Event Space" / 20 fields) and confirm Finalize succeeds.
2. Check `induce-schema` logs for `[architect_refine] usage` instead of `failed`.
3. Confirm the resulting mapper applies cleanly to the editor.
