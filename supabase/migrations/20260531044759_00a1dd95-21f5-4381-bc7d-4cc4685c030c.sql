DO $$ BEGIN
  IF to_regprocedure('public.compose_doorway_payload(uuid)') IS NULL THEN
    RAISE EXCEPTION 'B3 requires B2 (compose_doorway_payload) — apply B2 first.';
  END IF;
END $$;

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

ALTER TABLE public.agent_beacons
  DROP CONSTRAINT IF EXISTS agent_beacons_consent_required;

ALTER TABLE public.agent_beacons
  ADD CONSTRAINT agent_beacons_consent_required
  CHECK (
    (source = 'agent_form' AND consent_given = TRUE  AND length(consent_text) > 0)
    OR
    (source = 'map_oracle' AND property_id IS NOT NULL AND length(consent_text) > 0)
  );

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