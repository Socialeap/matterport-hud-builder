CREATE OR REPLACE FUNCTION public.get_effective_tier(_provider_id uuid)
RETURNS public.app_tier
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT tier FROM public.admin_grants
      WHERE provider_id = _provider_id
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY (tier = 'pro') DESC, created_at DESC
      LIMIT 1
    ),
    (
      SELECT tier FROM public.licenses
      WHERE user_id = _provider_id
        AND license_status = 'active'
        AND (license_expiry IS NULL OR license_expiry > now())
      ORDER BY (tier = 'pro') DESC, updated_at DESC
      LIMIT 1
    ),
    'starter'::public.app_tier
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_effective_tier(uuid) TO authenticated, anon;