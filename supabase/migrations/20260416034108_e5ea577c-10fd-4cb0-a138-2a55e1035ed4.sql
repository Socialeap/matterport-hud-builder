-- Create enums for license status
CREATE TYPE public.license_status AS ENUM ('active', 'past_due', 'expired');

-- Create licenses table
CREATE TABLE public.licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tier public.app_tier NOT NULL DEFAULT 'starter',
  license_status public.license_status NOT NULL DEFAULT 'active',
  license_expiry timestamptz,
  studio_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  stripe_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_licenses_user_id ON public.licenses(user_id);
CREATE INDEX idx_licenses_studio_id ON public.licenses(studio_id);
CREATE INDEX idx_licenses_stripe_sub ON public.licenses(stripe_subscription_id);

-- Enable RLS
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;

-- Users can view their own license
CREATE POLICY "Users can view their own license"
  ON public.licenses FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can manage all licenses
CREATE POLICY "Service role can manage licenses"
  ON public.licenses FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Trigger for updated_at
CREATE TRIGGER update_licenses_updated_at
  BEFORE UPDATE ON public.licenses
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Helper function to get license info
CREATE OR REPLACE FUNCTION public.get_license_info(user_uuid uuid)
RETURNS TABLE(tier public.app_tier, license_status public.license_status, license_expiry timestamptz, studio_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.tier, l.license_status, l.license_expiry, l.studio_id
  FROM public.licenses l
  WHERE l.user_id = user_uuid
  LIMIT 1;
$$;