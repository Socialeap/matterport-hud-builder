
-- Idempotent reconcile: status check + send_map_oracle_outreach already match live state.
-- Re-applied to register canonical migration and add renderer finalize primitives.

ALTER TABLE public.map_oracle_outreach_log
  DROP CONSTRAINT IF EXISTS map_oracle_outreach_log_status_check;

ALTER TABLE public.map_oracle_outreach_log
  ADD CONSTRAINT map_oracle_outreach_log_status_check
  CHECK (status = ANY (ARRAY[
    'pending_render'::text,'queued'::text,'sent'::text,
    'suppressed'::text,'skipped'::text,'failed'::text
  ]));

CREATE OR REPLACE FUNCTION public.mark_map_oracle_outreach_queued(
  p_outreach_log_id UUID,
  p_pgmq_msg_id     BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'mark_map_oracle_outreach_queued is operator (admin) only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.map_oracle_outreach_log
     SET status = 'queued', pgmq_msg_id = p_pgmq_msg_id
   WHERE id = p_outreach_log_id AND status = 'pending_render';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no pending_render outreach log %', p_outreach_log_id USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_map_oracle_outreach_failed(
  p_outreach_log_id UUID,
  p_error           TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'mark_map_oracle_outreach_failed is operator (admin) only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.map_oracle_outreach_log
     SET status = 'failed', error = p_error
   WHERE id = p_outreach_log_id AND status = 'pending_render';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no pending_render outreach log %', p_outreach_log_id USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_map_oracle_outreach_queued(UUID, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_map_oracle_outreach_failed(UUID, TEXT)   FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_map_oracle_outreach_queued(UUID, BIGINT) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_map_oracle_outreach_failed(UUID, TEXT)   TO service_role, authenticated;
