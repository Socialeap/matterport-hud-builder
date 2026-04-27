-- M3 — Per-(saved_model, property) quota counters + idempotent event log.
--
-- Each property in a multi-property presentation gets its own bucket
-- of 20 subsidized successful Gemini answers funded by TM. Local
-- deterministic answers (Tier 1 canonical / Tier 3 high-confidence
-- chunk) DO NOT decrement; only invocations of TM-funded model
-- providers do. BYOK answers do not decrement (see C12).
--
-- Idempotency is enforced via UNIQUE(saved_model_id, property_uuid,
-- idempotency_key). The key is sha256(token + normalized_question +
-- evidence_hash) computed by the edge function before the model
-- call. Duplicate requests do not double-count.

CREATE TABLE IF NOT EXISTS public.ask_quota_counters (
  saved_model_id          uuid    NOT NULL REFERENCES public.saved_models(id) ON DELETE CASCADE,
  property_uuid           text    NOT NULL,
  free_used               int     NOT NULL DEFAULT 0,
  free_limit              int     NOT NULL DEFAULT 20,
  byok_active             boolean NOT NULL DEFAULT false,
  exhausted_email_sent_at timestamptz,
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
ALTER TABLE public.ask_quota_events ENABLE ROW LEVEL SECURITY;

-- Service-role only (no provider read policy — leaks usage timing).
CREATE POLICY ask_quota_counters_service_only ON public.ask_quota_counters
  FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY ask_quota_events_service_only ON public.ask_quota_events
  FOR ALL USING (false) WITH CHECK (false);

-- Atomic record-and-count helper. Inserts the event idempotently and
-- increments the counter only when the event was actually new.
-- Returns the post-update state plus a `was_new` flag so the edge
-- function can decide whether the meta event reports a count change
-- or treats the request as a replay.
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

  -- Always make sure the counter row exists for read-after-write.
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
    (v_inserted > 0)
  FROM public.ask_quota_counters c
  WHERE c.saved_model_id = p_saved_model_id
    AND c.property_uuid  = p_property_uuid;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ask_quota_event(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_ask_quota_event(uuid, text, text, text, text) TO service_role;

-- Read-only counter accessor for the edge function's pre-flight quota
-- check. Returns defaults when no counter row exists yet.
CREATE OR REPLACE FUNCTION public.read_ask_quota_counter(
  p_saved_model_id uuid,
  p_property_uuid  text
) RETURNS TABLE (
  free_used               int,
  free_limit              int,
  byok_active             boolean,
  exhausted_email_sent_at timestamptz
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
    c.exhausted_email_sent_at
  FROM (SELECT 1) AS _
  LEFT JOIN public.ask_quota_counters c
    ON c.saved_model_id = p_saved_model_id
   AND c.property_uuid  = p_property_uuid;
END;
$$;

REVOKE ALL ON FUNCTION public.read_ask_quota_counter(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_ask_quota_counter(uuid, text) TO service_role;

COMMENT ON TABLE public.ask_quota_counters IS
  'Per-(saved_model, property) Ask AI subsidy quota. Read by record_ask_quota_event and read_ask_quota_counter.';
COMMENT ON TABLE public.ask_quota_events IS
  'Append-only event log for idempotent quota accounting. UNIQUE(saved_model_id, property_uuid, idempotency_key) makes replays safe.';
