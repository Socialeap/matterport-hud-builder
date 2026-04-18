-- ============================================================
-- PRODUCTION VAULT — Asset Registry
-- MSPs curate reusable assets (audio, filters, widgets, icons,
-- docs, links) that clients plug into presentations.
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

-- Provider CRUD on their own assets
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

-- Clients can read only the assets their provider has toggled on.
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

-- ============================================================
-- STORAGE BUCKET for vault file uploads
-- Files are stored under `{provider_id}/{category}/{filename}`.
-- ============================================================
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
