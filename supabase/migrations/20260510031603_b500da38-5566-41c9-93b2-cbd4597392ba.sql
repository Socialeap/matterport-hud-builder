CREATE OR REPLACE FUNCTION public.set_beacon_disposition(
  p_beacon_id UUID,
  p_disposition public.beacon_disposition
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_beacon RECORD;
  v_existed BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(v_uid, 'provider'::public.app_role) THEN
    RAISE EXCEPTION 'provider role required' USING ERRCODE = '42501';
  END IF;

  SELECT b.id, b.disposition, b.exclusive_provider_id, b.matched_provider_id
  INTO v_beacon
  FROM public.agent_beacons b
  WHERE b.id = p_beacon_id
    AND (b.exclusive_provider_id = v_uid OR b.matched_provider_id = v_uid);

  IF v_beacon.id IS NULL THEN
    RAISE EXCEPTION 'lead not yours to disposition' USING ERRCODE = '42501';
  END IF;

  v_existed := v_beacon.disposition IS NOT NULL;

  UPDATE public.agent_beacons
     SET disposition        = p_disposition,
         disposition_set_at = now(),
         disposition_set_by = v_uid
   WHERE id = p_beacon_id;

  IF NOT v_existed THEN
    IF p_disposition = 'won' THEN
      PERFORM public._update_responsiveness_score(v_uid, 0.20, 'won');
    END IF;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_beacon_disposition(UUID, public.beacon_disposition) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_beacon_disposition(UUID, public.beacon_disposition) TO authenticated;