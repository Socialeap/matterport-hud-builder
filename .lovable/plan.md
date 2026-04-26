# Fix: "Train Your AI Chat Assistant" wizard fails after PDF upload

## What's actually happening (root cause)

I traced the failing run for property "Chaska Commons Coworking" using DB inspection:

1. **Two PDF uploads succeeded** (vault_assets rows + storage objects exist for provider `891e4f9e…`).
2. **No `coworking_brochure` template was created** in `vault_templates` for that provider — even though the wizard reached the "extracting" phase, which means `resolveProfileTemplate()` returned a `templateId`.
3. **`extract-property-doc` returned HTTP 404.** That status only comes from two paths in the function: `asset_not_found` (line 112) or `template_not_found` (line 145). Since the asset clearly exists, the failure is **`template_not_found`** — the `templateId` returned by the wizard does not match any `vault_templates` row whose `provider_id` equals the asset's `provider_id`.
4. **`induce-schema` returned 422** ahead of that. Likely `empty_pdf_text` (image-heavy brochure with no extractable text via `unpdf` — there is no OCR fallback). The wizard catches this and continues, which is correct. But it masks a strong signal that the same PDF will likely fail downstream too.

The wizard then displays the generic "Training stopped during extraction" message because `extract()` returned `null` and the friendly-error mapper has no insight into _why_.

### Why the template silently disappears

`resolveProfileTemplate()` (in `profiles.ts`) does an INSERT on `vault_templates` and reads back `data.id`. The hook `useAvailableTemplates` is queried with the **stale closure value** of `templates` at effect time, so on a "Try Again" retry it can re-clone, mis-match, or swap to a wrong template id between renders. Combined with three other defects:

- `effectiveTemplateId` can be set to an `is_active = false` "override" template the extract function _can_ still find (since extract doesn't filter by `is_active`), but RLS for clients reading templates filters on `is_active` — so on subsequent client visits the row appears to vanish.
- `induceSchema` 422 is silently swallowed; users get no feedback that their PDF is image-only.
- The friendly-error mapper never surfaces `template`/`asset` stages — it always falls through to the generic copy.

## The fix (4 surgical changes, no schema migrations)

### 1. Make template resolution authoritative (server-truth, not client cache)

Rewrite `resolveProfileTemplate()` to:
- Query `vault_templates` directly by `(provider_id, doc_kind, is_active=true)` instead of trusting the React `templates` cache. This eliminates the stale-closure race entirely.
- After insert, immediately re-`select` the row by id to confirm it persisted (catches any silent RLS or trigger rollback).
- Throw a precise, localized error if the verification select returns nothing: `"Couldn't save the {Profile} profile. Try again — if it keeps happening, contact support."` Include the attempted provider_id in `console.error` for debug.

### 2. Stop creating "hidden" override templates

In `TrainingStep.tsx`, replace the `createOverrideTemplate({ is_active: false })` flow with an **in-memory schema merge passed only via the extraction call's metadata** — but since `extract-property-doc` doesn't accept ad-hoc schemas, the simpler fix is:

- **If induce returns extra fields, UPDATE the resolved profile template's `field_schema`** in place (additive merge — never remove existing keys). The profile template is the provider's clone, so this is safe.
- This guarantees `effectiveTemplateId === templateId` (no orphaned hidden rows, no `is_active=false` mismatch surface).

### 3. Surface real extraction errors instead of generic "Training stopped"

Update `friendly-errors.ts` and `TrainingStep.tsx`:
- When `extract()` returns null, read `failuresByAsset[vaultAssetId]` from the `usePropertyExtractions` hook to get the actual `{ stage, detail, status }`.
- Map known stages to user copy:
  - `template`/`asset` 404 → "We couldn't connect your document to the chosen profile. Try selecting the profile again."
  - `download` → "We couldn't open the uploaded file. Try uploading it again."
  - `extraction` → "This document couldn't be read automatically. Try a text-based PDF (not a scanned image)."
  - `groq`/`embed` → "The AI was busy. Please try again in a moment."
- Pass that mapped string to `onPhaseChange("error", copy)` so the user sees specific, actionable guidance.

### 4. Warn (don't fail) when induce-schema returns 422 on image-only PDFs

In the same step, detect the `empty_pdf_text` 422 specifically and:
- Show an inline notice in the success path: *"Your PDF appears to be image-only — extraction will use the standard profile fields."*
- Still proceed with extraction (current behavior), but keep the user informed.

### 5. Drive-by: fix the unrelated TS build break

`src/lib/portal.functions.ts` lines 331/335 have a TS2352 error introduced in the previous refactor (chunk type cast missing required `kind`/`source` fields). Patch by mapping over the chunks and supplying defaults (`kind: "raw_chunk"`, `source: "pdf"`) before the cast — these are the same defaults the runtime already assumes elsewhere.

## Files touched

- `src/components/portal/ai-training-wizard/profiles.ts` — authoritative resolution + post-insert verification.
- `src/components/portal/ai-training-wizard/steps/TrainingStep.tsx` — drop hidden-override path, additive in-place schema update, wire failure copy through, surface 422 inline notice.
- `src/components/portal/ai-training-wizard/friendly-errors.ts` — new stage→copy map.
- `src/lib/extraction/induce.ts` — return a typed `{ kind: "empty_pdf_text" | "no_fields" | "other" }` discriminator on failure so the wizard can branch cleanly.
- `src/lib/portal.functions.ts` — fix TS2352 chunk cast.

## Ripple-effect check

- **Other callers of `resolveProfileTemplate`**: only `TrainingStep.tsx` uses it. Safe.
- **`useAvailableTemplates` consumers**: untouched — we just stop relying on the cache inside the wizard.
- **`extract-property-doc` contract**: unchanged. We're sending the exact same payload shape; only the source of `template_id` is hardened.
- **Existing "AI Profile: Hospitality" template** (already in DB): now becomes the canonical Hospitality template — additive merges only, never overwrites.
- **`PropertyIntelligenceSection` / `EnhancementsSection`**: read failures via the same hook; the new `failuresByAsset` lookup is read-only.
- **Migration / RLS**: none required. Insert/Update on `vault_templates` already permitted by the existing "Providers manage their templates" policy for providers; clients still cannot reach this code path because step 1 of the wizard's profile clone requires `auth.uid() = provider_id`.

## What this does NOT change

- The visual layout of the wizard (still 4 steps).
- The set of starter templates / profile cards.
- Any database schema, RLS, or edge function source.
- The Verify step or the embedded chat.

After this lands, the user retrying the same PDF will see _either_ a successful extraction (most likely — the underlying pipeline works for non-image PDFs) or a clear, specific error pointing at the real problem (image-only PDF, profile mismatch, etc.) instead of the opaque "Training stopped during extraction".
