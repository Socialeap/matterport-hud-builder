CREATE OR REPLACE FUNCTION public.provider_has_paid_access(_provider_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.licenses
      WHERE user_id = _provider_id
        AND license_status = 'active'::public.license_status
        AND (license_expiry IS NULL OR license_expiry > now())
    )
    OR EXISTS (
      SELECT 1
      FROM public.purchases
      WHERE user_id = _provider_id
        AND status = 'completed'
        AND product_id IN ('starter_tier', 'pro_tier', 'pro_upgrade')
    )
    OR EXISTS (
      SELECT 1
      FROM public.admin_grants
      WHERE provider_id = _provider_id
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
    );
$$;

GRANT EXECUTE ON FUNCTION public.provider_has_paid_access(uuid) TO anon, authenticated;