-- Phase A — per-provider feature flags for the Property Intelligence
-- pipeline. Phase B (pre-synth) and Phase C (Gemini smart extractor)
-- ride on the same column. The default `{}` JSONB means every provider
-- sees the existing pipeline behavior until a flag is explicitly set,
-- so this migration is safe to apply in production.
--
-- Flag keys reserved for the rollout:
--   - hybrid_rag_fallback        (Phase A)  — if false, skip the
--                                              raw-chunk direct tier
--                                              and fall through to
--                                              the legacy synthesis
--                                              path. Defaults treat
--                                              missing-as-true so the
--                                              tier ships on by default.
--   - pre_synth_answers          (Phase B)
--   - gemini_smart_extractor     (Phase C)
--
-- Reads happen in extract-property-doc and on the client in
-- src/hooks/useFeatureFlags.ts (added in Phase B). RLS is inherited
-- from branding_settings — providers can read/write their own flags
-- only.

ALTER TABLE public.branding_settings
  ADD COLUMN IF NOT EXISTS feature_flags JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.branding_settings.feature_flags IS
  'Per-provider feature flag map for the Property Intelligence rollout '
  '(Phase A/B/C). Keys: hybrid_rag_fallback, pre_synth_answers, '
  'gemini_smart_extractor. Missing keys are treated as defaults by the '
  'reading code; see src/hooks/useFeatureFlags.ts.';
