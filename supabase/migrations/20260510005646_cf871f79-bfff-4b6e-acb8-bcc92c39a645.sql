-- ============================================================
-- 3DPS Marketplace v2 — PR2: Exclusive 72-Hour Match Window
-- ============================================================

ALTER TABLE public.agent_beacons
  ADD COLUMN IF NOT EXISTS exclusive_provider_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS exclusive_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agent_beacons_exclusive_expiry
  ON public.agent_beacons (exclusive_until)
  WHERE contacted_at IS NULL AND exclusive_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_beacons_exclusive_holder
  ON public.agent_beacons (exclusive_provider_id)
  WHERE exclusive_provider_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.beacon_match_pool (
  beacon_id UUID NOT NULL REFERENCES public.agent_beacons(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempted_at TIMESTAMPTZ,
  PRIMARY KEY (beacon_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_beacon_match_pool_next
  ON public.beacon_match_pool (beacon_id, rank)
  WHERE attempted_at IS NULL;

ALTER TABLE public.beacon_match_pool ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage beacon_match_pool"
    ON public.beacon_match_pool FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read beacon_match_pool"
    ON public.beacon_match_pool FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.beacon_notifications
    DROP CONSTRAINT IF EXISTS beacon_notifications_kind_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.beacon_notifications
  ADD CONSTRAINT beacon_notifications_kind_check
  CHECK (kind IN ('first_match', 'reengagement', 'repool'));

-- Ensure the unique constraint required by ON CONFLICT exists
DO $$ BEGIN
  ALTER TABLE public.beacon_notifications
    ADD CONSTRAINT beacon_notifications_beacon_provider_kind_uniq
    UNIQUE (beacon_id, provider_id, kind);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

UPDATE public.agent_beacons
   SET exclusive_provider_id = matched_provider_id,
       exclusive_until       = COALESCE(matched_at, now()) + interval '72 hours'
 WHERE status = 'matched'
   AND matched_provider_id IS NOT NULL
   AND exclusive_provider_id IS NULL;

CREATE OR REPLACE FUNCTION public.claim_pending_beacon_matches(p_limit INT DEFAULT 10)
RETURNS TABLE (
  beacon_id UUID,
  beacon_email TEXT,
  beacon_name TEXT,
  beacon_city TEXT,
  beacon_region TEXT,
  provider_id UUID,
  provider_email TEXT,
  provider_brand_name TEXT,
  provider_slug TEXT,
  provider_tier public.app_tier,
  provider_custom_domain TEXT,
  exclusive_until TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_beacon RECORD;
  v_inserted INT;
  v_eligible RECORD;
  v_top_provider UUID := NULL;
  v_rank INT;
  v_exclusive_until TIMESTAMPTZ;
BEGIN
  FOR v_beacon IN
    SELECT b.id, b.email, b.name, b.city, b.region, b.zip
    FROM public.agent_beacons b
    WHERE b.status = 'waiting'
      AND b.expires_at > now()
      AND NOT EXISTS (
        SELECT 1 FROM public.beacon_notifications n
        WHERE n.beacon_id = b.id AND n.kind = 'first_match'
      )
    ORDER BY b.created_at ASC
    FOR UPDATE OF b SKIP LOCKED
    LIMIT p_limit
  LOOP
    v_top_provider := NULL;
    v_rank := 0;
    FOR v_eligible IN
      SELECT bs.provider_id,
             bs.brand_name,
             bs.slug,
             bs.tier,
             bs.custom_domain
      FROM public.branding_settings bs
      WHERE bs.is_directory_public = TRUE
        AND public._is_provider_serving_beacon(bs.provider_id, v_beacon.id)
      ORDER BY
        CASE WHEN bs.tier = 'pro' THEN 0 ELSE 1 END,
        bs.created_at ASC NULLS LAST
    LOOP
      v_rank := v_rank + 1;
      IF v_rank = 1 THEN
        INSERT INTO public.beacon_notifications (beacon_id, provider_id, kind)
        VALUES (v_beacon.id, v_eligible.provider_id, 'first_match')
        ON CONFLICT (beacon_id, provider_id, kind) DO NOTHING;

        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        IF v_inserted = 0 THEN
          v_top_provider := NULL;
          EXIT;
        END IF;

        v_top_provider := v_eligible.provider_id;
        v_exclusive_until := now() + interval '72 hours';

        UPDATE public.agent_beacons
           SET status                = 'matched',
               matched_provider_id   = v_eligible.provider_id,
               matched_at            = now(),
               exclusive_provider_id = v_eligible.provider_id,
               exclusive_until       = v_exclusive_until
         WHERE id = v_beacon.id;

        beacon_id              := v_beacon.id;
        beacon_email           := v_beacon.email;
        beacon_name            := v_beacon.name;
        beacon_city            := v_beacon.city;
        beacon_region          := v_beacon.region;
        provider_id            := v_eligible.provider_id;
        provider_email         := (SELECT u.email FROM auth.users u WHERE u.id = v_eligible.provider_id);
        provider_brand_name    := v_eligible.brand_name;
        provider_slug          := v_eligible.slug;
        provider_tier          := v_eligible.tier;
        provider_custom_domain := v_eligible.custom_domain;
        exclusive_until        := v_exclusive_until;
        RETURN NEXT;
      ELSE
        INSERT INTO public.beacon_match_pool (beacon_id, provider_id, rank)
        VALUES (v_beacon.id, v_eligible.provider_id, v_rank)
        ON CONFLICT (beacon_id, provider_id) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_pending_beacon_matches(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pending_beacon_matches(INT) TO service_role;

CREATE OR REPLACE FUNCTION public.repool_expired_exclusives_and_enqueue()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_beacon RECORD;
  v_next RECORD;
  v_repooled INT := 0;
  v_studio_url TEXT;
  v_dashboard_url TEXT := 'https://3dps.transcendencemedia.com';
BEGIN
  FOR v_beacon IN
    SELECT b.id, b.email, b.name, b.city, b.region, b.exclusive_provider_id
    FROM public.agent_beacons b
    WHERE b.status = 'matched'
      AND b.contacted_at IS NULL
      AND b.exclusive_until IS NOT NULL
      AND b.exclusive_until < now()
      AND b.exclusive_provider_id IS NOT NULL
    ORDER BY b.exclusive_until ASC
    FOR UPDATE OF b SKIP LOCKED
    LIMIT 50
  LOOP
    INSERT INTO public.beacon_match_pool (beacon_id, provider_id, rank, attempted_at)
    VALUES (v_beacon.id, v_beacon.exclusive_provider_id, 0, now())
    ON CONFLICT (beacon_id, provider_id)
      DO UPDATE SET attempted_at = COALESCE(public.beacon_match_pool.attempted_at, now());

    SELECT bmp.provider_id, bs.brand_name, bs.slug, bs.tier, bs.custom_domain, u.email AS provider_email
    INTO v_next
    FROM public.beacon_match_pool bmp
    JOIN public.branding_settings bs ON bs.provider_id = bmp.provider_id
    JOIN auth.users u ON u.id = bmp.provider_id
    WHERE bmp.beacon_id = v_beacon.id
      AND bmp.attempted_at IS NULL
      AND bs.is_directory_public = TRUE
    ORDER BY bmp.rank ASC
    LIMIT 1;

    IF v_next.provider_id IS NULL THEN
      UPDATE public.agent_beacons
         SET exclusive_provider_id = NULL, exclusive_until = NULL
       WHERE id = v_beacon.id;
      CONTINUE;
    END IF;

    UPDATE public.agent_beacons
       SET exclusive_provider_id = v_next.provider_id,
           exclusive_until       = now() + interval '72 hours'
     WHERE id = v_beacon.id;

    INSERT INTO public.beacon_notifications (beacon_id, provider_id, kind)
    VALUES (v_beacon.id, v_next.provider_id, 'repool')
    ON CONFLICT (beacon_id, provider_id, kind) DO NOTHING;

    IF v_next.tier = 'pro' AND v_next.custom_domain IS NOT NULL AND length(trim(v_next.custom_domain)) > 0 THEN
      v_studio_url := 'https://' || regexp_replace(v_next.custom_domain, '^https?://', '') || '/p/' || COALESCE(v_next.slug, '');
    ELSIF v_next.slug IS NOT NULL THEN
      v_studio_url := v_dashboard_url || '/p/' || v_next.slug;
    ELSE
      v_studio_url := NULL;
    END IF;

    PERFORM public.enqueue_email(
      'transactional_emails',
      jsonb_build_object(
        'template_name', 'marketplace-lead-assigned',
        'recipient_email', v_next.provider_email,
        'data', jsonb_build_object(
          'providerName', v_next.brand_name,
          'agentName', v_beacon.name,
          'city', CASE WHEN v_beacon.region IS NOT NULL THEN v_beacon.city || ', ' || v_beacon.region ELSE v_beacon.city END,
          'expiresAtIso', (now() + interval '72 hours')::text,
          'dashboardUrl', v_dashboard_url || '/dashboard/marketplace',
          'studioUrl', v_studio_url
        )
      )
    );

    v_repooled := v_repooled + 1;
  END LOOP;
  RETURN v_repooled;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.repool_expired_exclusives_and_enqueue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repool_expired_exclusives_and_enqueue() TO service_role;

DO $$ BEGIN
  PERFORM cron.unschedule('repool_expired_exclusives');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'repool_expired_exclusives',
  '*/30 * * * *',
  $cron$ SELECT public.repool_expired_exclusives_and_enqueue(); $cron$
);

CREATE OR REPLACE FUNCTION public.get_my_matched_beacons()
RETURNS TABLE (
  id UUID,
  name TEXT,
  email TEXT,
  brokerage TEXT,
  city TEXT,
  region TEXT,
  zip TEXT,
  status public.beacon_status,
  created_at TIMESTAMPTZ,
  exclusive_until TIMESTAMPTZ,
  contacted_at TIMESTAMPTZ,
  is_currently_exclusive BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_role(v_uid, 'provider'::public.app_role) THEN
    RAISE EXCEPTION 'provider role required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.licenses l
    WHERE l.user_id = v_uid
      AND l.tier = 'pro'::public.app_tier
      AND l.license_status = 'active'::public.license_status
      AND (l.license_expiry IS NULL OR l.license_expiry > now())
  ) THEN
    RAISE EXCEPTION 'active pro license required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT b.id, b.name, b.email, b.brokerage, b.city, b.region, b.zip, b.status, b.created_at,
    b.exclusive_until, b.contacted_at, (b.exclusive_provider_id = v_uid) AS is_currently_exclusive
  FROM public.agent_beacons b
  WHERE b.status IN ('waiting', 'matched')
    AND b.expires_at > now()
    AND (
      b.exclusive_provider_id = v_uid
      OR EXISTS (
        SELECT 1 FROM public.beacon_match_pool bmp
        WHERE bmp.beacon_id = b.id AND bmp.provider_id = v_uid AND bmp.attempted_at IS NOT NULL
      )
      OR (b.matched_provider_id = v_uid AND b.exclusive_provider_id IS DISTINCT FROM v_uid)
    )
  ORDER BY
    CASE WHEN b.exclusive_provider_id = v_uid AND b.exclusive_until > now() THEN 0 ELSE 1 END,
    b.exclusive_until ASC NULLS LAST,
    b.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_matched_beacons() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_matched_beacons() TO authenticated;
