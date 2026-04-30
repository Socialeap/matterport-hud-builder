CREATE OR REPLACE FUNCTION public.provider_has_paid_access(_provider_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.licenses WHERE user_id = _provider_id)
    OR EXISTS (
      SELECT 1 FROM public.purchases
      WHERE user_id = _provider_id AND status = 'completed'
    )
    OR EXISTS (
      SELECT 1 FROM public.admin_grants
      WHERE provider_id = _provider_id
        AND revoked_at IS NULL
        AND expires_at > now()
    );
$$;

GRANT EXECUTE ON FUNCTION public.provider_has_paid_access(uuid) TO anon, authenticated;