
DROP FUNCTION IF EXISTS public.read_byok_status(text);

CREATE OR REPLACE FUNCTION public.read_byok_status(
  p_vendor text DEFAULT 'gemini'
) RETURNS TABLE (
  has_key          boolean,
  vendor           text,
  fingerprint      text,
  active           boolean,
  validated_at     timestamptz,
  validation_error text,
  created_at       timestamptz,
  preferred_model  text
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
    k.created_at,
    k.preferred_model
  FROM (SELECT 1) AS _
  LEFT JOIN public.client_byok_keys k
    ON k.client_id = v_user_id AND k.vendor = p_vendor;
END;
$$;
REVOKE ALL ON FUNCTION public.read_byok_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_byok_status(text) TO authenticated;
