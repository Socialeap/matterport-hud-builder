ALTER TABLE public.property_extractions
  ADD COLUMN IF NOT EXISTS candidate_fields jsonb,
  ADD COLUMN IF NOT EXISTS field_provenance jsonb;