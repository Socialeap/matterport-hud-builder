-- ============================================================
-- Phase 5 — Canonical Q&A cache on property_extractions
--
-- Each extraction row gains a `canonical_qas` JSONB column that
-- stores pre-generated {question, answer, source_anchor_id,
-- embedding} rows derived deterministically from the row's
-- `fields`. These drive the runtime three-tier doc-QA pipeline
-- (tier-1 canonical-question match) without any LLM at view time.
--
-- Per-chunk embeddings live inside the existing `chunks` JSONB —
-- each chunk object may carry an `embedding: number[384]` field
-- populated by the builder's embedding worker. No schema change
-- is needed for that; `chunks` is already JSONB.
-- ============================================================

ALTER TABLE public.property_extractions
  ADD COLUMN canonical_qas JSONB;

COMMENT ON COLUMN public.property_extractions.canonical_qas IS
  'Pre-computed canonical question/answer cache: array of '
  '{id, field, question, answer, source_anchor_id, embedding[384]}. '
  'Populated by the builder after extraction; consumed by the '
  'tour runtime for zero-LLM tier-1 answers. NULL until the '
  'client-side embedding worker has run.';
