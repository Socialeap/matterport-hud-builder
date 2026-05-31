-- ============================================================
-- Frontiers3D — Track B / B2.x: Candidate Promotion Staging (non-destructive)
-- ------------------------------------------------------------
-- Lets an admin EXPLICITLY promote a SINGLE doorway candidate, one at a
-- time, recording a fully auditable promotion request — WITHOUT touching
-- agent_beacons or the legacy consent constraint.
--
-- WHY this is the safe boundary: actually inserting a Map-Oracle beacon
-- requires (a) additive agent_beacons.source/property_id columns AND
-- (b) the DESTRUCTIVE relaxation of agent_beacons_consent_required
-- (cold-outreach beacons have consent_given=FALSE, which the legacy
-- CHECK rejects). That destructive step is a SEPARATE, explicitly-
-- approved PR (B3). This migration stages the promotion DECISION + audit
-- trail so B3 (once approved) can fulfill it; nothing here is destructive.
--
-- What this lands (all NET-NEW, strictly additive):
--   * candidate_promotions table — one auditable row per promotion
--     request (snapshots property + candidate card + requesting admin)
--   * request_candidate_promotion(property_id, notes?) — admin-only,
--     explicit, ONE candidate, idempotency-guarded
--   * cancel_candidate_promotion(property_id) — reversible
--   * operator_candidate_promotions view (security_invoker=true)
--
-- EXPLICITLY NOT here (separate, approved B3 / out of scope):
--   * agent_beacons changes, consent relaxation, promote_property_to_beacon
--   * client/provider binding, billing, Stripe, platform fee, Track A
--   * any automatic or batch promotion; no trigger, no cron
--
-- Prerequisite: B2 (doorway_candidates, compose_doorway_payload) — LIVE.
-- Safety: no DROP, no DELETE, no TRUNCATE, no destructive ALTER, no change
-- to any existing table/policy/constraint. Reversible. No cron.
-- ============================================================


-- ------------------------------------------------------------
-- 1. candidate_promotions — auditable promotion requests
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.candidate_promotions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Source linkage. SET NULL on property delete so the audit row survives;
  -- the snapshot columns below preserve traceability regardless.
  property_id      UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  google_place_id  TEXT,                         -- snapshot (durable trace)
  candidate_name   TEXT,                         -- snapshot
  doorway_payload  JSONB,                        -- snapshot of the card at request time
  status           TEXT NOT NULL DEFAULT 'requested'
                     CHECK (status IN ('requested','beacon_created','cancelled')),
  target_beacon_id UUID,                         -- filled by B3 when the beacon is created
  requested_by     UUID,                         -- admin who requested
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes            TEXT
);

-- At most ONE active (requested) promotion per property — enforces the
-- explicit, one-at-a-time rule while allowing re-promotion after cancel.
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_promotions_active
  ON public.candidate_promotions (property_id)
  WHERE status = 'requested';

CREATE INDEX IF NOT EXISTS idx_candidate_promotions_status
  ON public.candidate_promotions (status, requested_at DESC);

ALTER TABLE public.candidate_promotions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage candidate_promotions"
    ON public.candidate_promotions FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read candidate_promotions"
    ON public.candidate_promotions FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ------------------------------------------------------------
-- 2. request_candidate_promotion(property_id, notes?)
--    Admin-only, explicit, ONE candidate. Snapshots the candidate for
--    audit, records the request, and marks the candidate 'surfaced'.
--    Idempotency-guarded: errors if an active request already exists.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_candidate_promotion(
  p_property_id UUID,
  p_notes       TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id        UUID;
  v_place_id  TEXT;
  v_name      TEXT;
  v_payload   JSONB;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'request_candidate_promotion is operator (admin) only'
      USING ERRCODE = '42501';
  END IF;

  -- Must be an existing doorway candidate.
  IF NOT EXISTS (SELECT 1 FROM public.doorway_candidates WHERE property_id = p_property_id) THEN
    RAISE EXCEPTION 'no doorway candidate for property %', p_property_id
      USING ERRCODE = 'P0001';
  END IF;

  -- One active promotion at a time.
  IF EXISTS (
    SELECT 1 FROM public.candidate_promotions
     WHERE property_id = p_property_id AND status = 'requested'
  ) THEN
    RAISE EXCEPTION 'property % already has an active promotion request', p_property_id
      USING ERRCODE = '23505';
  END IF;

  -- Snapshot for durable audit.
  SELECT pr.google_place_id, pr.name, dc.doorway_payload
    INTO v_place_id, v_name, v_payload
    FROM public.doorway_candidates dc
    JOIN public.properties pr ON pr.id = dc.property_id
   WHERE dc.property_id = p_property_id;

  INSERT INTO public.candidate_promotions
    (property_id, google_place_id, candidate_name, doorway_payload, status, requested_by, notes)
  VALUES
    (p_property_id, v_place_id, v_name, v_payload, 'requested', auth.uid(), p_notes)
  RETURNING id INTO v_id;

  -- Reflect in the operator triage surface (uses the existing B2 enum).
  UPDATE public.doorway_candidates
     SET status = 'surfaced', updated_at = now(), reviewed_by = auth.uid()
   WHERE property_id = p_property_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_candidate_promotion(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_candidate_promotion(UUID, TEXT) TO service_role, authenticated;


-- ------------------------------------------------------------
-- 3. cancel_candidate_promotion(property_id) — reversible
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_candidate_promotion(p_property_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'cancel_candidate_promotion is operator (admin) only'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.candidate_promotions
     SET status = 'cancelled', updated_at = now()
   WHERE property_id = p_property_id AND status = 'requested';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active promotion request for property %', p_property_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Reversible: return the candidate to the triage queue.
  UPDATE public.doorway_candidates
     SET status = 'queued', updated_at = now(), reviewed_by = auth.uid()
   WHERE property_id = p_property_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_candidate_promotion(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_candidate_promotion(UUID) TO service_role, authenticated;


-- ------------------------------------------------------------
-- 4. operator_candidate_promotions — admin-only surface (security_invoker)
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.operator_candidate_promotions
  WITH (security_invoker = true) AS
  SELECT cp.id,
         cp.property_id,
         cp.google_place_id,
         cp.candidate_name,
         cp.status,
         cp.target_beacon_id,
         cp.requested_by,
         cp.requested_at,
         cp.updated_at,
         cp.notes
    FROM public.candidate_promotions cp
   ORDER BY cp.requested_at DESC;

COMMENT ON VIEW public.operator_candidate_promotions IS
  'Admin-only (security_invoker) audit surface for Map-Oracle candidate promotion requests. A request stages the decision; the actual agent_beacons insert is the separate, explicitly-approved destructive B3.';

GRANT SELECT ON public.operator_candidate_promotions TO service_role, authenticated;

-- ============================================================
-- End of Candidate Promotion Staging (non-destructive). The actual
-- beacon creation (agent_beacons + consent relaxation + promote fn) is
-- a separate, clearly-marked DESTRUCTIVE B3 PR requiring explicit sign-off.
-- ============================================================
