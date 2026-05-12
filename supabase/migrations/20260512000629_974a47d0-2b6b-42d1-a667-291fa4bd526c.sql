ALTER TABLE public.branding_settings
  ADD COLUMN IF NOT EXISTS calling_card_studio_name text,
  ADD COLUMN IF NOT EXISTS calling_card_headline text,
  ADD COLUMN IF NOT EXISTS calling_card_cta_label text;