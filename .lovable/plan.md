

## Property-doc upload entrypoint in the Builder

### What's actually there today (so we don't regress it)

The Builder already has a working extraction pipeline:

```text
[Upload Doc dialog] → uploadVaultAsset() → vault_assets row →
extract-property-doc edge fn → property_extractions row →
ensureExtractionEmbeddings (chunks + canonical Q&As) → Ask panel
```

The dialog lives **inside** `PropertyDocsPanel`, which is rendered **per-property** inside the Property Models accordion. It's gated behind `lusActive && !isFrozen && user && templates.length > 0` and only accepts `application/pdf`.

So the user's complaint is real for two concrete reasons:
1. The upload button is **buried** inside a per-property panel inside a closed accordion — visually invisible.
2. It **disappears entirely** when the client has no active templates (the common case for a walk-in client).
3. It **rejects DOC/TXT/RTF** even though those are easier to parse than PDFs.

The fix is targeted: surface the upload entrypoint, broaden accepted formats, and ensure the extractor can handle the new formats — without re-plumbing the extraction pipeline that already works.

### Plan

#### 1. New surface — promote upload to a first-class Builder section

Add a fourth Accordion item in `HudBuilderSandbox.tsx` titled **Property Intelligence (Ask AI)** with a `BookOpen` icon, sibling to Branding / Property Models / Agent. Closed by default like the others. Inside it: a new `PropertyIntelligenceSection` that lists every property model's docs in one place (one row per `models[i]`) with an inline "Upload Doc" button and live extraction status. This solves the visibility problem without tearing out the per-property `PropertyDocsPanel` (which still ships embedded inside Property Models for power users).

**File to add:** `src/components/portal/PropertyIntelligenceSection.tsx`

The section uses the **same hooks the existing panel uses** — `usePropertyExtractions`, `useAvailableTemplates`, `useAvailablePropertyDocs`, `useLusFreeze`, `useLusLicense` — so behaviour is identical and there's no new state machine.

#### 2. Auto-template fallback — never block on "no template"

The current dialog requires a pre-published `vault_templates` row. Walk-in clients don't have one. Add a second code path: if `templates.length === 0`, the section's CTA reads **"Upload & Auto-Detect"** and calls `induceSchema(file)` first, then writes a per-provider hidden template row (`is_active: true`, `label: "Auto: <filename>"`, `extractor: "pdfjs_heuristic"`), then runs extraction against it. The existing `induce-schema` edge function already exists and returns a sanitised JSON Schema — we just wire it in. Providers with curated templates are unaffected (they keep the picker UI).

For **non-PDF** uploads (TXT/RTF/DOCX), induction is skipped and we use a synthetic minimal template (`{ properties: {}, required: [] }`) — extraction still produces text chunks, which is what feeds the Ask panel's vector search.

#### 3. Broader file-format support — PDF, TXT, RTF, DOCX

Update both client-side accept filter and the server-side extractor.

**Client (`<input accept>`):**

```text
.pdf,.txt,.rtf,.doc,.docx,
application/pdf,text/plain,text/rtf,application/rtf,
application/msword,
application/vnd.openxmlformats-officedocument.wordprocessingml.document
```

**Server (`supabase/functions/_shared/extractors/pdfjs-heuristic.ts`):**

Branch on the asset's `mime_type` (already stored on `vault_assets`):

| MIME / extension | Reader |
|---|---|
| `application/pdf` | unpdf (existing) |
| `text/plain` | `new TextDecoder().decode(bytes)` |
| `text/rtf`, `application/rtf` | strip RTF control words via small regex pass, then decode |
| `application/msword` (`.doc`) | not safe to parse server-side without a Deno-compatible converter — return a clear `unsupported_legacy_doc` error and ask the user to save as `.docx` or `.pdf` |
| `application/vnd.openxmlformats-...wordprocessingml.document` (`.docx`) | unzip via `https://esm.sh/fflate@0.8.2`, read `word/document.xml`, strip tags |

The extractor signature stays the same; only the text-extraction step branches. Field coercion + chunking are reused as-is.

To pass MIME through, the extract-property-doc edge function already has `asset.mime_type` after step 2; we extend the `extract({ bytes, template })` call to `extract({ bytes, template, mimeType })` and add `mimeType?: string` to `ExtractionProvider.extract`'s input shape (both the Deno-side `_shared/extractors/types.ts` and the client mirror in `src/lib/extraction/provider.ts` — kept in lock-step as the existing comment in those files mandates).

#### 4. Pre-existing build error — fix as part of the same diff

The build is currently red on:

```text
TS2339: Property 'stripe_connect_id' does not exist on type 'GenericStringError'.
  supabase/functions/create-connect-checkout/index.ts:129
```

Root cause: the `.select(string)` call uses **string concatenation across three lines**, which trips Supabase JS v2's TS inference and resolves the row type to the error union instead of the expected row shape.

```ts
.select(
  "stripe_connect_id, stripe_onboarding_complete, brand_name, " +
  "use_flat_pricing, flat_price_per_model_cents, " +
  "base_price_cents, tier3_price_cents, additional_model_fee_cents"
)
```

Fix: collapse to a single string literal so the inference path picks the row shape:

```ts
.select("stripe_connect_id, stripe_onboarding_complete, brand_name, use_flat_pricing, flat_price_per_model_cents, base_price_cents, tier3_price_cents, additional_model_fee_cents")
```

Zero behaviour change. The whole edge-function suite typechecks again, unblocking deploy of the new flow.

#### 5. Make the new section behave correctly per-tab (no leaks)

`usePropertyExtractions` re-keys on `propertyUuid` (via `model.id`). The new section iterates `models.map(...)` and renders one collapsible row per model, each with its own `usePropertyExtractions(model.id)` instance — same isolation contract as the existing `PropertyDocsPanel`. No global cache, no cross-property leak.

The Ask panel in the generated HTML re-indexes on tab change (already in place from the prior merge work) — nothing to change there.

### Files touched

- **add** `src/components/portal/PropertyIntelligenceSection.tsx` — the new accordion section
- **edit** `src/components/portal/HudBuilderSandbox.tsx` — add the 4th `AccordionItem`
- **edit** `src/lib/extraction/provider.ts` — add `mimeType?: string` to the provider input
- **edit** `supabase/functions/_shared/extractors/types.ts` — same shape (mirror)
- **edit** `supabase/functions/_shared/extractors/pdfjs-heuristic.ts` — MIME branching for TXT / RTF / DOCX
- **edit** `supabase/functions/extract-property-doc/index.ts` — pass `asset.mime_type` to the provider
- **edit** `supabase/functions/create-connect-checkout/index.ts` — collapse the multi-line `.select(...)` literal (build-error fix)

### What this plan deliberately does NOT do

- **No DB migration.** `vault_assets`, `vault_templates`, `property_extractions`, and `lus_freezes` already model everything we need.
- **No change to the Ask panel runtime** in `portal.functions.ts`. The generator already consumes whatever `property_extractions` rows exist. Adding more rows simply makes Ask smarter.
- **No removal** of the in-`PropertyDocsPanel` upload button. Power users keep it; the new section is additive.
- **No DOC (legacy `.doc`) parsing.** Deno has no safe path to read `.doc` binary in a Worker; we return a clear, single-sentence error and accept `.docx` / PDF / TXT / RTF only. Communicated in the dialog hint text.

### Verification checklist

1. Walk-in client with **no templates and no docs** opens the Builder → sees the new "Property Intelligence (Ask AI)" accordion → uploads a PDF → "Upload & Auto-Detect" runs `induce-schema`, writes a hidden template, runs extraction, shows the resulting field list inline.
2. Same client uploads a `.txt` and a `.docx` → extraction runs (auto-template path), chunks are written, no errors.
3. Same client uploads a legacy `.doc` → friendly error, not a crash.
4. Existing provider with curated templates → upload dialog still offers the template picker (no regression).
5. After upload, generate the Presentation HTML, open it, ask the unified **Ask** button a question covered by the doc → answer surfaces from the new chunks.
6. `npm run build` (or the equivalent Deno typecheck) passes — the `create-connect-checkout` `TS2339` errors are gone.
7. LUS-frozen property still blocks new uploads in the new section (same gate as existing panel) and shows the "Frozen" badge.
8. LUS license inactive → new section hides upload UI but still shows existing extractions read-only, matching the existing panel's contract.

