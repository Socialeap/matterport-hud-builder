-- Admin RPC: list service-match notification requests
CREATE OR REPLACE FUNCTION public.get_service_match_requests_for_admin()
RETURNS TABLE(
  id uuid,
  created_at timestamptz,
  email text,
  name text,
  brokerage text,
  city text,
  region text,
  zip text,
  essential_services public.marketplace_specialty[],
  preferable_services public.marketplace_specialty[],
  match_token uuid,
  status public.beacon_status,
  expires_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT b.id, b.created_at, b.email, b.name, b.brokerage,
           b.city, b.region, b.zip,
           b.essential_services, b.preferable_services,
           b.match_token, b.status, b.expires_at
      FROM public.agent_beacons b
     WHERE (
       coalesce(array_length(b.essential_services, 1), 0) > 0
       OR coalesce(array_length(b.preferable_services, 1), 0) > 0
     )
     ORDER BY b.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_service_match_requests_for_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_service_match_requests_for_admin() TO authenticated;