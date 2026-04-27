-- M4 — BYOK (Bring Your Own Key) for the public Ask AI synthesis path.
--
-- The Gemini API key is stored encrypted with AES-GCM under the
-- BYOK_MASTER_KEY environment secret (set on the validate-byok and
-- synthesize-answer edge functions). The browser sees only a
-- masked fingerprint; the plaintext key never leaves the edge
-- function that decrypts it for the model call.
--
-- A successful validate-byok call:
--   • encrypts the key with a random 96-bit IV
--   • makes a probe call to Gemini's listModels endpoint
--   • on probe success, sets active = true, validated_at = now()
--   • flips ask_quota_counters.byok_active for every (saved_model,
--     property) belonging to the provider's MSP (per the design Q&A:
--     immediate reinstatement, no re-export needed)

CREATE TABLE IF NOT EXISTS public.provider_byok_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor        text NOT NULL CHECK (vendor IN ('gemini')),
  -- AES-GCM ciphertext + nonce. Plaintext is the API key value.
  ciphertext    bytea NOT NULL,
  iv            bytea NOT NULL CHECK (octet_length(iv) = 12),
  -- Last 4 chars of the plaintext, for masked UI display only.
  -- Storing the suffix (not the prefix) so the value is unguessable
  -- from the masked form (Gemini keys all start with "AIza" — the
  -- prefix is not a discriminator).
  fingerprint   text NOT NULL,
  active        boolean NOT NULL DEFAULT false,
  validated_at  timestamptz,
  validation_error text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  rotated_at    timestamptz,
  UNIQUE (provider_id, vendor)
);

CREATE INDEX IF NOT EXISTS provider_byok_keys_active_idx
  ON public.provider_byok_keys (provider_id)
  WHERE active = true;

ALTER TABLE public.provider_byok_keys ENABLE ROW LEVEL SECURITY;

-- Providers can SELECT their own metadata (everything except ciphertext + iv)
-- via a security-definer accessor. The ciphertext column itself is
-- service-role only — RLS forbids direct reads even for the owner so
-- a SQL injection cannot exfiltrate the encrypted blob from a logged-in
-- session.
CREATE POLICY provider_byok_keys_owner_select_meta
  ON public.provider_byok_keys FOR SELECT
  USING (false);
CREATE POLICY provider_byok_keys_owner_insert
  ON public.provider_byok_keys FOR INSERT
  WITH CHECK (false);
CREATE POLICY provider_byok_keys_owner_update
  ON public.provider_byok_keys FOR UPDATE
  USING (false);
CREATE POLICY provider_byok_keys_owner_delete
  ON public.provider_byok_keys FOR DELETE
  USING (false);

-- Read-only metadata accessor for the owner. Returns the masked
-- fingerprint, active flag, validated_at, and validation_error —
-- never the ciphertext.
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
  LEFT JOIN public.provider_byok_keys k
    ON k.provider_id = v_user_id AND k.vendor = p_vendor;
END;
$$;

REVOKE ALL ON FUNCTION public.read_byok_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_byok_status(text) TO authenticated;

-- Mark BYOK active/inactive for every quota counter belonging to a
-- provider's MSP. Called by validate-byok after a successful probe.
-- Iterates through saved_models.provider_id = p_provider_id and
-- updates the per-(saved_model_id, property_uuid) counter rows.
CREATE OR REPLACE FUNCTION public.set_provider_byok_active(
  p_provider_id uuid,
  p_active      boolean
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  -- Ensure quota counter rows exist for every property in every
  -- released saved_model under this provider, then flip byok_active.
  WITH provider_models AS (
    SELECT id AS saved_model_id, properties
      FROM public.saved_models
     WHERE provider_id = p_provider_id
  ),
  property_rows AS (
    SELECT
      m.saved_model_id,
      jsonb_array_elements(m.properties)->>'id' AS property_uuid
    FROM provider_models m
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

REVOKE ALL ON FUNCTION public.set_provider_byok_active(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_provider_byok_active(uuid, boolean) TO service_role;

COMMENT ON TABLE public.provider_byok_keys IS
  'Bring-your-own-key Gemini API keys, encrypted with AES-GCM under BYOK_MASTER_KEY env secret. Service-role only at rest; metadata exposed via read_byok_status().';
