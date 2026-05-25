-- Restore the full get_providers_for_admin() RPC to return all fields
-- needed by the admin MSP table (brand_name, slug, tier, display_name).
-- A later migration (20260420230205) accidentally overwrote the original
-- function with a simplified version that only returned 3 fields.

CREATE OR REPLACE FUNCTION public.get_providers_for_admin()
RETURNS TABLE (
  provider_id   uuid,
  brand_name    text,
  slug          text,
  tier          public.app_tier,
  display_name  text,
  email         text,
  start_date    timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    bs.provider_id,
    bs.brand_name,
    bs.slug,
    bs.tier,
    p.display_name,
    au.email::text,
    au.created_at AS start_date
  FROM public.branding_settings bs
  JOIN public.profiles p ON p.user_id = bs.provider_id
  JOIN auth.users au ON au.id = bs.provider_id
  ORDER BY au.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_providers_for_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.get_providers_for_admin() TO authenticated;
