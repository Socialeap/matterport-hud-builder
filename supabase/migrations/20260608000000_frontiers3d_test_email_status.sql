-- ============================================================
-- Frontiers3D — test-email delivery status (read-only; powers the operator
-- "Send test to admin" trace panel).
-- ------------------------------------------------------------
-- email_send_log RLS allows SELECT to service_role ONLY, so the admin UI cannot
-- read delivery status directly. This admin-gated SECURITY DEFINER function
-- resolves the delivery state of ONE test message_id so the operator UI can poll
-- it after enqueuing an internal test send and show pending / sent / failed / dlq
-- (or a timeout) — distinguishing "queued" from "actually delivered".
--
-- SCOPED TO TEST SENDS ONLY: rows are filtered to template_name
-- 'map-oracle-preview-offer-test', so this surface can never expose prospect
-- send logs. Read-only. No writes, no send-behavior change. No B4/binding,
-- Stripe, billing, Track A, batch, or cron.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_test_email_status(p_message_id TEXT)
RETURNS TABLE (
  resolved_status TEXT,      -- sent | dlq | failed | suppressed | pending | unknown
  attempts        INTEGER,   -- number of email_send_log rows seen for this message
  last_error      TEXT,      -- most recent error_message, if any
  last_at         TIMESTAMPTZ,
  recipient_email TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'get_test_email_status is operator (admin) only' USING ERRCODE = '42501';
  END IF;

  IF p_message_id IS NULL OR length(p_message_id) = 0 THEN
    RAISE EXCEPTION 'p_message_id is required' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH log_rows AS (
    SELECT esl.status, esl.error_message, esl.created_at, esl.recipient_email
      FROM public.email_send_log esl
     WHERE esl.message_id = p_message_id
       AND esl.template_name = 'map-oracle-preview-offer-test'  -- test sends only
  )
  SELECT
    CASE
      WHEN bool_or(status = 'sent')                                THEN 'sent'
      WHEN bool_or(status = 'dlq')                                 THEN 'dlq'
      WHEN bool_or(status IN ('failed','bounced','complained'))   THEN 'failed'
      WHEN bool_or(status = 'suppressed')                         THEN 'suppressed'
      WHEN bool_or(status = 'pending')                            THEN 'pending'
      ELSE 'unknown'
    END AS resolved_status,
    COUNT(*)::INTEGER AS attempts,
    (ARRAY_AGG(error_message ORDER BY created_at DESC)
       FILTER (WHERE error_message IS NOT NULL))[1] AS last_error,
    MAX(created_at) AS last_at,
    (ARRAY_AGG(recipient_email ORDER BY created_at DESC))[1] AS recipient_email
  FROM log_rows;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_test_email_status(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_test_email_status(TEXT) TO service_role, authenticated;

-- ============================================================
-- End — test-email delivery status (read-only, admin-only, test-scoped).
-- ============================================================
