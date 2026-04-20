ALTER TABLE public.branding_settings
  ADD COLUMN IF NOT EXISTS tier3_price_cents integer;