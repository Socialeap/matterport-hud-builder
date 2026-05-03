-- ============================================================
-- 3DPS Marketplace v2 — PR3: Composer + Soft Disposition
-- ------------------------------------------------------------
-- Adds the "light CRM" layer on top of the brand-protection
-- engine from PR1+PR2:
--   * In-dashboard outreach composer (server-rendered through
--     the existing email queue) replaces the mailto: handoff.
--   * Soft disposition tracking — Pros mark each lead Won, Lost,
--     or Unresponsive. Used to compute a responsiveness score
--     that re-ranks future eligible-Pro lookups (PR2's tie-break
--     is now score-aware).
--   * Agent-side feedback link in the outreach footer flips an
--     'inappropriate outreach' flag and applies a stronger score
--     penalty. The feedback flow is POST-on-confirm (handled in
--     the route file) so email previewers / Outlook SafeLinks
--     can't accidentally trigger the penalty by prefetching GET.
--   * Two daily cron jobs:
--       - apply 14-day no-disposition penalties
--       - null out outreach.body 14 days after send (keep the
--         audit row, drop the PII)
--
-- Deferred design choices that were called out earlier in the
-- bundle review and confirmed in this PR:
--   * NO replied_at column on outreach — there's no inbound mail
--     handler in this codebase, so the column would always be
--     NULL.
--   * outreach.body has a 14-day TTL rather than indefinite
--     plaintext retention.
--   * Score floors at 0.0 and ceilings at 2.0; the standing
--     badge shows Excellent / Good / At Risk thresholds, not the
--     raw number.
-- ============================================================

-- ------------------------------------------------------------
-- 1. disposition enum + columns on agent_beacons
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.beacon_disposition AS ENUM (
    'won',
    'lost',
    'unresponsive'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.agent_beacons
  ADD COLUMN IF NOT EXISTS disposition         public.beacon_disposition,
  ADD COLUMN IF NOT EXISTS disposition_set_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disposition_set_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 2. provider_responsiveness — rolling score per Pro
-- ------------------------------------------------------------
-- Score starts at 1.0 (neutral). Bounded [0.0, 2.0] so a single
-- bad event can't kill a Pro and a streak of good events can't
-- inflate them past usefulness. Adjustments are applied via the
-- _update_responsiveness_score helper below.
--
-- The counters (leads_received / contacted / won / expired) are
-- separate from the score so we can later replace the formula
-- without losing history.
CREATE TABLE IF NOT EXISTS public.provider_responsiveness (
  provider_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  score            NUMERIC(4, 2) NOT NULL DEFAULT 1.00,
  leads_received   INTEGER NOT NULL DEFAULT 0,
  leads_contacted  INTEGER NOT NULL DEFAULT 0,
  leads_won        INTEGER NOT NULL DEFAULT 0,
  leads_expired    INTEGER NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.provider_responsiveness
    ADD CONSTRAINT provider_responsiveness_score_bounds
    CHECK (score >= 0.0 AND score <= 2.0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.provider_responsiveness ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage provider_responsiveness"
    ON public.provider_responsiveness FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Pros can read their own row (powers the standing badge).
DO $$ BEGIN
  CREATE POLICY "Providers can read own responsiveness"
    ON public.provider_responsiveness FOR SELECT
    USING (auth.uid() = provider_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read all responsiveness"
    ON public.provider_responsiveness FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------
-- 3. marketplace_outreach — the composed-and-sent record
-- ------------------------------------------------------------
-- One row per (beacon_id, provider_id). Re-sends are not
-- supported; the composer UI hides the affordance once a row
-- exists. The body column is plaintext at write time but the
-- daily cleanup cron nulls it after 14 days, preserving the
-- audit row without retaining the PII indefinitely.
CREATE TABLE IF NOT EXISTS public.marketplace_outreach (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beacon_id           UUID NOT NULL REFERENCES public.agent_beacons(id) ON DELETE CASCADE,
  provider_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject             TEXT NOT NULL,
  body                TEXT,
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  email_send_log_id   UUID REFERENCES public.email_send_log(id) ON DELETE SET NULL,
  agent_flagged_spam  BOOLEAN NOT NULL DEFAULT FALSE,
  agent_flagged_at    TIMESTAMPTZ,
  penalty_applied_at  TIMESTAMPTZ,
  feedback_token      UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (beacon_id, provider_id),
  UNIQUE (feedback_token)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_outreach_provider
  ON public.marketplace_outreach (provider_id);

-- Hot path for the body-TTL cron and the no-disposition cron.
CREATE INDEX IF NOT EXISTS idx_marketplace_outreach_sent_at
  ON public.marketplace_outreach (sent_at)
  WHERE penalty_applied_at IS NULL OR body IS NOT NULL;

ALTER TABLE public.marketplace_outreach ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage marketplace_outreach"
    ON public.marketplace_outreach FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Providers can read own outreach"
    ON public.marketplace_outreach FOR SELECT
    USING (auth.uid() = provider_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read all outreach"
    ON public.marketplace_outreach FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------
-- 4. _update_responsiveness_score — internal helper
-- ------------------------------------------------------------
-- Applies a delta to the provider's score, clamps to [0.0, 2.0],
-- and bumps the appropriate counter. UPSERTs so we never have to
-- pre-seed a row for a provider — the first event that touches
-- them creates it.
--
-- p_counter values: 'received', 'contacted', 'won', 'expired',
-- or NULL if no counter applies (e.g. spam-flag penalty).
CREATE OR REPLACE FUNCTION public._update_responsiveness_score(
  p_provider_id UUID,
  p_delta NUMERIC,
  p_counter TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.provider_responsiveness (
    provider_id,
    score,
    leads_received,
    leads_contacted,
    leads_won,
    leads_expired,
    updated_at
  ) VALUES (
    p_provider_id,
    GREATEST(0.0, LEAST(2.0, 1.00 + p_delta)),
    CASE WHEN p_counter = 'received'  THEN 1 ELSE 0 END,
    CASE WHEN p_counter = 'contacted' THEN 1 ELSE 0 END,
    CASE WHEN p_counter = 'won'       THEN 1 ELSE 0 END,
    CASE WHEN p_counter = 'expired'   THEN 1 ELSE 0 END,
    now()
  )
  ON CONFLICT (provider_id) DO UPDATE
    SET score = GREATEST(0.0, LEAST(2.0, public.provider_responsiveness.score + p_delta)),
        leads_received  = public.provider_responsiveness.leads_received
                          + CASE WHEN p_counter = 'received'  THEN 1 ELSE 0 END,
        leads_contacted = public.provider_responsiveness.leads_contacted
                          + CASE WHEN p_counter = 'contacted' THEN 1 ELSE 0 END,
        leads_won       = public.provider_responsiveness.leads_won
                          + CASE WHEN p_counter = 'won'       THEN 1 ELSE 0 END,
        leads_expired   = public.provider_responsiveness.leads_expired
                          + CASE WHEN p_counter = 'expired'   THEN 1 ELSE 0 END,
        updated_at      = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public._update_responsiveness_score(UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._update_responsiveness_score(UUID, NUMERIC, TEXT) TO service_role;

-- ------------------------------------------------------------
-- 5. send_marketplace_outreach — composer server function
-- ------------------------------------------------------------
-- Caller (the Pro who owns the exclusive on this beacon):
--   * authenticated, provider role, active Pro license
--   * exclusive_provider_id = caller AND exclusive_until > now()
--   * no prior outreach row for (beacon, provider) — re-sends
--     are blocked by the unique constraint AND the explicit
--     check below
--
-- Side effects:
--   * INSERT into marketplace_outreach with feedback_token
--   * UPDATE agent_beacons.contacted_at = now()
--   * +0.1 to responsiveness score, counter 'contacted'
--   * Enqueue 'marketplace-outreach' email
--
-- Returns the outreach id and feedback_token so the caller's
-- mailer can include the token in the email's footer link.
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
  IF NOT EXISTS (
    SELECT 1 FROM public.licenses l
    WHERE l.user_id = v_uid
      AND l.tier = 'pro'::public.app_tier
      AND l.license_status = 'active'::public.license_status
      AND (l.license_expiry IS NULL OR l.license_expiry > now())
  ) THEN
    RAISE EXCEPTION 'active pro license required' USING ERRCODE = '42501';
  END IF;

  -- Validate ownership: caller must currently hold the exclusive.
  SELECT b.id, b.email, b.name, b.city, b.region, b.exclusive_provider_id, b.exclusive_until
  INTO v_beacon
  FROM public.agent_beacons b
  WHERE b.id = p_beacon_id
    AND b.exclusive_provider_id = v_uid
    AND b.exclusive_until IS NOT NULL
    AND b.exclusive_until > now();

  IF v_beacon.id IS NULL THEN
    RAISE EXCEPTION 'no active exclusive on this beacon' USING ERRCODE = '42501';
  END IF;

  -- Block re-sends.
  IF EXISTS (
    SELECT 1 FROM public.marketplace_outreach mo
    WHERE mo.beacon_id = p_beacon_id AND mo.provider_id = v_uid
  ) THEN
    RAISE EXCEPTION 'outreach already sent for this lead' USING ERRCODE = '42710';
  END IF;

  -- Validate input shape (length bounds same as other email fields).
  IF p_subject IS NULL OR length(trim(p_subject)) < 3 OR length(p_subject) > 200 THEN
    RAISE EXCEPTION 'invalid subject' USING ERRCODE = '22023';
  END IF;
  IF p_body IS NULL OR length(trim(p_body)) < 20 OR length(p_body) > 10000 THEN
    RAISE EXCEPTION 'invalid body' USING ERRCODE = '22023';
  END IF;

  -- Pull the Pro's brand for the email "from name" placeholder.
  SELECT bs.brand_name INTO v_provider_brand
  FROM public.branding_settings bs
  WHERE bs.provider_id = v_uid;

  SELECT u.email INTO v_provider_email
  FROM auth.users u WHERE u.id = v_uid;

  -- Insert outreach row first so we have a feedback_token.
  INSERT INTO public.marketplace_outreach (
    beacon_id, provider_id, subject, body
  )
  VALUES (p_beacon_id, v_uid, p_subject, p_body)
  RETURNING id, feedback_token INTO v_outreach_id, v_feedback_token;

  -- Stamp the beacon as contacted. PR2's matcher guards on
  -- contacted_at IS NULL when re-pooling, so this immediately
  -- makes the lead immune to re-pool — exactly what we want once
  -- the Pro has actually reached out.
  UPDATE public.agent_beacons
     SET contacted_at = now()
   WHERE id = p_beacon_id;

  -- Score: +0.1 for sending outreach, capped at 2.0 internally.
  PERFORM public._update_responsiveness_score(v_uid, 0.10, 'contacted');

  -- Enqueue the outreach email. Recipient is the agent. The
  -- feedback_token is included in the data so the template can
  -- render the "report inappropriate outreach" link.
  PERFORM public.enqueue_email(
    'transactional_emails',
    jsonb_build_object(
      'template_name', 'marketplace-outreach',
      'recipient_email', v_beacon.email,
      'data', jsonb_build_object(
        'agentName',     v_beacon.name,
        'mspBrandName',  COALESCE(v_provider_brand, 'A 3DPS Marketplace Pro'),
        'replyToEmail',  v_provider_email,
        'subject',       p_subject,
        'body',          p_body,
        'feedbackUrl',   v_dashboard_url || '/marketplace/feedback/' || v_feedback_token::text
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
-- 6. set_beacon_disposition
-- ------------------------------------------------------------
-- Caller marks a beacon as won / lost / unresponsive. Must be
-- the current OR most-recent-prior exclusive holder (we want to
-- allow disposition even after the exclusive window technically
-- closed — otherwise late-but-genuine wins get lost).
--
-- Score deltas (per the agreed soft-enforcement model):
--   won          → +0.20  (counter: won)
--   lost         →   0.00 (no penalty — agent picked someone else
--                          for legitimate reasons; counter: none)
--   unresponsive → −0.10
--
-- A disposition can be CHANGED (idempotent re-write) but the
-- score adjustment only fires the first time a non-null value
-- is set, so a Pro can't grind score by toggling.
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

  -- Only adjust score the first time. Re-dispositions don't bump.
  IF NOT v_existed THEN
    IF p_disposition = 'won' THEN
      PERFORM public._update_responsiveness_score(v_uid,  0.20, 'won');
    ELSIF p_disposition = 'unresponsive' THEN
      PERFORM public._update_responsiveness_score(v_uid, -0.10, NULL);
    ELSE
      -- 'lost' is neutral — no score change, no counter bump.
      NULL;
    END IF;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_beacon_disposition(UUID, public.beacon_disposition) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_beacon_disposition(UUID, public.beacon_disposition) TO authenticated;

-- ------------------------------------------------------------
-- 7. apply_outreach_feedback
-- ------------------------------------------------------------
-- Called from the public /marketplace/feedback/$token route's
-- POST handler (POST-on-confirm — the GET handler renders a
-- confirmation page so email previewers don't accidentally
-- trigger this). Idempotent: re-flagging the same outreach is
-- a no-op, no double-penalty.
--
-- Validation here is intentionally minimal — the route handler
-- runs as service_role, the token is the unguessable
-- gen_random_uuid() value. If the token doesn't resolve we
-- return false and the route returns a friendly 404.
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
BEGIN
  SELECT mo.id, mo.provider_id, mo.agent_flagged_spam
  INTO v_outreach
  FROM public.marketplace_outreach mo
  WHERE mo.feedback_token = p_feedback_token;

  IF v_outreach.id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Already flagged: no-op, no second penalty.
  IF v_outreach.agent_flagged_spam THEN
    RETURN TRUE;
  END IF;

  UPDATE public.marketplace_outreach
     SET agent_flagged_spam = TRUE,
         agent_flagged_at   = now()
   WHERE id = v_outreach.id;

  -- −0.5 to score, no counter (this is a quality signal, not a
  -- volume signal).
  PERFORM public._update_responsiveness_score(v_outreach.provider_id, -0.50, NULL);

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_outreach_feedback(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_outreach_feedback(UUID) TO service_role;

-- ------------------------------------------------------------
-- 8. lookup_outreach_by_token (read-only sibling)
-- ------------------------------------------------------------
-- The feedback page's GET handler needs to render "Confirm
-- flagging outreach from {brand} sent {date}". This RPC
-- returns the minimum needed to render that without exposing
-- the message body (which is PII).
CREATE OR REPLACE FUNCTION public.lookup_outreach_by_token(
  p_feedback_token UUID
)
RETURNS TABLE (
  brand_name TEXT,
  sent_at TIMESTAMPTZ,
  already_flagged BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    bs.brand_name,
    mo.sent_at,
    mo.agent_flagged_spam
  FROM public.marketplace_outreach mo
  JOIN public.branding_settings bs ON bs.provider_id = mo.provider_id
  WHERE mo.feedback_token = p_feedback_token
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.lookup_outreach_by_token(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_outreach_by_token(UUID) TO service_role;

-- ------------------------------------------------------------
-- 9. apply_no_disposition_penalties (cron, daily)
-- ------------------------------------------------------------
-- For each outreach row sent ≥14 days ago whose beacon still has
-- no disposition AND we haven't already penalized for: −0.3 to
-- the Pro's score, stamp penalty_applied_at so the next run
-- skips this row. Intentionally a soft penalty — no hard block,
-- the Pro keeps receiving leads.
CREATE OR REPLACE FUNCTION public.apply_no_disposition_penalties()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_count INT := 0;
BEGIN
  FOR v_row IN
    SELECT mo.id, mo.provider_id
    FROM public.marketplace_outreach mo
    JOIN public.agent_beacons b ON b.id = mo.beacon_id
    WHERE mo.penalty_applied_at IS NULL
      AND mo.sent_at < now() - interval '14 days'
      AND b.disposition IS NULL
    LIMIT 200
  LOOP
    PERFORM public._update_responsiveness_score(v_row.provider_id, -0.30, 'expired');

    UPDATE public.marketplace_outreach
       SET penalty_applied_at = now()
     WHERE id = v_row.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_no_disposition_penalties() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_no_disposition_penalties() TO service_role;

-- ------------------------------------------------------------
-- 10. cleanup_old_outreach_bodies (cron, daily)
-- ------------------------------------------------------------
-- 14 days after sending, null out the body to drop the PII.
-- The audit row stays — subject, sent_at, who-sent-to-whom.
CREATE OR REPLACE FUNCTION public.cleanup_old_outreach_bodies()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  WITH affected AS (
    UPDATE public.marketplace_outreach
       SET body = NULL
     WHERE body IS NOT NULL
       AND sent_at < now() - interval '14 days'
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM affected;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_old_outreach_bodies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_outreach_bodies() TO service_role;

-- ------------------------------------------------------------
-- 11. cron schedules — daily at 03:15 and 03:30 UTC
-- ------------------------------------------------------------
-- Idempotent: drop any prior schedule with the same name before
-- re-creating. Ordered so the body cleanup runs after the
-- penalty job — the penalty needs to read the body (no, it
-- doesn't — only sent_at and disposition), but ordering is
-- conservative anyway.
DO $$ BEGIN
  PERFORM cron.unschedule('apply_no_disposition_penalties');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  PERFORM cron.unschedule('cleanup_old_outreach_bodies');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'apply_no_disposition_penalties',
  '15 3 * * *',
  $cron$ SELECT public.apply_no_disposition_penalties(); $cron$
);

SELECT cron.schedule(
  'cleanup_old_outreach_bodies',
  '30 3 * * *',
  $cron$ SELECT public.cleanup_old_outreach_bodies(); $cron$
);

-- ------------------------------------------------------------
-- 12. claim_pending_beacon_matches — score-aware ranking
-- ------------------------------------------------------------
-- PR2 left a "TODO: PR3 will plug in the responsiveness score"
-- comment on the ranking. This rewrites the function so the
-- ranking is:
--   1. tier='pro' before 'starter'
--   2. responsiveness.score DESC (default 1.0 for unseen Pros)
--   3. brand_name ASC (final tie-break)
--
-- Everything else — the seed-into-pool logic, exclusive_until,
-- provider_email return, beacon_notification idempotency — is
-- preserved verbatim from the PR2 implementation.
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
    v_rank := 0;
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
        AND public._is_provider_serving_beacon(bs.provider_id, v_beacon.id)
      ORDER BY
        CASE WHEN bs.tier = 'pro' THEN 0 ELSE 1 END,
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

        v_exclusive_until := now() + interval '72 hours';

        UPDATE public.agent_beacons
           SET status                = 'matched',
               matched_provider_id   = v_eligible.provider_id,
               matched_at            = now(),
               exclusive_provider_id = v_eligible.provider_id,
               exclusive_until       = v_exclusive_until
         WHERE id = v_beacon.id;

        -- Lead-received counter for the new exclusive holder.
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
  END LOOP;

  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_pending_beacon_matches(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pending_beacon_matches(INT) TO service_role;

-- ------------------------------------------------------------
-- 13. get_my_marketplace_standing
-- ------------------------------------------------------------
-- Lightweight RPC the dashboard uses to render the "Marketplace
-- Standing: Excellent / Good / At Risk" badge without exposing
-- the raw score value. Thresholds match the agreed soft-
-- enforcement model and can be tuned without changing call sites.
CREATE OR REPLACE FUNCTION public.get_my_marketplace_standing()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN COALESCE(pr.score, 1.00) >= 1.50 THEN 'excellent'
      WHEN COALESCE(pr.score, 1.00) >= 0.70 THEN 'good'
      ELSE 'at_risk'
    END
  FROM (SELECT auth.uid() AS uid) AS me
  LEFT JOIN public.provider_responsiveness pr ON pr.provider_id = me.uid;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_marketplace_standing() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_marketplace_standing() TO authenticated;

-- ------------------------------------------------------------
-- 14. get_my_matched_beacons — extend with disposition fields
-- ------------------------------------------------------------
-- The marketplace UI needs to know each lead's disposition state
-- to render the disposition buttons (or the "already
-- dispositioned" stamp). Returning the new fields here keeps the
-- UI to a single fetch rather than a join-from-the-frontend.
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
  disposition public.beacon_disposition,
  has_outreach BOOLEAN
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
    (b.exclusive_provider_id = v_uid) AS is_currently_exclusive,
    b.disposition,
    EXISTS (
      SELECT 1 FROM public.marketplace_outreach mo
      WHERE mo.beacon_id = b.id AND mo.provider_id = v_uid
    ) AS has_outreach
  FROM public.agent_beacons b
  WHERE b.status IN ('waiting', 'matched')
    AND b.expires_at > now()
    AND (
      b.exclusive_provider_id = v_uid
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
    CASE WHEN b.exclusive_provider_id = v_uid AND b.exclusive_until > now() THEN 0 ELSE 1 END,
    b.exclusive_until ASC NULLS LAST,
    b.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_matched_beacons() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_matched_beacons() TO authenticated;

-- ============================================================
-- End of composer / disposition / responsiveness migration
-- ============================================================
