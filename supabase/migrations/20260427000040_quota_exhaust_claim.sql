-- M5 — Atomic exhaustion-notice claim helper.
--
-- The synthesize-answer edge function calls this AFTER recording the
-- counted event. If the counter just crossed free_limit AND the
-- exhausted_email_sent_at is still null, this function atomically
-- stamps the timestamp and returns the row so the caller can
-- enqueue the notification email exactly once. Subsequent calls
-- (race winner already stamped, replays after restart, etc.)
-- return zero rows.
--
-- The deterministic email message_id format uses the timestamp so
-- email_send_log's UNIQUE(message_id) WHERE status='sent' adds a
-- second layer of idempotency at the email-pipeline level.

CREATE OR REPLACE FUNCTION public.claim_ask_exhaustion_email(
  p_saved_model_id uuid,
  p_property_uuid  text
) RETURNS TABLE (
  saved_model_id          uuid,
  property_uuid           text,
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
    c.exhausted_email_sent_at;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_ask_exhaustion_email(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_ask_exhaustion_email(uuid, text) TO service_role;

COMMENT ON FUNCTION public.claim_ask_exhaustion_email IS
  'Atomic claim. Returns one row exactly once when the counter crosses free_limit; subsequent calls return zero rows.';
