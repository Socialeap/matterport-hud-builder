-- ============================================================
-- Marketplace v2 — Priority-Based Lead Liquidity (Tiered Routing)
-- ------------------------------------------------------------
-- Replaces the v2 "Pro-only marketplace" gate with a two-stage
-- "Priority/Credibility Lane" model so the marketplace can never
-- present an inoperable provider to an agent.
--
-- Strategic shift:
--   * Pros pay for Exclusivity + Speed (the 24h head start).
--   * Starters serve as the safety-net liquidity layer.
--   * The gatekeeper is Performance, not tier — both tiers must
--     keep their Marketplace Standing >= 0.7 to receive leads.
--
-- Lifecycle of a beacon under the new model:
--
--   t=0    claim_pending_beacon_matches considers ONLY eligible
--          Pros (paid + score >= 0.7 + geo match). Top-ranked
--          Pro becomes exclusive holder for 24h. Other Pros are
--          seeded into beacon_match_pool for analytics. If zero
--          eligible Pros exist, the beacon is leaked immediately
--          (no exclusive holder; visible to all eligible
--          providers in the geo area, Pro or Starter).
--
--   t=24h  leak_expired_pro_windows cron fires every 30 min.
--          Any beacon whose 24h Pro window expired without
--          contact transitions to the open-pool state
--          (leaked_at set, exclusive_provider_id nulled).
--          Visible to all eligible providers (remaining Pros +
--          Starters) in the geo area.
--
--   later  First eligible provider to call send_marketplace_outreach
--          on a leaked beacon claims the lead — the UNIQUE(beacon_id)
--          constraint on marketplace_outreach blocks any second
--          attempt across all providers, not just per-provider.
--
-- Score floor for receiving leads (both tiers): COALESCE(score, 1.0) >= 0.70.
-- New providers default to 1.00 via COALESCE so they're eligible
-- from day one without a pre-seeded responsiveness row.
--
-- Self-contained: this migration replays the 24h interval (#63) and
-- neutral-ghosting score model (#64) so it works regardless of the
-- merge order of those PRs.
-- ============================================================

-- ------------------------------------------------------------
-- 1. agent_beacons: leaked_at column
-- ------------------------------------------------------------
ALTER TABLE public.agent_beacons
  ADD COLUMN IF NOT EXISTS leaked_at TIMESTAMPTZ;

-- Conditional index — the working set of leaked-but-not-yet-claimed
-- leads is small.
CREATE INDEX IF NOT EXISTS idx_agent_beacons_leaked
  ON public.agent_beacons (leaked_at)
  WHERE leaked_at IS NOT NULL AND contacted_at IS NULL;

-- ------------------------------------------------------------
-- 2. marketplace_outreach: tighten UNIQUE to one outreach per beacon
-- ------------------------------------------------------------
-- PR3 had UNIQUE(beacon_id, provider_id) — preventing re-sends from
-- the same provider. Under the open-pool leak model we need a stricter
-- constraint: the FIRST provider to send outreach claims the lead;
-- the database itself blocks any second attempt cross-provider.
-- Pre-launch, no rows exist; constraint swap is safe.
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

-- ------------------------------------------------------------
-- 3. _provider_can_receive_leads — unified eligibility helper
-- ------------------------------------------------------------
-- Centralizes the "active subscription + standing above probation +
-- listed publicly" check so claim, repool/leak, and the viewer RPC
-- all read from the same definition. Tier-agnostic — Starters and
-- Pros both pass when they meet the bar.
CREATE OR REPLACE FUNCTION public._provider_can_receive_leads(
  p_provider_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.branding_settings bs
    LEFT JOIN public.provider_responsiveness pr
      ON pr.provider_id = bs.provider_id
    WHERE bs.provider_id = p_provider_id
      AND bs.is_directory_public = TRUE
      AND public.provider_has_paid_access(p_provider_id)
      AND COALESCE(pr.score, 1.00) >= 0.70
  );
$$;

REVOKE EXECUTE ON FUNCTION public._provider_can_receive_leads(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._provider_can_receive_leads(UUID)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. claim_pending_beacon_matches — two-stage routing
-- ------------------------------------------------------------
-- Stage 1: rank ONLY eligible Pros. Top-ranked becomes exclusive
-- holder for 24h. Others seeded into the pool for analytics.
-- Stage 2 (fall-through): if zero eligible Pros, leak the beacon
-- immediately — no exclusive holder, no email out. Eligible
-- providers (any tier) discover it via the dashboard.
--
-- Idempotency, FOR UPDATE SKIP LOCKED, and the beacon_notifications
-- guard are unchanged from PR2/PR3. The notification row is only
-- inserted on Stage-1 claim — a leaked beacon doesn't need a
-- per-provider notification because status='matched' takes it out
-- of the outer scan's WHERE filter.
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
  v_rank INT;
  v_exclusive_until TIMESTAMPTZ;
  v_pro_claimed BOOLEAN;
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
    v_pro_claimed := FALSE;
    v_rank := 0;

    -- Stage 1: ONLY eligible Pros (tier='pro' AND paid AND
    -- score >= 0.7 AND geo match).
    FOR v_eligible IN
      SELECT bs.provider_id,
             bs.brand_name,
             bs.slug,
             bs.tier,
             bs.custom_domain
      FROM public.branding_settings bs
      LEFT JOIN public.provider_responsiveness pr
        ON pr.provider_id = bs.provider_id
      WHERE bs.is_directory_public = TRUE
        AND bs.tier = 'pro'
        AND public.provider_has_paid_access(bs.provider_id)
        AND COALESCE(pr.score, 1.00) >= 0.70
        AND public._is_provider_serving_beacon(bs.provider_id, v_beacon.id)
      ORDER BY
        COALESCE(pr.score, 1.00) DESC,
        bs.brand_name ASC NULLS LAST
    LOOP
      v_rank := v_rank + 1;

      IF v_rank = 1 THEN
        INSERT INTO public.beacon_notifications (beacon_id, provider_id, kind)
        VALUES (v_beacon.id, v_eligible.provider_id, 'first_match')
        ON CONFLICT (beacon_id, provider_id, kind) DO NOTHING;

        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        IF v_inserted = 0 THEN
          EXIT;
        END IF;

        v_exclusive_until := now() + interval '24 hours';
        v_pro_claimed     := TRUE;

        UPDATE public.agent_beacons
           SET status                = 'matched',
               matched_provider_id   = v_eligible.provider_id,
               matched_at            = now(),
               exclusive_provider_id = v_eligible.provider_id,
               exclusive_until       = v_exclusive_until
         WHERE id = v_beacon.id;

        PERFORM public._update_responsiveness_score(
          v_eligible.provider_id, 0.0, 'received'
        );

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

    -- Stage 2: zero eligible Pros — leak immediately so eligible
    -- Starters (and any future Pros joining the area) can serve
    -- the lead. status='matched' is what takes the beacon out of
    -- the outer claim scan; the notification idempotency rows are
    -- intentionally not inserted here.
    IF NOT v_pro_claimed THEN
      UPDATE public.agent_beacons
         SET status     = 'matched',
             matched_at = now(),
             leaked_at  = now()
       WHERE id = v_beacon.id;
    END IF;
  END LOOP;

  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_pending_beacon_matches(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pending_beacon_matches(INT) TO service_role;

-- ------------------------------------------------------------
-- 5. leak_expired_pro_windows — replaces the PR2 repool
-- ------------------------------------------------------------
-- The cron-driven leaker. Runs every 30 minutes and finds beacons
-- whose 24h Pro window expired without a contact, then marks them
-- as leaked (visible to the open pool of eligible providers in
-- the area).
--
-- We deliberately do NOT enqueue any email at leak time — the
-- open-pool model would either spam every Starter in the area or
-- pick a single one, defeating the open-pool decision. Providers
-- discover leaked leads via the dashboard, which is acceptable
-- because the lead has already had its 24h Pro head start.
CREATE OR REPLACE FUNCTION public.leak_expired_pro_windows()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  WITH leaked AS (
    UPDATE public.agent_beacons
       SET leaked_at             = now(),
           exclusive_provider_id = NULL,
           exclusive_until       = NULL
     WHERE status = 'matched'
       AND contacted_at IS NULL
       AND leaked_at IS NULL
       AND exclusive_until IS NOT NULL
       AND exclusive_until < now()
     RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM leaked;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.leak_expired_pro_windows() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leak_expired_pro_windows() TO service_role;

-- Backward-compat alias: the prior cron schedule named
-- 'repool_expired_exclusives' calls a function with the same name
-- as the PR2 implementation. Replace its body with a thin pass-
-- through so the existing schedule keeps working without us having
-- to atomically swap cron jobs in this migration.
CREATE OR REPLACE FUNCTION public.repool_expired_exclusives_and_enqueue()
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- Renamed in the priority-lane migration. Behavior is now
  -- "leak" rather than "advance to next Pro" — see the
  -- leak_expired_pro_windows function for the implementation.
  SELECT public.leak_expired_pro_windows();
$$;

REVOKE EXECUTE ON FUNCTION public.repool_expired_exclusives_and_enqueue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repool_expired_exclusives_and_enqueue() TO service_role;

-- ------------------------------------------------------------
-- 6. cron schedule — unchanged in cadence, retargeted in name
-- ------------------------------------------------------------
-- The PR2 schedule name 'repool_expired_exclusives' still works
-- because the function alias above forwards to leak_expired_pro_windows.
-- We additionally add a schedule under the new name so future ops
-- read clearly. Both schedules call the same underlying function;
-- the function is idempotent so a duplicate tick is harmless.
DO $$ BEGIN
  PERFORM cron.unschedule('repool_expired_exclusives');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  PERFORM cron.unschedule('leak_expired_pro_windows');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'leak_expired_pro_windows',
  '*/30 * * * *',
  $cron$ SELECT public.leak_expired_pro_windows(); $cron$
);

-- ------------------------------------------------------------
-- 7. get_my_matched_beacons — relaxed eligibility, leaked-lead viz
-- ------------------------------------------------------------
-- Two changes from PR3:
--   * Eligibility check switches from "active Pro license" to the
--     unified _provider_can_receive_leads predicate (paid + score
--     >= 0.7 + listed). Starters now pass.
--   * Visibility predicate adds a "leaked + I qualify (geo)" arm
--     so eligible providers see open-pool leads.
-- A new is_leaked column tells the UI to render the open-lead
-- affordance instead of a countdown.
--
-- Privacy is preserved: a Starter never sees a beacon in another
-- Pro's exclusive window because leaked_at IS NULL during that
-- window. Once leaked, the lead is fair game.
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
  is_currently_exclusive BOOLEAN,
  is_leaked BOOLEAN,
  disposition public.beacon_disposition,
  has_outreach BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(v_uid, 'provider'::public.app_role) THEN
    RAISE EXCEPTION 'provider role required' USING ERRCODE = '42501';
  END IF;
  IF NOT public._provider_can_receive_leads(v_uid) THEN
    RAISE EXCEPTION 'eligibility required: active subscription, public listing, marketplace standing >= 0.7'
      USING ERRCODE = '42501';
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
    (b.exclusive_provider_id = v_uid) AS is_currently_exclusive,
    (b.leaked_at IS NOT NULL AND b.contacted_at IS NULL) AS is_leaked,
    b.disposition,
    EXISTS (
      SELECT 1 FROM public.marketplace_outreach mo
      WHERE mo.beacon_id = b.id AND mo.provider_id = v_uid
    ) AS has_outreach
  FROM public.agent_beacons b
  WHERE b.status IN ('waiting', 'matched')
    AND b.expires_at > now()
    AND (
      -- Currently mine OR I previously held the exclusive
      b.exclusive_provider_id = v_uid
      OR b.matched_provider_id = v_uid
      -- OR the lead is leaked into the open pool AND I match
      -- the geo predicate AND it's still claimable (no contact
      -- yet, or I'm the one who contacted). Starters can never
      -- see un-leaked beacons because of leaked_at IS NOT NULL.
      OR (
        b.leaked_at IS NOT NULL
        AND public._is_provider_serving_beacon(v_uid, b.id)
        AND (
          b.contacted_at IS NULL
          OR EXISTS (
            SELECT 1 FROM public.marketplace_outreach mo
            WHERE mo.beacon_id = b.id AND mo.provider_id = v_uid
          )
        )
      )
    )
  ORDER BY
    -- Active windows first; then open leaked leads; then everything else.
    CASE
      WHEN b.exclusive_provider_id = v_uid AND b.exclusive_until > now() THEN 0
      WHEN b.leaked_at IS NOT NULL AND b.contacted_at IS NULL          THEN 1
      ELSE 2
    END,
    b.exclusive_until ASC NULLS LAST,
    b.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_matched_beacons() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_matched_beacons() TO authenticated;

-- ------------------------------------------------------------
-- 8. send_marketplace_outreach — two-path claim
-- ------------------------------------------------------------
-- Path A (Pro-exclusive): caller currently holds the exclusive
-- on this beacon and the window is still open.
-- Path B (Open-pool / leak): the beacon is leaked, no other
-- provider has sent outreach yet, and the caller passes geo + the
-- unified eligibility predicate.
--
-- Race protection: the UNIQUE(beacon_id) constraint on
-- marketplace_outreach atomically blocks any second send across
-- providers. The FOR UPDATE on agent_beacons inside this function
-- additionally serializes the pre-check. Together they guarantee
-- only one provider can ever claim a leaked lead.
--
-- After a successful Path-B send, the caller becomes the
-- exclusive_provider_id of the beacon (with no expiry — the
-- "ownership" is for disposition tracking only; the cron's leak
-- check skips contacted_at IS NOT NULL beacons regardless).
CREATE OR REPLACE FUNCTION public.send_marketplace_outreach(
  p_beacon_id UUID,
  p_subject TEXT,
  p_body TEXT
)
RETURNS TABLE (
  outreach_id UUID,
  feedback_token UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_beacon RECORD;
  v_can_send BOOLEAN := FALSE;
  v_provider_brand TEXT;
  v_provider_email TEXT;
  v_outreach_id UUID;
  v_feedback_token UUID;
  v_dashboard_url TEXT := 'https://3dps.transcendencemedia.com';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(v_uid, 'provider'::public.app_role) THEN
    RAISE EXCEPTION 'provider role required' USING ERRCODE = '42501';
  END IF;
  IF NOT public._provider_can_receive_leads(v_uid) THEN
    RAISE EXCEPTION 'eligibility required: active subscription, public listing, marketplace standing >= 0.7'
      USING ERRCODE = '42501';
  END IF;

  -- Lock the beacon row so two concurrent composers can't both
  -- pass the "no contact yet" check.
  SELECT b.id,
         b.email,
         b.name,
         b.city,
         b.region,
         b.exclusive_provider_id,
         b.exclusive_until,
         b.leaked_at,
         b.contacted_at
  INTO v_beacon
  FROM public.agent_beacons b
  WHERE b.id = p_beacon_id
  FOR UPDATE;

  IF v_beacon.id IS NULL THEN
    RAISE EXCEPTION 'beacon not found' USING ERRCODE = '42704';
  END IF;
  IF v_beacon.contacted_at IS NOT NULL THEN
    RAISE EXCEPTION 'lead already claimed by another provider' USING ERRCODE = '42710';
  END IF;

  -- Path A: caller holds the exclusive
  IF v_beacon.exclusive_provider_id = v_uid
     AND v_beacon.exclusive_until IS NOT NULL
     AND v_beacon.exclusive_until > now() THEN
    v_can_send := TRUE;
  END IF;

  -- Path B: lead is leaked AND caller serves the geo area
  IF NOT v_can_send
     AND v_beacon.leaked_at IS NOT NULL
     AND public._is_provider_serving_beacon(v_uid, p_beacon_id) THEN
    v_can_send := TRUE;
  END IF;

  IF NOT v_can_send THEN
    RAISE EXCEPTION 'no claim on this lead' USING ERRCODE = '42501';
  END IF;

  IF p_subject IS NULL OR length(trim(p_subject)) < 3 OR length(p_subject) > 200 THEN
    RAISE EXCEPTION 'invalid subject' USING ERRCODE = '22023';
  END IF;
  IF p_body IS NULL OR length(trim(p_body)) < 20 OR length(p_body) > 10000 THEN
    RAISE EXCEPTION 'invalid body' USING ERRCODE = '22023';
  END IF;

  SELECT bs.brand_name INTO v_provider_brand
  FROM public.branding_settings bs WHERE bs.provider_id = v_uid;

  SELECT u.email INTO v_provider_email FROM auth.users u WHERE u.id = v_uid;

  -- UNIQUE(beacon_id) makes this the canonical race winner: any
  -- second provider's INSERT here will trip the unique violation.
  INSERT INTO public.marketplace_outreach (beacon_id, provider_id, subject, body)
  VALUES (p_beacon_id, v_uid, p_subject, p_body)
  RETURNING id, feedback_token INTO v_outreach_id, v_feedback_token;

  -- Stamp ownership + contact. We deliberately leave exclusive_until
  -- NULL on Path B (open-pool claim) — the lead is no longer
  -- time-bounded; contacted_at is what the leak cron checks.
  UPDATE public.agent_beacons
     SET contacted_at          = now(),
         exclusive_provider_id = v_uid
   WHERE id = p_beacon_id;

  PERFORM public._update_responsiveness_score(v_uid, 0.10, 'contacted');

  PERFORM public.enqueue_email(
    'transactional_emails',
    jsonb_build_object(
      'template_name', 'marketplace-outreach',
      'recipient_email', v_beacon.email,
      'data', jsonb_build_object(
        'agentName',    v_beacon.name,
        'mspBrandName', COALESCE(v_provider_brand, 'A 3DPS Marketplace Pro'),
        'replyToEmail', v_provider_email,
        'subject',      p_subject,
        'body',         p_body,
        'feedbackUrl',  v_dashboard_url || '/marketplace/feedback/' || v_feedback_token::text
      )
    )
  );

  outreach_id    := v_outreach_id;
  feedback_token := v_feedback_token;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_marketplace_outreach(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_marketplace_outreach(UUID, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 9. set_beacon_disposition — outreach-row scoped + neutral ghosting
-- ------------------------------------------------------------
-- Caller must be the provider who actually sent the outreach for
-- this beacon (because UNIQUE(beacon_id) on marketplace_outreach,
-- there's at most one such provider per beacon).
--
-- Score model (neutral-ghosting #64):
--   Won           +0.20 (counter: won)
--   Lost           0.00 (no change, no counter)
--   Unresponsive   0.00 (no change, no counter — agent silence isn't
--                        the Pro's behavior; ghost rate stays
--                        queryable from agent_beacons.disposition)
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

  -- Caller must be the provider who actually contacted this lead.
  IF NOT EXISTS (
    SELECT 1 FROM public.marketplace_outreach mo
    WHERE mo.beacon_id = p_beacon_id AND mo.provider_id = v_uid
  ) THEN
    RAISE EXCEPTION 'lead not yours to disposition' USING ERRCODE = '42501';
  END IF;

  SELECT b.id, b.disposition
  INTO v_beacon
  FROM public.agent_beacons b
  WHERE b.id = p_beacon_id;

  v_existed := v_beacon.disposition IS NOT NULL;

  UPDATE public.agent_beacons
     SET disposition        = p_disposition,
         disposition_set_at = now(),
         disposition_set_by = v_uid
   WHERE id = p_beacon_id;

  IF NOT v_existed AND p_disposition = 'won' THEN
    PERFORM public._update_responsiveness_score(v_uid, 0.20, 'won');
  END IF;
  -- 'lost' and 'unresponsive' are both neutral.

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_beacon_disposition(UUID, public.beacon_disposition) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_beacon_disposition(UUID, public.beacon_disposition) TO authenticated;

-- ============================================================
-- End of priority-lane routing migration
-- ============================================================
