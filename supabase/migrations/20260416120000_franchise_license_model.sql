-- Franchise Ownership Model: Add license tracking to branding_settings
-- Setup Fee + Annual Operating License ($49/year starting Year 2)

ALTER TABLE public.branding_settings
  ADD COLUMN license_status text NOT NULL DEFAULT 'active',
  ADD COLUMN license_expiry_date timestamptz,
  ADD COLUMN stripe_subscription_id text;

ALTER TABLE public.purchases
  ADD COLUMN stripe_subscription_id text;

-- Grandfather existing users: give them 1 year from migration date
UPDATE public.branding_settings
SET license_status = 'active',
    license_expiry_date = now() + interval '1 year'
WHERE tier IS NOT NULL;
