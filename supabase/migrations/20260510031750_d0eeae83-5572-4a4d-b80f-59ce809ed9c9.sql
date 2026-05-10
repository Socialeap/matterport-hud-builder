ALTER TABLE public.agent_beacons
  ADD COLUMN IF NOT EXISTS leaked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agent_beacons_leaked
  ON public.agent_beacons (leaked_at)
  WHERE leaked_at IS NOT NULL AND contacted_at IS NULL;

DO $$ BEGIN
  ALTER TABLE public.marketplace_outreach
    DROP CONSTRAINT marketplace_outreach_beacon_id_provider_id_key;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.marketplace_outreach
    ADD CONSTRAINT marketplace_outreach_beacon_id_unique UNIQUE (beacon_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._provider_can_receive_leads(p_provider_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.branding_settings bs
    LEFT JOIN public.provider_responsiveness pr ON pr.provider_id = bs.provider_id
    WHERE bs.provider_id = p_provider_id
      AND bs.is_directory_public = TRUE
      AND public.provider_has_paid_access(p_provider_id)
      AND COALESCE(pr.score, 1.00) >= 0.70
  );
$$;
REVOKE EXECUTE ON FUNCTION public._provider_can_receive_leads(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._provider_can_receive_leads(UUID) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.claim_pending_beacon_matches(INT);
CREATE OR REPLACE FUNCTION public.claim_pending_beacon_matches(p_limit INT DEFAULT 10)
RETURNS TABLE (
  beacon_id UUID, beacon_email TEXT, beacon_name TEXT, beacon_city TEXT, beacon_region TEXT,
  provider_id UUID, provider_email TEXT, provider_brand_name TEXT, provider_slug TEXT,
  provider_tier public.app_tier, provider_custom_domain TEXT, exclusive_until TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_beacon RECORD; v_inserted INT; v_eligible RECORD; v_rank INT;
  v_exclusive_until TIMESTAMPTZ; v_pro_claimed BOOLEAN;
BEGIN
  FOR v_beacon IN
    SELECT b.id, b.email, b.name, b.city, b.region, b.zip
    FROM public.agent_beacons b
    WHERE b.status = 'waiting' AND b.expires_at > now()
      AND NOT EXISTS (SELECT 1 FROM public.beacon_notifications n WHERE n.beacon_id = b.id AND n.kind = 'first_match')
    ORDER BY b.created_at ASC FOR UPDATE OF b SKIP LOCKED LIMIT p_limit
  LOOP
    v_pro_claimed := FALSE; v_rank := 0;
    FOR v_eligible IN
      SELECT bs.provider_id, bs.brand_name, bs.slug, bs.tier, bs.custom_domain
      FROM public.branding_settings bs
      LEFT JOIN public.provider_responsiveness pr ON pr.provider_id = bs.provider_id
      WHERE bs.is_directory_public = TRUE AND bs.tier = 'pro'
        AND public.provider_has_paid_access(bs.provider_id)
        AND COALESCE(pr.score, 1.00) >= 0.70
        AND public._is_provider_serving_beacon(bs.provider_id, v_beacon.id)
      ORDER BY COALESCE(pr.score, 1.00) DESC, bs.brand_name ASC NULLS LAST
    LOOP
      v_rank := v_rank + 1;
      IF v_rank = 1 THEN
        INSERT INTO public.beacon_notifications (beacon_id, provider_id, kind)
        VALUES (v_beacon.id, v_eligible.provider_id, 'first_match')
        ON CONFLICT (beacon_id, provider_id, kind) DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        IF v_inserted = 0 THEN EXIT; END IF;
        v_exclusive_until := now() + interval '24 hours';
        v_pro_claimed := TRUE;
        UPDATE public.agent_beacons
           SET status='matched', matched_provider_id=v_eligible.provider_id,
               matched_at=now(), exclusive_provider_id=v_eligible.provider_id,
               exclusive_until=v_exclusive_until
         WHERE id = v_beacon.id;
        PERFORM public._update_responsiveness_score(v_eligible.provider_id, 0.0, 'received');
        beacon_id := v_beacon.id; beacon_email := v_beacon.email; beacon_name := v_beacon.name;
        beacon_city := v_beacon.city; beacon_region := v_beacon.region;
        provider_id := v_eligible.provider_id;
        provider_email := (SELECT u.email FROM auth.users u WHERE u.id = v_eligible.provider_id);
        provider_brand_name := v_eligible.brand_name; provider_slug := v_eligible.slug;
        provider_tier := v_eligible.tier; provider_custom_domain := v_eligible.custom_domain;
        exclusive_until := v_exclusive_until;
        RETURN NEXT;
      ELSE
        INSERT INTO public.beacon_match_pool (beacon_id, provider_id, rank)
        VALUES (v_beacon.id, v_eligible.provider_id, v_rank)
        ON CONFLICT (beacon_id, provider_id) DO NOTHING;
      END IF;
    END LOOP;
    IF NOT v_pro_claimed THEN
      UPDATE public.agent_beacons SET status='matched', matched_at=now(), leaked_at=now() WHERE id = v_beacon.id;
    END IF;
  END LOOP;
  RETURN;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_pending_beacon_matches(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pending_beacon_matches(INT) TO service_role;

CREATE OR REPLACE FUNCTION public.leak_expired_pro_windows()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count INT;
BEGIN
  WITH leaked AS (
    UPDATE public.agent_beacons
       SET leaked_at=now(), exclusive_provider_id=NULL, exclusive_until=NULL
     WHERE status='matched' AND contacted_at IS NULL AND leaked_at IS NULL
       AND exclusive_until IS NOT NULL AND exclusive_until < now()
     RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM leaked;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.leak_expired_pro_windows() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leak_expired_pro_windows() TO service_role;

CREATE OR REPLACE FUNCTION public.repool_expired_exclusives_and_enqueue()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT public.leak_expired_pro_windows(); $$;
REVOKE EXECUTE ON FUNCTION public.repool_expired_exclusives_and_enqueue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repool_expired_exclusives_and_enqueue() TO service_role;

DO $$ BEGIN PERFORM cron.unschedule('repool_expired_exclusives'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('leak_expired_pro_windows'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('leak_expired_pro_windows','*/30 * * * *',$cron$ SELECT public.leak_expired_pro_windows(); $cron$);

DROP FUNCTION IF EXISTS public.get_my_matched_beacons();
CREATE OR REPLACE FUNCTION public.get_my_matched_beacons()
RETURNS TABLE (
  id UUID, name TEXT, email TEXT, brokerage TEXT, city TEXT, region TEXT, zip TEXT,
  status public.beacon_status, created_at TIMESTAMPTZ, exclusive_until TIMESTAMPTZ,
  contacted_at TIMESTAMPTZ, is_currently_exclusive BOOLEAN, is_leaked BOOLEAN,
  disposition public.beacon_disposition, has_outreach BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
  IF NOT public.has_role(v_uid,'provider'::public.app_role) THEN RAISE EXCEPTION 'provider role required' USING ERRCODE='42501'; END IF;
  IF NOT public._provider_can_receive_leads(v_uid) THEN
    RAISE EXCEPTION 'eligibility required: active subscription, public listing, marketplace standing >= 0.7' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT b.id, b.name, b.email, b.brokerage, b.city, b.region, b.zip, b.status, b.created_at,
    b.exclusive_until, b.contacted_at,
    (b.exclusive_provider_id = v_uid),
    (b.leaked_at IS NOT NULL AND b.contacted_at IS NULL),
    b.disposition,
    EXISTS (SELECT 1 FROM public.marketplace_outreach mo WHERE mo.beacon_id=b.id AND mo.provider_id=v_uid)
  FROM public.agent_beacons b
  WHERE b.status IN ('waiting','matched') AND b.expires_at > now()
    AND (
      b.exclusive_provider_id = v_uid OR b.matched_provider_id = v_uid
      OR (b.leaked_at IS NOT NULL AND public._is_provider_serving_beacon(v_uid, b.id)
          AND (b.contacted_at IS NULL OR EXISTS (SELECT 1 FROM public.marketplace_outreach mo WHERE mo.beacon_id=b.id AND mo.provider_id=v_uid)))
    )
  ORDER BY
    CASE WHEN b.exclusive_provider_id=v_uid AND b.exclusive_until > now() THEN 0
         WHEN b.leaked_at IS NOT NULL AND b.contacted_at IS NULL THEN 1 ELSE 2 END,
    b.exclusive_until ASC NULLS LAST, b.created_at DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_matched_beacons() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_matched_beacons() TO authenticated;

CREATE OR REPLACE FUNCTION public.send_marketplace_outreach(p_beacon_id UUID, p_subject TEXT, p_body TEXT)
RETURNS TABLE (outreach_id UUID, feedback_token UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid(); v_beacon RECORD; v_can_send BOOLEAN := FALSE;
  v_provider_brand TEXT; v_provider_email TEXT; v_outreach_id UUID; v_feedback_token UUID;
  v_dashboard_url TEXT := 'https://3dps.transcendencemedia.com';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
  IF NOT public.has_role(v_uid,'provider'::public.app_role) THEN RAISE EXCEPTION 'provider role required' USING ERRCODE='42501'; END IF;
  IF NOT public._provider_can_receive_leads(v_uid) THEN
    RAISE EXCEPTION 'eligibility required: active subscription, public listing, marketplace standing >= 0.7' USING ERRCODE='42501';
  END IF;
  SELECT b.id,b.email,b.name,b.city,b.region,b.exclusive_provider_id,b.exclusive_until,b.leaked_at,b.contacted_at
  INTO v_beacon FROM public.agent_beacons b WHERE b.id=p_beacon_id FOR UPDATE;
  IF v_beacon.id IS NULL THEN RAISE EXCEPTION 'beacon not found' USING ERRCODE='42704'; END IF;
  IF v_beacon.contacted_at IS NOT NULL THEN RAISE EXCEPTION 'lead already claimed by another provider' USING ERRCODE='42710'; END IF;
  IF v_beacon.exclusive_provider_id=v_uid AND v_beacon.exclusive_until IS NOT NULL AND v_beacon.exclusive_until > now() THEN v_can_send := TRUE; END IF;
  IF NOT v_can_send AND v_beacon.leaked_at IS NOT NULL AND public._is_provider_serving_beacon(v_uid, p_beacon_id) THEN v_can_send := TRUE; END IF;
  IF NOT v_can_send THEN RAISE EXCEPTION 'no claim on this lead' USING ERRCODE='42501'; END IF;
  IF p_subject IS NULL OR length(trim(p_subject)) < 3 OR length(p_subject) > 200 THEN RAISE EXCEPTION 'invalid subject' USING ERRCODE='22023'; END IF;
  IF p_body IS NULL OR length(trim(p_body)) < 20 OR length(p_body) > 10000 THEN RAISE EXCEPTION 'invalid body' USING ERRCODE='22023'; END IF;
  SELECT bs.brand_name INTO v_provider_brand FROM public.branding_settings bs WHERE bs.provider_id=v_uid;
  SELECT u.email INTO v_provider_email FROM auth.users u WHERE u.id=v_uid;
  INSERT INTO public.marketplace_outreach (beacon_id, provider_id, subject, body)
  VALUES (p_beacon_id, v_uid, p_subject, p_body) RETURNING id, feedback_token INTO v_outreach_id, v_feedback_token;
  UPDATE public.agent_beacons SET contacted_at=now(), exclusive_provider_id=v_uid WHERE id=p_beacon_id;
  PERFORM public._update_responsiveness_score(v_uid, 0.10, 'contacted');
  PERFORM public.enqueue_email('transactional_emails', jsonb_build_object(
    'template_name','marketplace-outreach','recipient_email', v_beacon.email,
    'data', jsonb_build_object('agentName',v_beacon.name,'mspBrandName',COALESCE(v_provider_brand,'A 3DPS Marketplace Pro'),
      'replyToEmail',v_provider_email,'subject',p_subject,'body',p_body,
      'feedbackUrl', v_dashboard_url || '/marketplace/feedback/' || v_feedback_token::text)));
  outreach_id := v_outreach_id; feedback_token := v_feedback_token; RETURN NEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.send_marketplace_outreach(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_marketplace_outreach(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_beacon_disposition(p_beacon_id UUID, p_disposition public.beacon_disposition)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid UUID := auth.uid(); v_beacon RECORD; v_existed BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
  IF NOT public.has_role(v_uid,'provider'::public.app_role) THEN RAISE EXCEPTION 'provider role required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.marketplace_outreach mo WHERE mo.beacon_id=p_beacon_id AND mo.provider_id=v_uid) THEN
    RAISE EXCEPTION 'lead not yours to disposition' USING ERRCODE='42501';
  END IF;
  SELECT b.id, b.disposition INTO v_beacon FROM public.agent_beacons b WHERE b.id=p_beacon_id;
  v_existed := v_beacon.disposition IS NOT NULL;
  UPDATE public.agent_beacons SET disposition=p_disposition, disposition_set_at=now(), disposition_set_by=v_uid WHERE id=p_beacon_id;
  IF NOT v_existed AND p_disposition='won' THEN PERFORM public._update_responsiveness_score(v_uid, 0.20, 'won'); END IF;
  RETURN TRUE;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_beacon_disposition(UUID, public.beacon_disposition) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_beacon_disposition(UUID, public.beacon_disposition) TO authenticated;