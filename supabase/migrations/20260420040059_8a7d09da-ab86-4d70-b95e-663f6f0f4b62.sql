ALTER TABLE public.branding_settings
  ADD COLUMN IF NOT EXISTS hero_bg_url text,
  ADD COLUMN IF NOT EXISTS hero_bg_opacity numeric NOT NULL DEFAULT 0.45;