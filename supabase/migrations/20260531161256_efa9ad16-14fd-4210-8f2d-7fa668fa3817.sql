ALTER TABLE public.map_oracle_outreach_log
  DROP CONSTRAINT IF EXISTS map_oracle_outreach_log_status_check;

ALTER TABLE public.map_oracle_outreach_log
  ADD CONSTRAINT map_oracle_outreach_log_status_check
  CHECK (status = ANY (ARRAY[
    'pending_render'::text,
    'queued'::text,
    'sent'::text,
    'suppressed'::text,
    'skipped'::text,
    'failed'::text
  ]));

CREATE OR REPLACE FUNCTION public.send_map_oracle_outreach(
  p_beacon_id uuid,
  p_dry_run   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_b            RECORD;
  v_token        TEXT;
  v_unsub_url    TEXT;
  v_base_url     TEXT := 'https://frontiers3d.com';
  v_postal       TEXT := 'Transcendence Media, 1100 Peachtree St NE, Suite 200, Atlanta, GA 30309, USA';
  v_city_display TEXT;
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

  IF EXISTS (SELECT 1 FROM public.suppressed_emails WHERE lower(email) = lower(v_b.email)) THEN
    IF NOT p_dry_run THEN
      INSERT INTO public.map_oracle_outreach_log
        (beacon_id, property_id, recipient_email, template_name, status, queued_by, error)
      VALUES
        (p_beacon_id, v_b.property_id, v_b.email, 'map-oracle-preview-offer', 'suppressed', auth.uid(), 'recipient on suppressed_emails');
    END IF;
    RETURN jsonb_build_object('status','suppressed','beacon_id',p_beacon_id,'reason','recipient suppressed');
  END IF;

  INSERT INTO public.email_unsubscribe_tokens (token, email)
  VALUES (encode(extensions.gen_random_bytes(18), 'hex'), lower(v_b.email))
  ON CONFLICT (email) DO NOTHING;

  SELECT token INTO v_token FROM public.email_unsubscribe_tokens WHERE lower(email) = lower(v_b.email);
  v_unsub_url := v_base_url || '/email/unsubscribe?token=' || v_token;

  v_city_display := CASE
    WHEN v_b.region IS NOT NULL AND v_b.city IS NOT NULL THEN v_b.city || ', ' || v_b.region
    ELSE v_b.city
  END;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'status','dry_run','beacon_id',p_beacon_id,'property_id',v_b.property_id,
      'recipient',v_b.email,'template','map-oracle-preview-offer','business',v_b.name,
      'city_display',v_city_display,'unsubscribe_url',v_unsub_url,
      'unsubscribe_token',v_token,'physical_address',v_postal,
      'note','no log row written, no email enqueued'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.map_oracle_outreach_log
     WHERE beacon_id = p_beacon_id
       AND status IN ('pending_render','queued','sent')
  ) THEN
    RAISE EXCEPTION 'beacon % already has an active or completed outreach send', p_beacon_id USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.map_oracle_outreach_log (
    beacon_id, property_id, recipient_email, template_name,
    status, pgmq_msg_id, unsubscribe_token, queued_by, metadata
  ) VALUES (
    p_beacon_id, v_b.property_id, v_b.email, 'map-oracle-preview-offer',
    'pending_render', NULL, v_token, auth.uid(),
    jsonb_build_object('city', v_b.city, 'region', v_b.region)
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'status','pending_render','beacon_id',p_beacon_id,'property_id',v_b.property_id,
    'outreach_log_id',v_log_id,'recipient',v_b.email,'template','map-oracle-preview-offer',
    'business',v_b.name,'city_display',v_city_display,
    'unsubscribe_url',v_unsub_url,'unsubscribe_token',v_token,'physical_address',v_postal,
    'next_step','admin renderer must render React template and enqueue pre-rendered transactional payload via enqueue_email, then update this row to status=queued with pgmq_msg_id'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.send_map_oracle_outreach(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_map_oracle_outreach(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_map_oracle_outreach(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_map_oracle_outreach(uuid, boolean) TO service_role;