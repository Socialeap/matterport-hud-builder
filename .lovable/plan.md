# Why the coworking PDF training failed

The console actually shows **two distinct, unrelated failures** stacked on top of each other. One is fatal (kills the run), one is cosmetic (gets swallowed but logged as scary text):

## 1. Fatal — missing database column `intelligence_health` (causes the 400)

```
property_extractions?select=…intelligence_health… 400
[indexing] failed: column property_extractions.intelligence_health does not exist
```

A previous refactor introduced a new "intelligence health" envelope that the extraction edge functions write back to `property_extractions.intelligence_health`. The TypeScript types (`src/integrations/supabase/types.ts`) and a migration file (`supabase/migrations/20260427000000_intelligence_health.sql`) were added, **but the migration was never applied to the live database**. Verified with `information_schema`:

```
property_extractions columns:
id, vault_asset_id, template_id, saved_model_id, property_uuid,
fields, chunks, embedding, extracted_at, extractor, extractor_version,
canonical_qas, candidate_fields, field_provenance
                                                ^ no intelligence_health
```

Every read site that asks for that column (`src/lib/rag/extraction-hydrator.ts`, `src/lib/rag/indexing-context.tsx`, `src/hooks/usePropertyExtractions.ts`, the `synthesize-answer` edge function, etc.) fails with PostgREST 400, which then trips `ensureExtractionEmbeddings → indexing failed`, which is what the user saw as the actual training failure.

## 2. Non-fatal — induce-schema returned malformed JSON (the 422)

```
induce-schema 422
[ai-wizard] induce-schema skipped: schema_parse_failed:
  Expected double-quoted property name in JSON at position 208 (line 9 column 24)
```

This is the optional "auto-detect extra fields from your PDF" pass. It is wrapped in a try/catch in `TrainingStep.tsx` and is allowed to fail silently — it does NOT stop training. But the parser is brittle: the PDF mode in `supabase/functions/induce-schema/index.ts` (lines 776–794) does a single strict `JSON.parse(stripFences(text))` and bails on any malformed token. The same file already contains a 3-tier resilient parser (`tryRepairJson` + fallback) used by the `architect_refine` path; the PDF path just doesn't call it.

So even though the user *also* saw the 422, the actual training would have completed if the database column existed. Fixing #1 unblocks the run; fixing #2 makes the optional auto-detect work so the AI gets the bonus property-specific fields the schema upgrade was designed to capture.

---

# Fix plan

## A. Apply the missing migration (root cause of the failure)

Create a new migration that adds the column, exactly mirroring the pending-but-unapplied `20260427000000_intelligence_health.sql`:

```sql
ALTER TABLE public.property_extractions
  ADD COLUMN IF NOT EXISTS intelligence_health jsonb;

CREATE INDEX IF NOT EXISTS property_extractions_health_status_idx
  ON public.property_extractions ((intelligence_health->>'status'));

COMMENT ON COLUMN public.property_extractions.intelligence_health IS
  'Computed by edge extraction functions. Status: ready | degraded | failed | context_only_degraded.';
```

`IF NOT EXISTS` makes it safe regardless of whether the older migration ever partially ran. Existing rows get `null`, which the read path already treats as "needs re-training" (verified in `extraction-hydrator.ts` and `indexing-context.tsx`). No backfill needed — the next extraction run on each property will populate it.

## B. Harden the PDF branch of `induce-schema`

In `supabase/functions/induce-schema/index.ts`, replace the strict `JSON.parse` in the PDF flow (around line 786) with the same 3-tier resilience used by `parseRefineResponse`:

1. **Tier 1**: `JSON.parse(stripFences(text))` (current behaviour).
2. **Tier 2**: on failure, run `tryRepairJson(text)` — already defined in the file at line 386.
3. **Tier 3**: if both fail AND we still have a valid `text_preview`, return `{ error: "schema_parse_failed", detail }` 422 as today (so the wizard's existing silent-skip path still fires). No new failure mode.

This is a non-breaking, additive change: success cases are unchanged, marginal Gemini outputs (trailing commas, unterminated strings, extra prose) now succeed, and hard failures still surface with the same error code the client already handles.

## C. (Optional, very small) Slightly nicer wizard notice on parse_failed

`TrainingStep.tsx` only sets a friendly `induceNotice` when `err.kind === "empty_pdf_text"`. Add one more branch so a `parse_failed` also produces a one-line amber note ("Couldn't auto-detect extra fields from this PDF — using standard profile fields.") instead of being completely silent. Pure UX polish — doesn't change pipeline behaviour.

---

# Ripple-check

- **`synthesize-answer`, `extract-property-doc`, `extract-url-content` edge functions**: all already write/read `intelligence_health`. They are correct against the *types* but were silently failing against the *database*. Once the column exists, they start writing on the next extraction; reads fall back to `null` for legacy rows, which is the documented behaviour.
- **`usePropertyExtractions`, `extraction-hydrator`, `indexing-context`**: all already coerce `intelligence_health` through `parseIntelligenceHealth`, which accepts `null/undefined` and returns `null`. No client changes needed.
- **`PropertyIntelligenceSection.tsx` line 389** explicitly handles "Legacy row without intelligence_health: treat as pending until …". Confirms the null-tolerance contract.
- **`induce-schema` other modes** (`architect_draft`, `architect_refine`, `mock_prompt`) untouched — only the PDF branch hardens.
- **No RLS changes**: the column is added to a table whose RLS policies don't reference column lists.
- **No types regeneration needed**: `src/integrations/supabase/types.ts` already declares the column (it's auto-regenerated and is currently *ahead* of the live schema, which is why TS compiled cleanly while runtime queries failed).

---

# Files to change

- **NEW** `supabase/migrations/<new-timestamp>_intelligence_health.sql` — adds the column + index + comment.
- **EDIT** `supabase/functions/induce-schema/index.ts` — replace the single `JSON.parse` in the PDF branch (~line 786) with the existing 3-tier `tryRepairJson` fallback.
- **EDIT** `src/components/portal/ai-training-wizard/steps/TrainingStep.tsx` — add a `parse_failed` branch to the induce-schema catch (one line of `setInduceNotice(...)`).

After approval I'll apply the migration, redeploy `induce-schema`, and verify by re-running the coworking PDF flow.
