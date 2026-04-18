-- ============================================================
-- PROPERTY DOCS TRANSFORMATION ENGINE — Phase 1
--
-- Turns `vault_assets (category_type='property_doc')` from static
-- blob storage into a structured pipeline:
--   upload → extract → template-map → embed → hybrid-search → HUD
--
-- This migration introduces:
--   • pgvector extension + embedding columns on vault_assets
--   • private 'property-docs' storage bucket (NOT public)
--   • vault_templates (MSP-authored extraction schema)
--   • property_extractions (result rows: fields + chunks + embedding)
--   • lus_freezes (Lifecycle Update Stage — property-level write lock)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ────────────────────────────────────────────────────────────
-- Private bucket for property docs.
-- Separate from the public `vault-assets` bucket because property
-- docs commonly contain PII.
-- ────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
  VALUES ('property-docs', 'property-docs', false)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Providers can read their property docs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'property-docs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Bound clients can read property docs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'property-docs'
    AND EXISTS (
      SELECT 1 FROM public.client_providers cp
      WHERE cp.provider_id::text = (storage.foldername(name))[1]
        AND cp.client_id = auth.uid()
    )
  );

CREATE POLICY "Providers can upload property docs"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'property-docs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Providers can update their property docs"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'property-docs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Providers can delete their property docs"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'property-docs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ────────────────────────────────────────────────────────────
-- Embedding status tracking on existing vault_assets.
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.vault_assets
  ADD COLUMN embedding_status TEXT
    CHECK (embedding_status IN ('pending','running','ready','failed')),
  ADD COLUMN embedding_backfilled_at TIMESTAMPTZ;

-- ────────────────────────────────────────────────────────────
-- vault_templates — MSP-authored extraction schema.
-- field_schema is a JSON Schema describing the fields the extractor
-- should pull out; extractor picks which provider runs.
-- ────────────────────────────────────────────────────────────
CREATE TABLE public.vault_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  doc_kind TEXT NOT NULL,
  field_schema JSONB NOT NULL,
  extractor TEXT NOT NULL DEFAULT 'pdfjs_heuristic'
    CHECK (extractor IN ('pdfjs_heuristic','donut')),
  version INT NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX vault_templates_provider_kind_idx
  ON public.vault_templates (provider_id, doc_kind)
  WHERE is_active;

ALTER TABLE public.vault_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Providers manage their templates"
  ON public.vault_templates FOR ALL
  USING (auth.uid() = provider_id)
  WITH CHECK (auth.uid() = provider_id);

CREATE POLICY "Bound clients can read active templates"
  ON public.vault_templates FOR SELECT
  USING (
    is_active
    AND EXISTS (
      SELECT 1 FROM public.client_providers cp
      WHERE cp.provider_id = vault_templates.provider_id
        AND cp.client_id = auth.uid()
    )
  );

CREATE TRIGGER update_vault_templates_updated_at
  BEFORE UPDATE ON public.vault_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ────────────────────────────────────────────────────────────
-- property_extractions — per-asset, per-template extraction results.
-- property_uuid is TEXT: property scope lives inside saved_models.properties
-- (JSONB), not a separate table, so a hard FK isn't possible.
-- ────────────────────────────────────────────────────────────
CREATE TABLE public.property_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_asset_id UUID NOT NULL REFERENCES public.vault_assets(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.vault_templates(id) ON DELETE RESTRICT,
  saved_model_id UUID REFERENCES public.saved_models(id) ON DELETE SET NULL,
  property_uuid TEXT NOT NULL,
  fields JSONB NOT NULL,
  chunks JSONB NOT NULL,
  embedding VECTOR(384),
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  extractor TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  UNIQUE (vault_asset_id, template_id)
);

CREATE INDEX property_extractions_property_idx
  ON public.property_extractions (property_uuid);

CREATE INDEX property_extractions_saved_model_idx
  ON public.property_extractions (saved_model_id);

ALTER TABLE public.property_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Providers read their extractions"
  ON public.property_extractions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.vault_assets va
      WHERE va.id = property_extractions.vault_asset_id
        AND va.provider_id = auth.uid()
    )
  );

CREATE POLICY "Providers write their extractions"
  ON public.property_extractions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.vault_assets va
      WHERE va.id = property_extractions.vault_asset_id
        AND va.provider_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vault_assets va
      WHERE va.id = property_extractions.vault_asset_id
        AND va.provider_id = auth.uid()
    )
  );

CREATE POLICY "Bound clients can read extractions"
  ON public.property_extractions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.vault_assets va
      JOIN public.client_providers cp ON cp.provider_id = va.provider_id
      WHERE va.id = property_extractions.vault_asset_id
        AND cp.client_id = auth.uid()
    )
  );

-- ────────────────────────────────────────────────────────────
-- lus_freezes — Lifecycle Update Stage lock keyed by property_uuid.
-- When a row exists for a property_uuid, INSERT/UPDATE of extractions
-- for that property are blocked; DELETE remains allowed so bad docs
-- can still be retracted during freeze.
-- ────────────────────────────────────────────────────────────
CREATE TABLE public.lus_freezes (
  property_uuid TEXT PRIMARY KEY,
  frozen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  frozen_by UUID NOT NULL REFERENCES auth.users(id),
  reason TEXT
);

ALTER TABLE public.lus_freezes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Providers manage freezes they authored"
  ON public.lus_freezes FOR ALL
  USING (auth.uid() = frozen_by)
  WITH CHECK (auth.uid() = frozen_by);

CREATE POLICY "Authenticated users can read freezes"
  ON public.lus_freezes FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Server-side freeze enforcement on property_extractions.
-- DELETE is intentionally NOT gated.
CREATE OR REPLACE FUNCTION public.enforce_lus_freeze()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.lus_freezes WHERE property_uuid = NEW.property_uuid) THEN
    RAISE EXCEPTION 'LUS freeze active for property_uuid=%, write blocked', NEW.property_uuid
      USING ERRCODE = '55006';  -- object_not_in_prerequisite_state
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER enforce_lus_freeze_on_extractions
  BEFORE INSERT OR UPDATE ON public.property_extractions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_lus_freeze();
