ALTER TABLE public.branding_settings
  ADD COLUMN IF NOT EXISTS flat_price_per_model_cents integer,
  ADD COLUMN IF NOT EXISTS use_flat_pricing boolean NOT NULL DEFAULT false;