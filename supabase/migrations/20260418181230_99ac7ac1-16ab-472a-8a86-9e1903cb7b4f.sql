-- ============================================================
-- MIGRATION 1: Production Vault — Asset Registry
-- ============================================================

CREATE TYPE public.vault_category AS ENUM (
  'spatial_audio',
  'visual_hud_filter',
  'interactive_widget',
  'custom_iconography',
  'property_doc',
  'external_link'
);

CREATE TABLE public.vault_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_type public.vault_category NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  asset_url TEXT NOT NULL,
  storage_path TEXT,
  mime_type TEXT,
  file_size_bytes BIGINT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX vault_assets_provider_idx
  ON public.vault_assets (provider_id);

CREATE INDEX vault_assets_provider_active_idx
  ON public.vault_assets (provider_id, is_active)
  WHERE is_active;

ALTER TABLE public.vault_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Providers can view their own vault assets"
  ON public.vault_assets FOR SELECT
  USING (auth.uid() = provider_id);

CREATE POLICY "Providers can insert their own vault assets"
  ON public.vault_assets FOR INSERT
  WITH CHECK (auth.uid() = provider_id);

CREATE POLICY "Providers can update their own vault assets"
  ON public.vault_assets FOR UPDATE
  USING (auth.uid() = provider_id);

CREATE POLICY "Providers can delete their own vault assets"
  ON public.vault_assets FOR DELETE
  USING (auth.uid() = provider_id);

CREATE POLICY "Clients can view active vault assets from their providers"
  ON public.vault_assets FOR SELECT
  USING (
    is_active
    AND EXISTS (
      SELECT 1 FROM public.client_providers cp
      WHERE cp.provider_id = vault_assets.provider_id
        AND cp.client_id = auth.uid()
    )
  );

CREATE TRIGGER update_vault_assets_updated_at
  BEFORE UPDATE ON public.vault_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO storage.buckets (id, name, public)
  VALUES ('vault-assets', 'vault-assets', true)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Vault assets are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'vault-assets');

CREATE POLICY "Providers can upload vault assets"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'vault-assets'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Providers can update their vault assets"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'vault-assets'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Providers can delete their vault assets"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'vault-assets'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================
-- MIGRATION 2: Property Docs Engine — Phase 1
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

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

ALTER TABLE public.vault_assets
  ADD COLUMN embedding_status TEXT
    CHECK (embedding_status IN ('pending','running','ready','failed')),
  ADD COLUMN embedding_backfilled_at TIMESTAMPTZ;

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

CREATE OR REPLACE FUNCTION public.enforce_lus_freeze()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.lus_freezes WHERE property_uuid = NEW.property_uuid) THEN
    RAISE EXCEPTION 'LUS freeze active for property_uuid=%, write blocked', NEW.property_uuid
      USING ERRCODE = '55006';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER enforce_lus_freeze_on_extractions
  BEFORE INSERT OR UPDATE ON public.property_extractions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_lus_freeze();

-- ============================================================
-- MIGRATION 3: Canonical Q&A cache (Phase 5)
-- ============================================================

ALTER TABLE public.property_extractions
  ADD COLUMN canonical_qas JSONB;

COMMENT ON COLUMN public.property_extractions.canonical_qas IS
  'Pre-computed canonical question/answer cache: array of '
  '{id, field, question, answer, source_anchor_id, embedding[384]}. '
  'Populated by the builder after extraction; consumed by the '
  'tour runtime for zero-LLM tier-1 answers. NULL until the '
  'client-side embedding worker has run.';