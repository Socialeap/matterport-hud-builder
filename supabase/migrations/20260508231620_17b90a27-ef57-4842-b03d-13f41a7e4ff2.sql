
-- ============================================================
-- MSP Service Match foundation
--
-- Two visibility windows live on agent_beacons and they are
-- intentionally independent:
--   * exclusive_provider_id / exclusive_until (existing, 72h)
--     drives the private per-MSP lead assignment in
--     claim_pending_beacon_matches. This migration does NOT
--     touch that workflow.
--   * pro_visibility_until (new, 24h) controls what an agent
--     sees on the new public MSP Service Match page only.
-- ============================================================

-- 1. agent_beacons: service preferences + 24h pro window + token
ALTER TABLE public.agent_beacons
  ADD COLUMN IF NOT EXISTS essential_services public.marketplace_specialty[]
    NOT NULL DEFAULT '{}'::public.marketplace_specialty[],
  ADD COLUMN IF NOT EXISTS preferable_services public.marketplace_specialty[]
    NOT NULL DEFAULT '{}'::public.marketplace_specialty[],
  ADD COLUMN IF NOT EXISTS pro_visibility_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS match_token UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_beacons_match_token
  ON public.agent_beacons (match_token);

-- Disjointness: a service may be Essential OR Preferable, never both.
CREATE OR REPLACE FUNCTION public.enforce_service_pref_disjoint()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.essential_services && NEW.preferable_services THEN
    RAISE EXCEPTION 'essential_services and preferable_services must be disjoint'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_beacons_pref_disjoint ON public.agent_beacons;
CREATE TRIGGER trg_agent_beacons_pref_disjoint
  BEFORE INSERT OR UPDATE OF essential_services, preferable_services
  ON public.agent_beacons
  FOR EACH ROW EXECUTE FUNCTION public.enforce_service_pref_disjoint();

-- 2. beacon_notifications.kind: extend allowed values
ALTER TABLE public.beacon_notifications
  DROP CONSTRAINT IF EXISTS beacon_notifications_kind_check;
ALTER TABLE public.beacon_notifications
  ADD CONSTRAINT beacon_notifications_kind_check
  CHECK (kind = ANY (ARRAY[
    'first_match'::text,
    'reengagement'::text,
    'repool'::text,
    'service_match_ready'::text,
    'service_match_expanded'::text
  ]));

-- 3. branding_settings: public directory contact fields
ALTER TABLE public.branding_settings
  ADD COLUMN IF NOT EXISTS directory_website_url TEXT,
  ADD COLUMN IF NOT EXISTS directory_contact_email TEXT,
  ADD COLUMN IF NOT EXISTS directory_phone TEXT;

-- 4. service_match_interest_events: every agent click on the match page
CREATE TABLE IF NOT EXISTS public.service_match_interest_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beacon_id UUID NOT NULL REFERENCES public.agent_beacons(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'notify_msp', 'click_studio', 'click_website', 'click_email', 'click_phone'
  )),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smie_beacon ON public.service_match_interest_events (beacon_id);
CREATE INDEX IF NOT EXISTS idx_smie_provider ON public.service_match_interest_events (provider_id, created_at DESC);

ALTER TABLE public.service_match_interest_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages interest events" ON public.service_match_interest_events;
CREATE POLICY "Service role manages interest events"
  ON public.service_match_interest_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Provider can read own interest events" ON public.service_match_interest_events;
CREATE POLICY "Provider can read own interest events"
  ON public.service_match_interest_events FOR SELECT
  USING (auth.uid() = provider_id);

DROP POLICY IF EXISTS "Admins can read interest events" ON public.service_match_interest_events;
CREATE POLICY "Admins can read interest events"
  ON public.service_match_interest_events FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 5. RPC: get_service_match_summary
-- Public, anon-callable. NEVER returns email/name/brokerage/IP.
DROP FUNCTION IF EXISTS public.get_service_match_summary(UUID);
CREATE OR REPLACE FUNCTION public.get_service_match_summary(p_match_token UUID)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_beacon RECORD;
BEGIN
  IF p_match_token IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT id, city, region, zip, essential_services, preferable_services,
         pro_visibility_until, expires_at, created_at, status
    INTO v_beacon
    FROM public.agent_beacons
   WHERE match_token = p_match_token
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_beacon.expires_at <= now() OR v_beacon.status = 'unsubscribed' THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  RETURN jsonb_build_object(
    'status', 'active',
    'city', v_beacon.city,
    'region', v_beacon.region,
    'zip', v_beacon.zip,
    'essential_services', to_jsonb(v_beacon.essential_services),
    'preferable_services', to_jsonb(v_beacon.preferable_services),
    'pro_visibility_until', v_beacon.pro_visibility_until,
    'expires_at', v_beacon.expires_at,
    'created_at', v_beacon.created_at,
    'is_pro_window', (v_beacon.pro_visibility_until IS NOT NULL AND now() < v_beacon.pro_visibility_until)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_service_match_summary(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_service_match_summary(UUID) TO anon, authenticated;

-- 6. RPC: get_service_match_results
-- Public, anon-callable. Returns only public branding fields.
DROP FUNCTION IF EXISTS public.get_service_match_results(UUID);
CREATE OR REPLACE FUNCTION public.get_service_match_results(p_match_token UUID)
RETURNS TABLE (
  provider_id UUID,
  brand_name TEXT,
  slug TEXT,
  logo_url TEXT,
  tier public.app_tier,
  primary_city TEXT,
  region TEXT,
  directory_website_url TEXT,
  directory_contact_email TEXT,
  directory_phone TEXT,
  matched_essential public.marketplace_specialty[],
  matched_preferable public.marketplace_specialty[],
  missing_preferable public.marketplace_specialty[],
  match_score INT,
  match_quality TEXT
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_beacon RECORD;
  v_in_pro_window BOOLEAN;
BEGIN
  IF p_match_token IS NULL THEN
    RETURN;
  END IF;

  SELECT id, essential_services, preferable_services, pro_visibility_until,
         expires_at, status
    INTO v_beacon
    FROM public.agent_beacons
   WHERE match_token = p_match_token
   LIMIT 1;

  IF NOT FOUND OR v_beacon.expires_at <= now() OR v_beacon.status = 'unsubscribed' THEN
    RETURN;
  END IF;

  v_in_pro_window := v_beacon.pro_visibility_until IS NOT NULL
                     AND now() < v_beacon.pro_visibility_until;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      bs.provider_id,
      bs.brand_name,
      bs.slug,
      bs.logo_url,
      bs.tier,
      bs.primary_city,
      bs.region,
      bs.directory_website_url,
      bs.directory_contact_email,
      bs.directory_phone,
      bs.specialties,
      ARRAY(
        SELECT s FROM unnest(v_beacon.essential_services) AS s
         WHERE s = ANY(bs.specialties)
      )::public.marketplace_specialty[] AS m_essential,
      ARRAY(
        SELECT s FROM unnest(v_beacon.preferable_services) AS s
         WHERE s = ANY(bs.specialties)
      )::public.marketplace_specialty[] AS m_preferable,
      ARRAY(
        SELECT s FROM unnest(v_beacon.preferable_services) AS s
         WHERE NOT (s = ANY(bs.specialties))
      )::public.marketplace_specialty[] AS m_missing
    FROM public.branding_settings bs
    WHERE bs.is_directory_public = TRUE
      AND bs.slug IS NOT NULL
      AND (
        coalesce(array_length(v_beacon.essential_services, 1), 0) = 0
        OR v_beacon.essential_services <@ bs.specialties
      )
      AND (NOT v_in_pro_window OR bs.tier = 'pro'::public.app_tier)
      AND public._is_provider_serving_beacon(bs.provider_id, v_beacon.id)
  )
  SELECT
    c.provider_id,
    c.brand_name,
    c.slug,
    c.logo_url,
    c.tier,
    c.primary_city,
    c.region,
    c.directory_website_url,
    c.directory_contact_email,
    c.directory_phone,
    c.m_essential,
    c.m_preferable,
    c.m_missing,
    coalesce(array_length(c.m_preferable, 1), 0) AS match_score,
    CASE
      WHEN coalesce(array_length(v_beacon.preferable_services, 1), 0) > 0
           AND coalesce(array_length(c.m_missing, 1), 0) = 0 THEN 'complete'
      WHEN coalesce(array_length(c.m_preferable, 1), 0) > 0 THEN 'strong'
      ELSE 'essential'
    END::text AS match_quality
  FROM candidates c
  ORDER BY (c.tier = 'pro'::public.app_tier) DESC,
           coalesce(array_length(c.m_preferable, 1), 0) DESC,
           c.brand_name ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_service_match_results(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_service_match_results(UUID) TO anon, authenticated;

-- 7. RPC: record_service_match_interest
-- Anon-callable. Records a click event. For 'notify_msp', enqueues a
-- single email to the chosen MSP carrying the agent's contact info,
-- but only when the agent gave consent.
DROP FUNCTION IF EXISTS public.record_service_match_interest(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.record_service_match_interest(
  p_match_token UUID,
  p_provider_id UUID,
  p_event_type TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_beacon RECORD;
  v_provider_email TEXT;
  v_brand_name TEXT;
  v_metadata JSONB := '{}'::jsonb;
BEGIN
  IF p_event_type NOT IN ('notify_msp','click_studio','click_website','click_email','click_phone') THEN
    RAISE EXCEPTION 'invalid_event_type' USING ERRCODE = '22023';
  END IF;

  SELECT id, email, name, brokerage, city, region, zip, consent_given,
         essential_services, preferable_services, expires_at, status
    INTO v_beacon
    FROM public.agent_beacons
   WHERE match_token = p_match_token
   LIMIT 1;

  IF NOT FOUND OR v_beacon.expires_at <= now() OR v_beacon.status = 'unsubscribed' THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = '22023';
  END IF;

  -- Provider must be eligible (public, in geo, satisfies essentials)
  IF NOT EXISTS (
    SELECT 1 FROM public.branding_settings bs
     WHERE bs.provider_id = p_provider_id
       AND bs.is_directory_public = TRUE
       AND (
         coalesce(array_length(v_beacon.essential_services, 1), 0) = 0
         OR v_beacon.essential_services <@ bs.specialties
       )
       AND public._is_provider_serving_beacon(bs.provider_id, v_beacon.id)
  ) THEN
    RAISE EXCEPTION 'provider_not_eligible' USING ERRCODE = '22023';
  END IF;

  -- For notify_msp, only attach PII when the agent consented.
  IF p_event_type = 'notify_msp' AND v_beacon.consent_given THEN
    v_metadata := jsonb_build_object(
      'agent_email', v_beacon.email,
      'agent_name', v_beacon.name,
      'brokerage', v_beacon.brokerage,
      'city', v_beacon.city,
      'region', v_beacon.region,
      'zip', v_beacon.zip
    );
  END IF;

  INSERT INTO public.service_match_interest_events
    (beacon_id, provider_id, event_type, metadata)
  VALUES (v_beacon.id, p_provider_id, p_event_type, v_metadata);

  -- Enqueue MSP-facing notify email (only when consented)
  IF p_event_type = 'notify_msp' AND v_beacon.consent_given THEN
    SELECT au.email, bs.brand_name
      INTO v_provider_email, v_brand_name
      FROM auth.users au
      JOIN public.branding_settings bs ON bs.provider_id = au.id
     WHERE au.id = p_provider_id
     LIMIT 1;

    IF v_provider_email IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.suppressed_emails se
          WHERE lower(se.email) = lower(v_provider_email)
       )
    THEN
      PERFORM public.enqueue_email(
        'transactional_emails',
        jsonb_build_object(
          'template_name', 'marketplace-lead-interest',
          'recipient_email', v_provider_email,
          'data', jsonb_build_object(
            'providerName', v_brand_name,
            'agentName', v_beacon.name,
            'agentEmail', v_beacon.email,
            'brokerage', v_beacon.brokerage,
            'city', v_beacon.city,
            'region', v_beacon.region,
            'zip', v_beacon.zip,
            'essentialServices', to_jsonb(v_beacon.essential_services),
            'preferableServices', to_jsonb(v_beacon.preferable_services)
          )
        )
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_service_match_interest(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_service_match_interest(UUID, UUID, TEXT) TO anon, authenticated;
