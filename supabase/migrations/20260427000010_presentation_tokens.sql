-- M2 — Signed presentation tokens for the public Ask AI runtime.
--
-- Embedded as `${id}.${signature}` in the exported HTML. The runtime
-- sends this verbatim to synthesize-answer, which:
--   1. splits the value at "."
--   2. looks up the row by `id` (uuid) via the service-role client
--   3. recomputes HMAC-SHA256(secret, canonical(payload))
--   4. constant-time compares the recomputed signature to the
--      received signature
--   5. checks revoked_at IS NULL and the linked saved_model is paid
--      and is_released
--
-- The signature itself never lives in the DB — only sha256(signature)
-- does, so a DB read alone cannot replay tokens. Revocation is fast:
-- set revoked_at and the verifier's lookup will refuse the token on
-- the next request.
--
-- ENV: PRESENTATION_TOKEN_SECRET must be set on both the TanStack
-- server-fn runtime (token issuance, in src/lib/portal.functions.ts)
-- and the Supabase edge runtime (verification, in
-- supabase/functions/_shared/presentation-token.ts).

CREATE TABLE IF NOT EXISTS public.presentation_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_model_id  uuid NOT NULL REFERENCES public.saved_models(id) ON DELETE CASCADE,
  -- sha256(signature) — used for constant-time match by the verifier.
  token_hash      text NOT NULL UNIQUE,
  -- Canonical-JSON payload over which the HMAC was computed. The
  -- verifier reads this back, re-canonicalizes, and recomputes HMAC.
  -- Shape: { saved_model_id, issued_at, scope }
  payload         jsonb NOT NULL,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  -- When rotated, points at the previous token id so audit trail is
  -- preserved without keeping the old hash live.
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

-- Service-role only. Tokens are issued from server functions and
-- verified from edge functions; they are never readable from the
-- browser. We deliberately do NOT add a "providers can read own"
-- policy because the row contains the hash, which (combined with
-- a known signature) would let a leaked dump be replayed.
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
