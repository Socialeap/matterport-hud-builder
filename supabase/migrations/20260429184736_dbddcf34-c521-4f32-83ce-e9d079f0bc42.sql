-- ============================================================
-- M3+M4+M5+M6 (consolidated) — Ask AI quota + Client BYOK
-- ============================================================

-- 1. Per-(saved_model, property) quota counters + idempotent event log.
CREATE TABLE IF NOT EXISTS public.ask_quota_counters (
  saved_model_id          uuid    NOT NULL REFERENCES public.saved_models(id) ON DELETE CASCADE,
  property_uuid           text    NOT NULL,
  free_used               int     NOT NULL DEFAULT 0,
  free_limit              int     NOT NULL DEFAULT 20,
  byok_active             boolean NOT NULL DEFAULT false,
  exhausted_email_sent_at timestamptz,
  warning_email_sent_at   timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (saved_model_id, property_uuid)
);

CREATE TABLE IF NOT EXISTS public.ask_quota_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_model_id    uuid NOT NULL,
  property_uuid     text NOT NULL,
  idempotency_key   text NOT NULL,
  outcome           text NOT NULL CHECK (
    outcome IN ('counted', 'not_counted', 'rejected', 'byok')
  ),
  reason            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (saved_model_id, property_uuid, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ask_quota_events_model_recent_idx
  ON public.ask_quota_events (saved_model_id, created_at DESC);

ALTER TABLE public.ask_quota_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ask_quota_events   ENABLE ROW LEVEL SECURITY;

CREATE POLICY ask_quota_counters_service_only ON public.ask_quota_counters
  FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY ask_quota_events_service_only ON public.ask_quota_events
  FOR ALL USING (false) WITH CHECK (false);

-- record_ask_quota_event: atomic insert + counter increment.
CREATE OR REPLACE FUNCTION public.record_ask_quota_event(
  p_saved_model_id uuid,
  p_property_uuid  text,
  p_idempotency_key text,
  p_outcome        text,
  p_reason         text DEFAULT NULL
) RETURNS TABLE (
  free_used               int,
  free_limit              int,
  byok_active             boolean,
  exhausted_email_sent_at timestamptz,
  warning_email_sent_at   timestamptz,
  was_new                 boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
BEGIN
  IF p_outcome NOT IN ('counted', 'not_counted', 'rejected', 'byok') THEN
    RAISE EXCEPTION 'invalid_outcome: %', p_outcome;
  END IF;

  INSERT INTO public.ask_quota_events (
    saved_model_id, property_uuid, idempotency_key, outcome, reason
  ) VALUES (
    p_saved_model_id, p_property_uuid, p_idempotency_key, p_outcome, p_reason
  )
  ON CONFLICT (saved_model_id, property_uuid, idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  INSERT INTO public.ask_quota_counters (saved_model_id, property_uuid)
  VALUES (p_saved_model_id, p_property_uuid)
  ON CONFLICT (saved_model_id, property_uuid) DO NOTHING;

  IF v_inserted > 0 AND p_outcome = 'counted' THEN
    UPDATE public.ask_quota_counters
       SET free_used  = free_used + 1,
           updated_at = now()
     WHERE saved_model_id = p_saved_model_id
       AND property_uuid  = p_property_uuid;
  END IF;

  RETURN QUERY
  SELECT
    c.free_used,
    c.free_limit,
    c.byok_active,
    c.exhausted_email_sent_at,
    c.warning_email_sent_at,
    (v_inserted > 0)
  FROM public.ask_quota_counters c
  WHERE c.saved_model_id = p_saved_model_id
    AND c.property_uuid  = p_property_uuid;
END;
$$;
REVOKE ALL ON FUNCTION public.record_ask_quota_event(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_ask_quota_event(uuid, text, text, text, text) TO service_role;

-- read_ask_quota_counter: pre-flight read.
CREATE OR REPLACE FUNCTION public.read_ask_quota_counter(
  p_saved_model_id uuid,
  p_property_uuid  text
) RETURNS TABLE (
  free_used               int,
  free_limit              int,
  byok_active             boolean,
  exhausted_email_sent_at timestamptz,
  warning_email_sent_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(c.free_used, 0),
    COALESCE(c.free_limit, 20),
    COALESCE(c.byok_active, false),
    c.exhausted_email_sent_at,
    c.warning_email_sent_at
  FROM (SELECT 1) AS _
  LEFT JOIN public.ask_quota_counters c
    ON c.saved_model_id = p_saved_model_id
   AND c.property_uuid  = p_property_uuid;
END;
$$;
REVOKE ALL ON FUNCTION public.read_ask_quota_counter(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_ask_quota_counter(uuid, text) TO service_role;

-- claim_ask_exhaustion_email: one-shot atomic claim when free quota
-- is fully used.
CREATE OR REPLACE FUNCTION public.claim_ask_exhaustion_email(
  p_saved_model_id uuid,
  p_property_uuid  text
) RETURNS TABLE (
  saved_model_id          uuid,
  property_uuid           text,
  free_used               int,
  free_limit              int,
  byok_active             boolean,
  exhausted_email_sent_at timestamptz,
  warning_email_sent_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.ask_quota_counters c
     SET exhausted_email_sent_at = now()
   WHERE c.saved_model_id = p_saved_model_id
     AND c.property_uuid  = p_property_uuid
     AND c.byok_active    = false
     AND c.free_used      >= c.free_limit
     AND c.exhausted_email_sent_at IS NULL
  RETURNING
    c.saved_model_id,
    c.property_uuid,
    c.free_used,
    c.free_limit,
    c.byok_active,
    c.exhausted_email_sent_at,
    c.warning_email_sent_at;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_ask_exhaustion_email(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_ask_exhaustion_email(uuid, text) TO service_role;

-- claim_ask_warning_email: one-shot atomic claim when only a few
-- free answers remain (default threshold = 3).
CREATE OR REPLACE FUNCTION public.claim_ask_warning_email(
  p_saved_model_id uuid,
  p_property_uuid  text,
  p_threshold      int DEFAULT 3
) RETURNS TABLE (
  saved_model_id        uuid,
  property_uuid         text,
  free_used             int,
  free_limit            int,
  byok_active           boolean,
  warning_email_sent_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.ask_quota_counters c
     SET warning_email_sent_at = now()
   WHERE c.saved_model_id = p_saved_model_id
     AND c.property_uuid  = p_property_uuid
     AND c.byok_active    = false
     AND c.free_used      >= GREATEST(c.free_limit - p_threshold, 0)
     AND c.free_used      <  c.free_limit
     AND c.warning_email_sent_at IS NULL
  RETURNING
    c.saved_model_id,
    c.property_uuid,
    c.free_used,
    c.free_limit,
    c.byok_active,
    c.warning_email_sent_at;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_ask_warning_email(uuid, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_ask_warning_email(uuid, text, int) TO service_role;

-- 2. Client-owned BYOK Gemini keys.
CREATE TABLE IF NOT EXISTS public.client_byok_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor        text NOT NULL CHECK (vendor IN ('gemini')),
  ciphertext    bytea NOT NULL,
  iv            bytea NOT NULL CHECK (octet_length(iv) = 12),
  fingerprint   text NOT NULL,
  active        boolean NOT NULL DEFAULT false,
  validated_at  timestamptz,
  validation_error text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  rotated_at    timestamptz,
  UNIQUE (client_id, vendor)
);

CREATE INDEX IF NOT EXISTS client_byok_keys_active_idx
  ON public.client_byok_keys (client_id)
  WHERE active = true;

ALTER TABLE public.client_byok_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_byok_keys_owner_select_meta
  ON public.client_byok_keys FOR SELECT  USING (false);
CREATE POLICY client_byok_keys_owner_insert
  ON public.client_byok_keys FOR INSERT  WITH CHECK (false);
CREATE POLICY client_byok_keys_owner_update
  ON public.client_byok_keys FOR UPDATE  USING (false);
CREATE POLICY client_byok_keys_owner_delete
  ON public.client_byok_keys FOR DELETE  USING (false);

-- read_byok_status: signed-in client reads their own masked status.
CREATE OR REPLACE FUNCTION public.read_byok_status(
  p_vendor text DEFAULT 'gemini'
) RETURNS TABLE (
  has_key          boolean,
  vendor           text,
  fingerprint      text,
  active           boolean,
  validated_at     timestamptz,
  validation_error text,
  created_at       timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    (k.id IS NOT NULL),
    COALESCE(k.vendor, p_vendor),
    k.fingerprint,
    COALESCE(k.active, false),
    k.validated_at,
    k.validation_error,
    k.created_at
  FROM (SELECT 1) AS _
  LEFT JOIN public.client_byok_keys k
    ON k.client_id = v_user_id AND k.vendor = p_vendor;
END;
$$;
REVOKE ALL ON FUNCTION public.read_byok_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_byok_status(text) TO authenticated;

-- set_client_byok_active: flip per-property byok_active for all
-- saved_models owned by p_client_id. Called by validate-byok.
CREATE OR REPLACE FUNCTION public.set_client_byok_active(
  p_client_id uuid,
  p_active    boolean
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  WITH client_models AS (
    SELECT id AS saved_model_id, properties
      FROM public.saved_models
     WHERE client_id = p_client_id
  ),
  property_rows AS (
    SELECT
      m.saved_model_id,
      jsonb_array_elements(m.properties)->>'id' AS property_uuid
    FROM client_models m
    WHERE jsonb_typeof(m.properties) = 'array'
  )
  INSERT INTO public.ask_quota_counters (
    saved_model_id, property_uuid, byok_active
  )
  SELECT saved_model_id, property_uuid, p_active
    FROM property_rows
   WHERE property_uuid IS NOT NULL
  ON CONFLICT (saved_model_id, property_uuid) DO UPDATE
    SET byok_active = EXCLUDED.byok_active,
        updated_at  = now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.set_client_byok_active(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_client_byok_active(uuid, boolean) TO service_role;

COMMENT ON TABLE public.ask_quota_counters IS
  'Per-(saved_model, property) Ask AI subsidy quota. Service-role only.';
COMMENT ON TABLE public.ask_quota_events IS
  'Append-only Ask AI quota event log. Idempotency via UNIQUE (saved_model, property, idempotency_key).';
COMMENT ON TABLE public.client_byok_keys IS
  'Client-owned Gemini API keys, AES-GCM encrypted under BYOK_MASTER_KEY. Service-role only at rest; metadata exposed via read_byok_status().';
COMMENT ON COLUMN public.ask_quota_counters.warning_email_sent_at IS
  'Set once when the early-warning email (few free answers left) is sent.';