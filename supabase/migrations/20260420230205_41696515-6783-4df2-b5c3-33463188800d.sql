-- 1. Create admin_grants table for complimentary tier grants by admins
CREATE TABLE IF NOT EXISTS public.admin_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL,
  granted_by uuid NOT NULL,
  tier public.app_tier NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_grants_provider ON public.admin_grants(provider_id);
CREATE INDEX IF NOT EXISTS idx_admin_grants_active ON public.admin_grants(provider_id, expires_at) WHERE revoked_at IS NULL;

ALTER TABLE public.admin_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all grants"
  ON public.admin_grants FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Providers can view their grants"
  ON public.admin_grants FOR SELECT
  USING (auth.uid() = provider_id);

-- 2. RPC to list all providers with email + start_date for admin portal
CREATE OR REPLACE FUNCTION public.get_providers_for_admin()
RETURNS TABLE (
  provider_id uuid,
  email text,
  start_date timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    bs.provider_id,
    au.email::text,
    au.created_at AS start_date
  FROM public.branding_settings bs
  JOIN auth.users au ON au.id = bs.provider_id
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role);
$$;

REVOKE ALL ON FUNCTION public.get_providers_for_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.get_providers_for_admin() TO authenticated;

-- 3. Assign admin role to shakoure@transcendencemedia.com
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users
WHERE email = 'shakoure@transcendencemedia.com'
ON CONFLICT (user_id, role) DO NOTHING;