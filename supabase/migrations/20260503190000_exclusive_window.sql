-- ============================================================
-- 3DPS Marketplace v2 — PR2: Exclusive 72-Hour Match Window
-- ------------------------------------------------------------
-- Eliminates parallel cold-outreach to the same agent. Each new
-- beacon gets a single exclusive Pro for 72 hours; if that Pro
-- doesn't contact the agent inside the window, the lead re-pools
-- to the next-ranked Pro automatically.
--
-- Schema:
--   * agent_beacons gets exclusive_provider_id, exclusive_until,
--     contacted_at
--   * beacon_match_pool table tracks the prioritized queue of
--     next-up Pros so re-pooling doesn't have to re-run the
--     four-tier geo predicate
--
-- Logic:
--   * claim_pending_beacon_matches now ranks ALL eligible Pros
--     (Pro before Starter, oldest listing wins; PR3 will plug
--     in the responsiveness score), takes the top one as the
--     exclusive holder, and seeds the rest into beacon_match_pool
--   * repool_expired_exclusives_and_enqueue() runs every 30 min
--     via pg_cron: for any beacon whose window expired without a
--     contact, advance to the next-ranked un-attempted Pro and
--     enqueue a marketplace-lead-assigned email
--   * get_my_matched_beacons return shape gains exclusive_until,
--     contacted_at, is_currently_exclusive — drops the now-
--     meaningless is_first_match_with_me flag
--
-- Backfill:
--   * Existing beacons in 'matched' state get
--     exclusive_provider_id = matched_provider_id and
--     exclusive_until = matched_at + 72h. Old matches end up
--     already-expired so the next cron run repools them; recent
--     matches keep their natural window.
-- ============================================================

-- ------------------------------------------------------------
-- 1. agent_beacons: exclusive-window columns
-- ------------------------------------------------------------
ALTER TABLE public.agent_beacons
  ADD COLUMN IF NOT EXISTS exclusive_provider_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS exclusive_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMPTZ;

-- Cron lookup: find expired exclusives that haven't been contacted.
-- Conditional index keeps it small — the working set is tiny.
CREATE INDEX IF NOT EXISTS idx_agent_beacons_exclusive_expiry
  ON public.agent_beacons (exclusive_until)
  WHERE contacted_at IS NULL AND exclusive_until IS NOT NULL;

-- UI lookup: find all beacons currently or formerly held by a Pro.
CREATE INDEX IF NOT EXISTS idx_agent_beacons_exclusive_holder
  ON public.agent_beacons (exclusive_provider_id)
  WHERE exclusive_provider_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2. beacon_match_pool: prioritized queue of next-up Pros
-- ------------------------------------------------------------
-- Populated when claim_pending_beacon_matches first matches a
-- beacon: top-ranked Pro becomes exclusive_provider_id, the rest
-- go here. Re-pooling reads from the lowest un-attempted rank.
--
-- attempted_at marks Pros who've already held the exclusive (and
-- either timed out or got re-pooled past). Re-pool never
-- re-promotes a Pro who already had a turn.
CREATE TABLE IF NOT EXISTS public.beacon_match_pool (
  beacon_id UUID NOT NULL REFERENCES public.agent_beacons(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempted_at TIMESTAMPTZ,
  PRIMARY KEY (beacon_id, provider_id)
);

-- Re-pool's hot path: lowest-rank un-attempted Pro for a beacon.
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

-- Pros do NOT get direct read access. Their queue position is
-- intentionally invisible — they only learn they have a lead
-- when the exclusive arrives. Same privacy stance as v1.

-- ------------------------------------------------------------
-- 3. beacon_notifications: allow new 'repool' kind
-- ------------------------------------------------------------
-- The kind column is a CHECK-constrained text. Drop and re-add
-- the constraint to permit the new value without touching the
-- existing rows.
DO $$ BEGIN
  ALTER TABLE public.beacon_notifications
    DROP CONSTRAINT IF EXISTS beacon_notifications_kind_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.beacon_notifications
  ADD CONSTRAINT beacon_notifications_kind_check
  CHECK (kind IN ('first_match', 'reengagement', 'repool'));

-- ------------------------------------------------------------
-- 4. Backfill existing matches into the exclusive model
-- ------------------------------------------------------------
-- Every currently-matched beacon needs an exclusive_provider_id
-- so the new code paths see a coherent state. We give them a
-- 72-hour window starting from matched_at — recent matches stay
-- live, old ones end up already-expired and get repooled by the
-- next cron tick.
UPDATE public.agent_beacons
   SET exclusive_provider_id = matched_provider_id,
       exclusive_until       = COALESCE(matched_at, now()) + interval '72 hours'
 WHERE status = 'matched'
   AND matched_provider_id IS NOT NULL
   AND exclusive_provider_id IS NULL;

-- ------------------------------------------------------------
-- 5. claim_pending_beacon_matches — exclusive-aware
-- ------------------------------------------------------------
-- For each waiting beacon:
--   * find ALL eligible Pros via the PR1 four-tier predicate,
--     ranked Pro-before-Starter then oldest listing (PR3 will
--     replace this with a responsiveness-score tie-break)
--   * top-ranked becomes exclusive_provider_id with a 72h window
--   * remaining Pros are seeded into beacon_match_pool with
--     sequential ranks for re-pooling
--   * matched_provider_id is set as a permanent first-match audit
--     record (separate from the mutable exclusive_provider_id)
--   * provider_email is returned so match-beacons can send the
--     Pro-side marketplace-lead-assigned notification
--
-- Concurrency: outer FOR UPDATE SKIP LOCKED + ON CONFLICT on
-- beacon_notifications keeps parallel runs collision-free.
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
    -- Materialize the ranked eligible-Pro list once per beacon.
    -- Top of the list becomes the exclusive holder; the tail goes
    -- into beacon_match_pool.
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
        -- Atomic claim of the first-match notification. If another
        -- parallel run beat us to this beacon we simply move on.
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
        -- Seed the rest into the pool. ON CONFLICT means a second
        -- claim for the same beacon (shouldn't happen given the
        -- first-match guard above) is a no-op.
        INSERT INTO public.beacon_match_pool (beacon_id, provider_id, rank)
        VALUES (v_beacon.id, v_eligible.provider_id, v_rank)
        ON CONFLICT (beacon_id, provider_id) DO NOTHING;
      END IF;
    END LOOP;

    -- If no eligible Pros at all, leave the beacon in 'waiting'
    -- — a future Pro flipping is_directory_public will be picked
    -- up by the next match-beacons invocation.
  END LOOP;

  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_pending_beacon_matches(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pending_beacon_matches(INT) TO service_role;

-- ------------------------------------------------------------
-- 6. repool_expired_exclusives_and_enqueue
-- ------------------------------------------------------------
-- The cron-driven re-pooler. Runs every 30 minutes and:
--
--   1. Finds beacons whose exclusive window expired without a
--      contact (exclusive_until < now() AND contacted_at IS NULL)
--      and whose match is still active (status='matched').
--   2. For each (FOR UPDATE SKIP LOCKED): mark the current holder
--      as attempted in beacon_match_pool, advance to the next
--      un-attempted Pro by lowest rank.
--   3. If found, set them as the new exclusive holder with a
--      fresh 72h window and enqueue a marketplace-lead-assigned
--      email.
--   4. If pool is exhausted, null out exclusive_provider_id /
--      exclusive_until so the cron stops processing the beacon.
--      The lead just sits dormant rather than being expired —
--      a future Pro could be added to its pool by a separate
--      mechanism if we ever want that.
--
-- Returns the count of repooled beacons for cron-log visibility.
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
    -- Stamp the previous holder as attempted. Insert-on-conflict
    -- handles the case where the prior holder wasn't in the pool
    -- (they were the original first-match top-rank).
    INSERT INTO public.beacon_match_pool (beacon_id, provider_id, rank, attempted_at)
    VALUES (v_beacon.id, v_beacon.exclusive_provider_id, 0, now())
    ON CONFLICT (beacon_id, provider_id)
      DO UPDATE SET attempted_at = COALESCE(public.beacon_match_pool.attempted_at, now());

    -- Pick the next un-attempted Pro from the pool.
    SELECT bmp.provider_id,
           bs.brand_name,
           bs.slug,
           bs.tier,
           bs.custom_domain,
           u.email AS provider_email
    INTO v_next
    FROM public.beacon_match_pool bmp
    JOIN public.branding_settings bs ON bs.provider_id = bmp.provider_id
    JOIN auth.users u ON u.id = bmp.provider_id
    WHERE bmp.beacon_id = v_beacon.id
      AND bmp.attempted_at IS NULL
      AND bs.is_directory_public = TRUE  -- exclude Pros who un-listed
    ORDER BY bmp.rank ASC
    LIMIT 1;

    IF v_next.provider_id IS NULL THEN
      -- Pool exhausted; stop processing this beacon by nulling the
      -- exclusive window. Status stays 'matched' as audit trail of
      -- the original claim.
      UPDATE public.agent_beacons
         SET exclusive_provider_id = NULL,
             exclusive_until       = NULL
       WHERE id = v_beacon.id;
      CONTINUE;
    END IF;

    -- Promote the next Pro: 72h window, repool notification row,
    -- enqueue the assignment email.
    UPDATE public.agent_beacons
       SET exclusive_provider_id = v_next.provider_id,
           exclusive_until       = now() + interval '72 hours'
     WHERE id = v_beacon.id;

    INSERT INTO public.beacon_notifications (beacon_id, provider_id, kind)
    VALUES (v_beacon.id, v_next.provider_id, 'repool')
    ON CONFLICT (beacon_id, provider_id, kind) DO NOTHING;

    -- Construct the studio URL the Pro can land on. Mirrors the
    -- buildStudioUrl logic in match-beacons/index.ts: Pro tier
    -- with a custom domain uses that domain; otherwise the
    -- shared dashboard host.
    IF v_next.tier = 'pro'
       AND v_next.custom_domain IS NOT NULL
       AND length(trim(v_next.custom_domain)) > 0 THEN
      v_studio_url := 'https://' || regexp_replace(v_next.custom_domain, '^https?://', '')
                      || '/p/' || COALESCE(v_next.slug, '');
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
          'city', CASE
                    WHEN v_beacon.region IS NOT NULL
                      THEN v_beacon.city || ', ' || v_beacon.region
                    ELSE v_beacon.city
                  END,
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

-- ------------------------------------------------------------
-- 7. cron schedule
-- ------------------------------------------------------------
-- Run every 30 minutes. Idempotent: drop any prior schedule with
-- the same name first, then re-create.
DO $$ BEGIN
  PERFORM cron.unschedule('repool_expired_exclusives');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'repool_expired_exclusives',
  '*/30 * * * *',
  $cron$ SELECT public.repool_expired_exclusives_and_enqueue(); $cron$
);

-- ------------------------------------------------------------
-- 8. get_my_matched_beacons — exclusive-aware return shape
-- ------------------------------------------------------------
-- Drops is_first_match_with_me (no longer meaningful — every
-- visible beacon was once exclusively the caller's). Adds
-- exclusive_until, contacted_at, is_currently_exclusive so the
-- UI can bucket rows into Active / Awaiting / Past sections.
--
-- Visibility rule: a Pro sees a beacon iff they are the current
-- exclusive holder OR they previously held the exclusive (audit
-- trail). Pool members who never got promoted stay invisible.
DROP FUNCTION IF EXISTS public.get_my_matched_beacons();

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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
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
  SELECT
    b.id,
    b.name,
    b.email,
    b.brokerage,
    b.city,
    b.region,
    b.zip,
    b.status,
    b.created_at,
    b.exclusive_until,
    b.contacted_at,
    (b.exclusive_provider_id = v_uid) AS is_currently_exclusive
  FROM public.agent_beacons b
  WHERE b.status IN ('waiting', 'matched')
    AND b.expires_at > now()
    AND (
      -- Currently mine
      b.exclusive_provider_id = v_uid
      -- Or I previously held the exclusive (in the pool with
      -- attempted_at set, or I was the original matched_provider_id
      -- and someone else holds it now)
      OR EXISTS (
        SELECT 1 FROM public.beacon_match_pool bmp
        WHERE bmp.beacon_id = b.id
          AND bmp.provider_id = v_uid
          AND bmp.attempted_at IS NOT NULL
      )
      OR (
        b.matched_provider_id = v_uid
        AND b.exclusive_provider_id IS DISTINCT FROM v_uid
      )
    )
  ORDER BY
    -- Active windows surface first, ordered by least-time-remaining;
    -- then everything else by recency.
    CASE WHEN b.exclusive_provider_id = v_uid AND b.exclusive_until > now() THEN 0 ELSE 1 END,
    b.exclusive_until ASC NULLS LAST,
    b.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_matched_beacons() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_matched_beacons() TO authenticated;

-- ============================================================
-- End of exclusive-window migration
-- ============================================================
