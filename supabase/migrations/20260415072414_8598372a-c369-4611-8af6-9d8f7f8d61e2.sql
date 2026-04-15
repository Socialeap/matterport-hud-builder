-- Add Stripe Connect and pricing columns to branding_settings
ALTER TABLE public.branding_settings
  ADD COLUMN stripe_connect_id text DEFAULT NULL,
  ADD COLUMN stripe_onboarding_complete boolean DEFAULT false,
  ADD COLUMN base_price_cents integer DEFAULT NULL,
  ADD COLUMN model_threshold integer DEFAULT 1,
  ADD COLUMN additional_model_fee_cents integer DEFAULT NULL;

-- Add payment tracking columns to saved_models
ALTER TABLE public.saved_models
  ADD COLUMN amount_cents integer DEFAULT NULL,
  ADD COLUMN model_count integer DEFAULT NULL;

-- Drop the old manual payment fields (replaced by Stripe Connect)
ALTER TABLE public.branding_settings
  DROP COLUMN IF EXISTS payment_link,
  DROP COLUMN IF EXISTS payment_instructions;