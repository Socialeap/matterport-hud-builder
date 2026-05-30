DO $$
DECLARE
  v_staged INT;
  v_first UUID;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT public.detect_doorway_candidates(100) INTO v_staged;
  RAISE NOTICE 'staged=%', v_staged;

  SELECT property_id INTO v_first
    FROM public.doorway_candidates
   ORDER BY created_at ASC
   LIMIT 1;

  PERFORM public.set_doorway_candidate_status(v_first, 'queued');
  RAISE NOTICE 'queued property=%', v_first;

  PERFORM public.set_doorway_candidate_status(v_first, 'new');
  RAISE NOTICE 'reverted property=% to new', v_first;

  RESET ROLE;
END $$;