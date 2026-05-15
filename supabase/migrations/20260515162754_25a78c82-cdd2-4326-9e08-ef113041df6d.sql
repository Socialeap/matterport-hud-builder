CREATE TABLE IF NOT EXISTS public.presentation_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_model_id  uuid NOT NULL REFERENCES public.saved_models(id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,
  payload         jsonb NOT NULL,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  rotated_from    uuid REFERENCES public.presentation_tokens(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS presentation_tokens_model_active_idx
  ON public.presentation_tokens (saved_model_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS presentation_tokens_revoked_idx
  ON public.presentation_tokens (revoked_at)
  WHERE revoked_at IS NOT NULL;

ALTER TABLE public.presentation_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS presentation_tokens_service_only_select ON public.presentation_tokens;
DROP POLICY IF EXISTS presentation_tokens_service_only_insert ON public.presentation_tokens;
DROP POLICY IF EXISTS presentation_tokens_service_only_update ON public.presentation_tokens;
DROP POLICY IF EXISTS presentation_tokens_service_only_delete ON public.presentation_tokens;

CREATE POLICY presentation_tokens_service_only_select
  ON public.presentation_tokens FOR SELECT
  USING (false);
CREATE POLICY presentation_tokens_service_only_insert
  ON public.presentation_tokens FOR INSERT
  WITH CHECK (false);
CREATE POLICY presentation_tokens_service_only_update
  ON public.presentation_tokens FOR UPDATE
  USING (false);
CREATE POLICY presentation_tokens_service_only_delete
  ON public.presentation_tokens FOR DELETE
  USING (false);

COMMENT ON TABLE public.presentation_tokens IS
  'Signed bearer tokens for the public Ask AI runtime. Verified server-side; service-role only at rest.';