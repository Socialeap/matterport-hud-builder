-- ============================================================
-- Frontiers3D — Track B: Map-Oracle Outreach Send (controlled, one beacon)
-- ------------------------------------------------------------
-- Lets an admin/service-role send ONE CAN-SPAM-compliant preview-offer
-- email to a SINGLE map_oracle beacon, via the EXISTING transactional
-- email infrastructure (enqueue_email -> 'transactional_emails' pgmq queue
-- -> the existing send pipeline, which already checks suppressed_emails and
-- manages per-recipient unsubscribe tokens + List-Unsubscribe headers).
--
-- This migration adds:
--   * map_oracle_outreach_log — audit of every send attempt/result
--   * send_map_oracle_outreach(beacon_id, dry_run) — admin-only, EXPLICIT,
--     ONE beacon per call; respects unsubscribes + suppression; idempotent
--     (no duplicate queued send per beacon). NO trigger, NO cron, NO batch.
--
-- Message (rendered by the new `map-oracle-preview-offer` react-email
-- template): an OFFER to preview adding interactive functionality to the
-- business's Google Maps Street View / 360 / inside-tour presence, or to
-- connect them with a local provider to virtualize first. CAN-SPAM: clear
-- identification, physical postal address, working unsubscribe.
--
-- Out of scope (NOT here): B4 client/provider binding, billing, Stripe,
-- Track A, auto/batch send, cron. Strictly additive. No destructive op.
-- Prerequisite: B3 (map_oracle beacons) + the existing email infra
-- (enqueue_email, suppressed_emails, email_unsubscribe_tokens).
-- ============================================================


-- ------------------------------------------------------------
-- 1. map_oracle_outreach_log — send audit trail
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.map_oracle_outreach_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beacon_id        UUID REFERENCES public.agent_beacons(id) ON DELETE SET NULL,
  property_id      UUID,                          -- snapshot for durable trace
  recipient_email  TEXT NOT NULL,
  template_name    TEXT NOT NULL DEFAULT 'map-oracle-preview-offer',
  status           TEXT NOT NULL
                     CHECK (status IN ('queued','suppressed','skipped','failed')),
  pgmq_msg_id      BIGINT,                        -- id returned by enqueue_email
  unsubscribe_token TEXT,
  queued_by        UUID,
  queued_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  error            TEXT,
  metadata         JSONB
);

-- One active queued send per beacon (no re-send / no batch).
CREATE UNIQUE INDEX IF NOT EXISTS uq_map_oracle_outreach_active
  ON public.map_oracle_outreach_log (beacon_id)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_map_oracle_outreach_status
  ON public.map_oracle_outreach_log (status, queued_at DESC);

ALTER TABLE public.map_oracle_outreach_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage map_oracle_outreach_log"
    ON public.map_oracle_outreach_log FOR ALL
    USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read map_oracle_outreach_log"
    ON public.map_oracle_outreach_log FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ------------------------------------------------------------
-- 2. send_map_oracle_outreach(beacon_id, dry_run)
--    Admin/service-role only. EXPLICIT, ONE beacon. Respects unsubscribe
--    + suppression. Idempotent (no duplicate queued send). Enqueues via
--    the existing email infra; the send pipeline performs the actual send.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_map_oracle_outreach(
  p_beacon_id UUID,
  p_dry_run   BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq
AS $$
DECLARE
  v_b            RECORD;
  v_token        TEXT;
  v_unsub_url    TEXT;
  -- CONFIRM the production base URL + postal address at activation.
  v_base_url     TEXT := 'https://3dps.transcendencemedia.com';
  v_postal       TEXT := 'Transcendence Media, 1100 Peachtree St NE, Suite 200, Atlanta, GA 30309, USA';
  v_msg_id       BIGINT;
  v_log_id       UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'send_map_oracle_outreach is operator (admin) only' USING ERRCODE = '42501';
  END IF;

  SELECT id, email, name, city, region, source, status, property_id
    INTO v_b FROM public.agent_beacons WHERE id = p_beacon_id;

  IF v_b.id IS NULL THEN
    RAISE EXCEPTION 'beacon % does not exist', p_beacon_id USING ERRCODE = 'P0001';
  END IF;
  IF v_b.source <> 'map_oracle' THEN
    RAISE EXCEPTION 'beacon % is source=% — outreach send is map_oracle only', p_beacon_id, v_b.source USING ERRCODE = '22023';
  END IF;
  IF v_b.status = 'unsubscribed' THEN
    RAISE EXCEPTION 'beacon % is unsubscribed — refusing to send', p_beacon_id USING ERRCODE = 'P0001';
  END IF;
  IF v_b.email IS NULL OR btrim(v_b.email) = '' THEN
    RAISE EXCEPTION 'beacon % has no email (run B5 enrichment first)', p_beacon_id USING ERRCODE = 'P0001';
  END IF;

  -- Respect the global suppression list (unsubscribe / bounce / complaint).
  IF EXISTS (SELECT 1 FROM public.suppressed_emails WHERE lower(email) = lower(v_b.email)) THEN
    IF NOT p_dry_run THEN
      INSERT INTO public.map_oracle_outreach_log (beacon_id, property_id, recipient_email, status, queued_by, error)
      VALUES (p_beacon_id, v_b.property_id, v_b.email, 'suppressed', auth.uid(), 'recipient on suppressed_emails');
    END IF;
    RETURN jsonb_build_object('status','suppressed','beacon_id',p_beacon_id,'reason','recipient suppressed');
  END IF;

  -- One active queued send per beacon (no re-send / no batch).
  IF EXISTS (SELECT 1 FROM public.map_oracle_outreach_log WHERE beacon_id = p_beacon_id AND status = 'queued') THEN
    RAISE EXCEPTION 'beacon % already has a queued outreach send', p_beacon_id USING ERRCODE = '23505';
  END IF;

  -- Get-or-create the per-recipient unsubscribe token (same table the send
  -- pipeline uses) so the email carries a working CAN-SPAM unsubscribe link.
  INSERT INTO public.email_unsubscribe_tokens (token, email)
  VALUES (encode(gen_random_bytes(18), 'hex'), lower(v_b.email))
  ON CONFLICT (email) DO NOTHING;
  SELECT token INTO v_token FROM public.email_unsubscribe_tokens WHERE lower(email) = lower(v_b.email);
  v_unsub_url := v_base_url || '/email/unsubscribe?token=' || v_token;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'status','dry_run','beacon_id',p_beacon_id,'recipient',v_b.email,
      'template','map-oracle-preview-offer','business',v_b.name,
      'unsubscribe_url',v_unsub_url,'note','no email enqueued, no log written'
    );
  END IF;

  -- Enqueue via the EXISTING transactional email infrastructure.
  v_msg_id := public.enqueue_email(
    'transactional_emails',
    jsonb_build_object(
      'template_name', 'map-oracle-preview-offer',
      'recipient_email', v_b.email,
      'unsubscribe_token', v_token,
      'data', jsonb_build_object(
        'businessName', v_b.name,
        'city', CASE WHEN v_b.region IS NOT NULL THEN v_b.city || ', ' || v_b.region ELSE v_b.city END,
        'unsubscribeUrl', v_unsub_url,
        'physicalAddress', v_postal
      )
    )
  );

  INSERT INTO public.map_oracle_outreach_log
    (beacon_id, property_id, recipient_email, template_name, status, pgmq_msg_id, unsubscribe_token, queued_by, metadata)
  VALUES
    (p_beacon_id, v_b.property_id, v_b.email, 'map-oracle-preview-offer', 'queued', v_msg_id, v_token, auth.uid(),
     jsonb_build_object('city', v_b.city, 'region', v_b.region))
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object('status','queued','beacon_id',p_beacon_id,'log_id',v_log_id,'pgmq_msg_id',v_msg_id,'recipient',v_b.email);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.send_map_oracle_outreach(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_map_oracle_outreach(UUID, BOOLEAN) TO service_role, authenticated;

-- ============================================================
-- End — Map-Oracle Outreach Send (controlled, one beacon per explicit call).
-- ============================================================
