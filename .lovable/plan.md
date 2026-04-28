# Property Intelligence: Multi-Doc + Fact Editor + Retrain

## Goals

1. **Sequential multi-doc training**: Let the client add multiple sources (file or URL) per property, one at a time. Each adds to existing extractions instead of replacing them.
2. **Capacity gating**: Track cumulative source size per property. When the cap is reached, disable upload + URL inputs with an inline "maximum data reached" message.
3. **Fact inspection & manual edits**: After training, expose the generated facts (`fields`) in the Builder so the client can review, edit values, add new facts, or delete entries — all decoupled from the live index.
4. **Explicit retrain**: A clear "Retrain AI" button persists fact edits and re-runs embedding + canonical-Q&A enrichment so the live index reflects the updated facts.

## Capacity Decision (10 MB vs 5 MB)

Current per-file cap is **5 MB** (PDF/audio) and **2 MB** (image), enforced in three lockstep places: `src/lib/limits.ts`, `supabase/functions/_shared/upload-limits.ts`, and the parity test `tests/upload-limits-parity.test.mjs`.

The extraction pipeline (`extract-property-doc`) handles PDFs in-memory with `pdfjs_heuristic` and chunks the text — there is no architectural reason 10 MB would break it, and the current Worker runtime supports it comfortably.

**Decision**: Raise the **per-document** cap for `pdf_bytes` from 5 MB → **10 MB**. Image and audio caps stay as-is (they don't apply to property intelligence). Cumulative budget per property is **30 MB** (≈3 large docs) — generous enough for the "multiple sources" use case, low enough to keep extraction latency sane. URLs count as 0 toward cumulative (they're fetched server-side; no upload).

## Files in the Execution Path

**Trace**: User clicks "Train Again" → `AiTrainingWizard` (one source) → `TrainingStep` runs pipeline → calls `extract-property-doc` or `extract-url-content` → writes a `property_extractions` row → `IndexingProvider.requestForce` → `extraction-hydrator` builds `canonical_qas` from `fields` and embeds chunks → `PropertyIntelligenceSection` re-renders rows.

Files to touch:

| File | Change |
|------|--------|
| `src/lib/limits.ts` | `pdf_bytes: 10 * MB`. Add `PROPERTY_INTEL_TOTAL_BYTES = 30 * MB` constant + helper `remainingPropertyBudget(used)`. |
| `supabase/functions/_shared/upload-limits.ts` | Mirror `pdf_bytes: 10 * MB` (parity test enforces lockstep). |
| `tests/upload-limits-parity.test.mjs` | Update boundary cases from 5 MB → 10 MB. |
| `src/components/portal/PropertyIntelligenceSection.tsx` | Compute cumulative bytes per property from `extractions` + `vault_assets.file_size_bytes`. Pass `remainingBudget` into `AiTrainingWizard`. Add a "Review & Edit Facts" button that opens the new `FactEditorDialog`. |
| `src/components/portal/ai-training-wizard/AiTrainingWizard.tsx` | Accept `remainingBudget` prop, thread to `SourceStep`. Wizard label/CTA unchanged ("Set Up" vs "Train Again") — adding a doc is just running the wizard again. |
| `src/components/portal/ai-training-wizard/steps/SourceStep.tsx` | Accept `remainingBudget`. If `≤ 0`, render a disabled state ("Maximum data reached — remove or shrink an existing document to add another"). Otherwise validate uploaded file against `min(pdf_bytes, remainingBudget)` and show "X MB remaining" hint. URL field stays enabled regardless. |
| `src/hooks/usePropertyExtractions.ts` | Add `updateFields(extractionId, nextFields)` that writes `fields` then calls `indexing.requestForce(propertyUuid)` to rebuild `canonical_qas` + embeddings. |
| `src/components/portal/PropertyFactEditor.tsx` *(new)* | Modal that loads merged `fields` across all extractions for the property, lets the user add/edit/delete entries, and on Save persists per-source updates + triggers retrain. |
| `src/lib/rag/extraction-hydrator.ts` | Already rebuilds `canonical_qas` from `fields` on each run — no logic change needed. Confirm `requestForce` path is invoked after a fact-edit save. |

No edge-function code changes beyond the size-limit constant, no DB migrations, no RLS changes (providers already have `ALL` on their own `property_extractions`).

## Detailed Design

### 1. Cumulative-size tracking

In `PropertyIntelligenceSection`'s `ModelRow`:

```ts
// Sum file_size_bytes for vault_assets referenced by this property's extractions.
// Already loading these via the trackedAssets effect — extend the select to
// include file_size_bytes, then memoize:
const usedBytes = useMemo(
  () => mergedAssets.reduce((sum, a) => sum + (a.file_size_bytes ?? 0), 0),
  [mergedAssets],
);
const remainingBudget = Math.max(0, PROPERTY_INTEL_TOTAL_BYTES - usedBytes);
```

Render under the doc list: `Used: 4.2 MB of 30 MB · 25.8 MB available`.

### 2. Source-step gating

`SourceStep` receives `remainingBudget`. The dropzone/file input is disabled when `remainingBudget === 0`. File-size validation uses `Math.min(UPLOAD_LIMITS.pdf_bytes, remainingBudget)` so a user with 3 MB left can't upload an 8 MB PDF that would push over the cap. Toast copy: `"Maximum data reached for this property (30 MB). Remove a document to free space."` URL input is unaffected.

### 3. Fact editor

A new `PropertyFactEditor` dialog opened from a "Review & Edit Facts" button on each property row (visible once at least one extraction is `ready` or `context_only`).

UI:

```
┌─────────────────────────────────────────┐
│ Facts for "Marriott Downtown"           │
│ Source: Brochure.pdf ▼                  │
├─────────────────────────────────────────┤
│ price                $4,200/mo    [✎][✕]│
│ bedrooms             3            [✎][✕]│
│ pool                 Yes          [✎][✕]│
│ ...                                     │
│ + Add a fact                            │
├─────────────────────────────────────────┤
│ Edits stay local until you retrain.     │
│        [Cancel]  [Save & Retrain AI]    │
└─────────────────────────────────────────┘
```

- Source dropdown lets the user pick which `property_extractions` row to edit (one row per uploaded doc/URL).
- Edits live in local React state only.
- "Save & Retrain AI" → for each modified row: `supabase.from('property_extractions').update({ fields: nextFields }).eq('id', id)` → then `indexing.requestForce(propertyUuid)`.
- The hydrator's existing logic deterministically regenerates `canonical_qas` from `fields` and re-embeds chunks, so the live RAG index picks up edits without touching extractor code.

### 4. Decoupling edits from live index

Edits are pure local state until the user clicks Save. The `IndexingStatusBadge` continues to show the previously-trained state during editing. Only on Save does the row transition to `indexing` again.

## State / Data Flow

```text
User adds doc #2 ──► SourceStep validates ≤ min(10MB, remainingBudget)
                  └► TrainingStep runs pipeline ──► new property_extractions row
                                                  └► requestForce ──► canonical_qas rebuilt
                                                                       (across ALL rows for property)

User edits fact ──► local state in FactEditor
                 └► Save ──► UPDATE property_extractions.fields
                          └► requestForce ──► canonical_qas + embeddings refreshed
```

## What we explicitly do NOT change

- Existing single-doc upload flow (the wizard) keeps working unchanged.
- No edge function rewrites.
- No changes to the published `.html` runtime or RAG search algorithm.
- No DB schema migrations — all needed columns (`fields`, `canonical_qas`, `file_size_bytes`) already exist.
- Image/audio caps stay at 2 MB / 5 MB.

## Risks & mitigations

- **Embedding worker capacity for 10 MB PDFs**: Already chunked server-side; chunk count grows linearly. The 90s `JOB_TIMEOUT_MS` in `IndexingProvider` already covers this; if a 30 MB property ever exceeds it, the existing force-resolve fallback re-checks the DB and finalizes.
- **Stale `vault_assets.file_size_bytes`**: URL-sourced rows have `file_size_bytes = null` → counted as 0 (correct: URLs aren't user uploads).
- **Partial save failure mid-batch in fact editor**: Save iterates per-row and surfaces the first error via toast; successful rows stay saved. Retrain runs only if at least one save succeeded.

Awaiting approval to implement.