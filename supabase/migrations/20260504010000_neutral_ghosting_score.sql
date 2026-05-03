-- ============================================================
-- Marketplace v2 — Neutral-Ghosting score model
-- ------------------------------------------------------------
-- The PR3 migration shipped a -0.10 score penalty when a Pro
-- marks a lead as 'unresponsive' (the agent ghosted). In review
-- this was identified as a logic trap:
--
--   * Pros have a self-interested reason to mis-classify ghosted
--     leads as 'lost' (which is neutral) to protect their score
--     — destroying the data signal we wanted from disposition
--     tracking.
--   * The platform cannot distinguish lead-quality issues from
--     MSP-performance issues without honest "unresponsive"
--     reporting.
--   * MSPs cannot force a reply; penalizing them for the agent's
--     silence punishes an externality.
--
-- The new model:
--
--   Won           +0.20  (unchanged — incentivizes closing)
--   Lost           0.00  (unchanged — neutral)
--   Unresponsive   0.00  (CHANGED from −0.10 to 0.00)
--
-- The 14-day "no disposition at all" penalty (−0.30) stays
-- untouched. We still want to penalize MSP silence — we just
-- stop penalizing agent silence.
--
-- This migration is a behavior-only change: schema is unchanged,
-- only the function body of set_beacon_disposition is rewritten.
-- CREATE OR REPLACE so callers (the dashboard's disposition
-- buttons) continue to work without any frontend change.
-- ============================================================

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

  -- Score adjustments only fire the first time a non-null
  -- disposition is set, so re-disposition isn't gameable.
  --
  -- 'unresponsive' is now NEUTRAL (was -0.10 in PR3). We
  -- intentionally skip the score call — the leads_expired
  -- counter is reserved for the apply_no_disposition_penalties
  -- cron, and we don't want to conflate the two signals.
  -- Platform-wide ghost rates are still trivially queryable
  -- from agent_beacons.disposition.
  IF NOT v_existed THEN
    IF p_disposition = 'won' THEN
      PERFORM public._update_responsiveness_score(v_uid, 0.20, 'won');
    END IF;
    -- 'lost' and 'unresponsive' are both neutral: no score
    -- change, no counter bump.
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_beacon_disposition(UUID, public.beacon_disposition) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_beacon_disposition(UUID, public.beacon_disposition) TO authenticated;

-- ============================================================
-- End of neutral-ghosting score model migration
-- ============================================================
