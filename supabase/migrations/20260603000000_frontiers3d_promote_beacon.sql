-- ============================================================
-- Frontiers3D — Track B / B3: Map-Oracle Promotion (beacon creation)
-- ============================================================
-- !!  ⚠️  DESTRUCTIVE MIGRATION — EXPLICIT HUMAN SIGN-OFF REQUIRED  ⚠️  !!
-- ------------------------------------------------------------
-- This migration DROPS and re-creates the legacy CHECK constraint
-- `agent_beacons_consent_required` so Map-Oracle (cold-outreach)
-- beacons with consent_given=FALSE can be created. DO NOT APPLY without
-- explicit approval and the pre-apply invariant check below.
--
-- The replacement is STRICTLY MORE PERMISSIVE: the legacy rule
--   (consent_given = TRUE AND length(consent_text) > 0)
-- is preserved VERBATIM for source='agent_form' rows; a parallel
-- source='map_oracle' branch additionally allows consent_given=FALSE
-- so long as property_id IS NOT NULL and consent_text is non-empty
-- (CAN-SPAM cold-outreach model — audit text + data lineage required).
-- No row that satisfied the old rule can fail the new one.
--
-- PRE-APPLY INVARIANT (must return 0 before applying):
--   SELECT count(*) FROM public.agent_beacons
--    WHERE NOT (
--      (source = 'agent_form' AND consent_given = TRUE AND length(consent_text) > 0)
--      OR (source = 'map_oracle' AND property_id IS NOT NULL AND length(consent_text) > 0)
--    );
-- (Before this migration adds `source`, every legacy row is treated as
--  agent_form and must already satisfy the legacy rule — so the count is
--  0 on a healthy DB. Postgres will also reject ADD CONSTRAINT if any row
--  fails, which is the hard safety net.)
--
-- What it lands:
--   1. ADDITIVE agent_beacons columns: source / property_id / doorway_payload
--   2. DESTRUCTIVE drop+re-add of agent_beacons_consent_required (above)
--   3. promote_property_to_beacon(property_id, consent_text?) — admin/
--      service-role only; EXPLICIT, ONE property per call; idempotent;
--      respects unsubscribes; sets doorway_payload via the live B2
--      compose_doorway_payload; conditionally marks the matching
--      candidate_promotions row beacon_created (audit linkage to PR A).
--
-- Prerequisite: B2 (compose_doorway_payload, properties). Sequence AFTER
-- the non-destructive Candidate-Promotion-Staging PR (candidate_promotions)
-- so the audit linkage is live; this migration also works if that table is
-- absent (the linkage is guarded by to_regclass).
--
-- Out of scope (NOT here): client/provider binding (B4), billing, Stripe,
-- platform fee, Track A. NO auto-promotion, NO batch, NO trigger, NO cron.
-- ============================================================


-- ------------------------------------------------------------
-- Pre-flight: B2 composer must exist.
-- ------------------------------------------------------------
DO $$ BEGIN
  IF to_regproc('public.compose_doorway_payload(uuid)') IS NULL THEN
    RAISE EXCEPTION 'B3 requires B2 (compose_doorway_payload) — apply 20260601000000_frontiers3d_doorway_candidates.sql first.';
  END IF;
END $$;


-- ------------------------------------------------------------
-- 1. ADDITIVE: agent_beacons bridge columns (safe defaults preserve
--    existing-row semantics; existing beacons become source='agent_form').
-- ------------------------------------------------------------
ALTER TABLE public.agent_beacons
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'agent_form';

DO $$ BEGIN
  ALTER TABLE public.agent_beacons
    ADD CONSTRAINT agent_beacons_source_check
    CHECK (source IN ('agent_form', 'map_oracle'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.agent_beacons
  ADD COLUMN IF NOT EXISTS property_id UUID
    REFERENCES public.properties(id) ON DELETE SET NULL;

ALTER TABLE public.agent_beacons
  ADD COLUMN IF NOT EXISTS doorway_payload JSONB;

CREATE INDEX IF NOT EXISTS idx_agent_beacons_property_id
  ON public.agent_beacons (property_id) WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_beacons_source
  ON public.agent_beacons (source);


-- ------------------------------------------------------------
-- 2. ⚠️ DESTRUCTIVE: relax agent_beacons_consent_required
--    (preserves the agent_form rule verbatim; adds a map_oracle branch).
-- ------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE public.agent_beacons
    DROP CONSTRAINT IF EXISTS agent_beacons_consent_required;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.agent_beacons
  ADD CONSTRAINT agent_beacons_consent_required
  CHECK (
    (source = 'agent_form' AND consent_given = TRUE  AND length(consent_text) > 0)
    OR
    (source = 'map_oracle' AND property_id IS NOT NULL AND length(consent_text) > 0)
  );


-- ------------------------------------------------------------
-- 3. promote_property_to_beacon(property_id, consent_text?)
--    Admin/service-role only. EXPLICIT, ONE property per call. Idempotent
--    on (email, city). Respects unsubscribes. Sets doorway_payload from
--    the live B2 composer. Marks the matching candidate_promotions row
--    beacon_created when that table exists (audit linkage to PR A).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_property_to_beacon(
  p_property_id           UUID,
  p_consent_text_override TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email        TEXT;
  v_name         TEXT;
  v_city         TEXT;
  v_region       TEXT;
  v_zip          TEXT;
  v_country      TEXT;
  v_consent_text TEXT;
  v_existing     RECORD;
  v_beacon_id    UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'promote_property_to_beacon is operator (admin) only'
      USING ERRCODE = '42501';
  END IF;
  IF p_property_id IS NULL THEN
    RAISE EXCEPTION 'property_id is required' USING ERRCODE = '22023';
  END IF;

  SELECT p.name, p.locality, p.administrative_area, p.postal_code, p.country_code, pc.email
    INTO v_name, v_city, v_region, v_zip, v_country, v_email
    FROM public.properties p
    LEFT JOIN public.property_contacts pc ON pc.property_id = p.id
   WHERE p.id = p_property_id;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'property % does not exist', p_property_id USING ERRCODE = 'P0001';
  END IF;
  IF v_email IS NULL OR btrim(v_email) = '' THEN
    RAISE EXCEPTION 'cannot promote property %: no email in property_contacts (run enrichment first)', p_property_id USING ERRCODE = 'P0001';
  END IF;
  IF v_city IS NULL OR btrim(v_city) = '' THEN
    RAISE EXCEPTION 'cannot promote property %: properties.locality is empty', p_property_id USING ERRCODE = 'P0001';
  END IF;
  IF v_country IS NULL OR v_country <> 'US' THEN
    RAISE EXCEPTION 'cannot promote property %: agent_beacons requires country=US (property has %)', p_property_id, COALESCE(v_country, '<null>') USING ERRCODE = 'P0001';
  END IF;

  v_consent_text := COALESCE(
    nullif(btrim(p_consent_text_override), ''),
    'MAP_ORACLE_PROSPECT: outbound cold outreach from Frontiers3D Map Engine (CAN-SPAM-compliant; recipient may unsubscribe at any time)'
  );

  -- Idempotent path.
  SELECT id, status, source, property_id
    INTO v_existing
    FROM public.agent_beacons
   WHERE lower(email) = lower(v_email) AND lower(city) = lower(v_city)
   LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status = 'unsubscribed' THEN
      RAISE EXCEPTION 'cannot promote property %: beacon % for (%/%) is unsubscribed', p_property_id, v_existing.id, v_email, v_city USING ERRCODE = 'P0001';
    END IF;
    IF v_existing.property_id IS NULL THEN
      UPDATE public.agent_beacons
         SET property_id = p_property_id,
             doorway_payload = public.compose_doorway_payload(p_property_id)
       WHERE id = v_existing.id;
    END IF;
    v_beacon_id := v_existing.id;
  ELSE
    INSERT INTO public.agent_beacons (
      email, name, city, region, zip, country,
      consent_given, consent_text, source, property_id, doorway_payload
    ) VALUES (
      v_email, nullif(btrim(v_name), ''), v_city, v_region, v_zip, v_country,
      FALSE, v_consent_text, 'map_oracle', p_property_id,
      public.compose_doorway_payload(p_property_id)
    )
    RETURNING id INTO v_beacon_id;
  END IF;

  -- Audit linkage to the non-destructive staging PR (if present).
  IF to_regclass('public.candidate_promotions') IS NOT NULL THEN
    UPDATE public.candidate_promotions
       SET status = 'beacon_created', target_beacon_id = v_beacon_id, updated_at = now()
     WHERE property_id = p_property_id AND status = 'requested';
  END IF;

  RETURN v_beacon_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.promote_property_to_beacon(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_property_to_beacon(UUID, TEXT) TO service_role, authenticated;

-- ============================================================
-- End of B3 — Map-Oracle Promotion (DESTRUCTIVE; explicit sign-off required).
-- ============================================================
