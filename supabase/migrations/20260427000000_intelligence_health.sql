-- M1 — Persistent intelligence_health envelope on property_extractions.
--
-- This column is computed by the extraction edge functions on every
-- successful run and read by the Verify step, the AssetStatusRow,
-- the IndexingProvider, the export warning banner, and (eventually)
-- the synthesize-answer entitlement check.
--
-- Shape (enforced in code by `_shared/intelligence-health.ts`):
--   {
--     version, status, field_count, canonical_qa_count, chunk_count,
--     embedded_chunk_count, candidate_field_count, evidence_unit_count,
--     answerability_score, warnings[], blocking_errors[],
--     source_asset_id, property_uuid, saved_model_id, updated_at
--   }
--
-- Status: 'ready' | 'degraded' | 'failed' | 'context_only_degraded'.
-- Backfill is intentionally not run here — existing rows get null and
-- the read path treats null as "needs re-training". A follow-up
-- script can re-evaluate older rows once the edge function ships.

ALTER TABLE public.property_extractions
  ADD COLUMN IF NOT EXISTS intelligence_health jsonb;

CREATE INDEX IF NOT EXISTS property_extractions_health_status_idx
  ON public.property_extractions ((intelligence_health->>'status'));

COMMENT ON COLUMN public.property_extractions.intelligence_health IS
  'Computed by edge extraction functions. See supabase/functions/_shared/intelligence-health.ts. Status values: ready | degraded | failed | context_only_degraded.';
