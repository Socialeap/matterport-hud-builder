ALTER TABLE public.property_extractions
  ADD COLUMN IF NOT EXISTS intelligence_health jsonb;

CREATE INDEX IF NOT EXISTS property_extractions_health_status_idx
  ON public.property_extractions ((intelligence_health->>'status'));

COMMENT ON COLUMN public.property_extractions.intelligence_health IS
  'Computed by edge extraction functions. See supabase/functions/_shared/intelligence-health.ts. Status values: ready | degraded | failed | context_only_degraded.';