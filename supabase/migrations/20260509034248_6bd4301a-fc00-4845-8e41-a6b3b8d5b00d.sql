CREATE OR REPLACE FUNCTION public.get_service_match_detail_for_admin(p_match_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_beacon RECORD;
  v_results jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT id, email, name, brokerage, city, region, zip, country,
         essential_services, preferable_services, match_token,
         pro_visibility_until, expires_at, created_at, status,
         service_match_notified_at, matched_provider_id, matched_at
    INTO v_beacon
    FROM public.agent_beacons
   WHERE match_token = p_match_token
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
    INTO v_results
    FROM public.get_service_match_results(p_match_token) r;

  RETURN jsonb_build_object(
    'status', 'ok',
    'beacon', to_jsonb(v_beacon),
    'is_pro_window', (v_beacon.pro_visibility_until IS NOT NULL AND now() < v_beacon.pro_visibility_until),
    'results', v_results
  );
END;
$$;