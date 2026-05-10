-- Work Order Workflow — Policy & Cron Updates
CREATE OR REPLACE FUNCTION public._count_eligible_pros_for_beacon(
  p_beacon_id UUID
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.branding_settings bs
  JOIN public.agent_beacons b ON b.id = p_beacon_id
  LEFT JOIN public.provider_responsiveness pr ON pr.provider_id = bs.provider_id
  WHERE bs.tier = 'pro'::public.app_tier
    AND bs.is_directory_public = TRUE
    AND public.provider_has_paid_access(bs.provider_id)
    AND COALESCE(pr.score, 1.00) >= 0.70
    AND (
      coalesce(array_length(b.essential_services, 1), 0) = 0
      OR b.essential_services <@ bs.specialties
    )
    AND public._is_provider_serving_beacon(bs.provider_id, b.id);
$$;

REVOKE EXECUTE ON FUNCTION public._count_eligible_pros_for_beacon(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._count_eligible_pros_for_beacon(UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.compute_priority_window_for_beacon(
  p_beacon_id UUID
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public._count_eligible_pros_for_beacon(p_beacon_id) >= 3
      THEN now() + interval '24 hours'
    WHEN public._count_eligible_pros_for_beacon(p_beacon_id) >= 1
      THEN now() + interval '12 hours'
    ELSE NULL
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_priority_window_for_beacon(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_priority_window_for_beacon(UUID)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_service_match_results(UUID);
CREATE OR REPLACE FUNCTION public.get_service_match_results(
  p_match_token UUID
)
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
  match_quality TEXT,
  standing_score NUMERIC,
  standing_label TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_beacon RECORD;
  v_in_pro_window BOOLEAN;
  v_limit INTEGER;
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

  v_limit := CASE WHEN v_in_pro_window THEN 5 ELSE 25 END;

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
      COALESCE(pr.score, 1.00) AS standing_score,
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
    LEFT JOIN public.provider_responsiveness pr ON pr.provider_id = bs.provider_id
    WHERE bs.is_directory_public = TRUE
      AND bs.slug IS NOT NULL
      AND public.provider_has_paid_access(bs.provider_id)
      AND COALESCE(pr.score, 1.00) >= 0.70
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
    END::text AS match_quality,
    c.standing_score,
    CASE
      WHEN c.standing_score >= 1.50 THEN 'excellent'
      WHEN c.standing_score >= 0.70 THEN 'good'
      ELSE 'at_risk'
    END::text AS standing_label
  FROM candidates c
  ORDER BY (c.tier = 'pro'::public.app_tier) DESC,
           c.standing_score DESC,
           random()
  LIMIT v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_service_match_results(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_service_match_results(UUID)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_outreach_feedback(
  p_feedback_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_outreach RECORD;
  v_recent_flag_count INTEGER;
BEGIN
  SELECT mo.id, mo.provider_id, mo.agent_flagged_spam
  INTO v_outreach
  FROM public.marketplace_outreach mo
  WHERE mo.feedback_token = p_feedback_token;

  IF v_outreach.id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_outreach.agent_flagged_spam THEN
    RETURN TRUE;
  END IF;

  UPDATE public.marketplace_outreach
     SET agent_flagged_spam = TRUE,
         agent_flagged_at   = now()
   WHERE id = v_outreach.id;

  PERFORM public._update_responsiveness_score(v_outreach.provider_id, -0.50, NULL);

  SELECT COUNT(*)::INTEGER INTO v_recent_flag_count
    FROM public.marketplace_outreach
   WHERE provider_id = v_outreach.provider_id
     AND agent_flagged_spam = TRUE
     AND agent_flagged_at >= now() - interval '30 days';

  IF v_recent_flag_count >= 2 THEN
    UPDATE public.provider_responsiveness
       SET score = LEAST(score, 0.69),
           updated_at = now()
     WHERE provider_id = v_outreach.provider_id;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_outreach_feedback(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_outreach_feedback(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.get_service_match_summary(p_match_token UUID)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
    'beacon_id', v_beacon.id,
    'city', v_beacon.city,
    'region', v_beacon.region,
    'zip', v_beacon.zip,
    'essential_services', to_jsonb(v_beacon.essential_services),
    'preferable_services', to_jsonb(v_beacon.preferable_services),
    'pro_visibility_until', v_beacon.pro_visibility_until,
    'expires_at', v_beacon.expires_at,
    'created_at', v_beacon.created_at,
    'is_pro_window', (v_beacon.pro_visibility_until IS NOT NULL
                      AND now() < v_beacon.pro_visibility_until)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_service_match_summary(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_service_match_summary(UUID)
  TO anon, authenticated;

DO $$ BEGIN
  PERFORM cron.unschedule('expire_unanswered_invites');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'expire_unanswered_invites',
  '*/5 * * * *',
  $cron$ SELECT public.expire_unanswered_invites(); $cron$
);

DO $$ BEGIN
  PERFORM cron.unschedule('apply_no_disposition_penalties');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;