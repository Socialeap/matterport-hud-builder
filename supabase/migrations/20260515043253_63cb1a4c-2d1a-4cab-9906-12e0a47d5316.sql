ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS floor_plan_free_passes_used integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.consume_floor_plan_pass(
  p_user_id uuid,
  p_limit   int DEFAULT 3
) RETURNS TABLE (allowed boolean, used int, lifetime_limit int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used int;
BEGIN
  UPDATE public.profiles
     SET floor_plan_free_passes_used = floor_plan_free_passes_used + 1,
         updated_at = now()
   WHERE user_id = p_user_id
     AND floor_plan_free_passes_used < p_limit
  RETURNING floor_plan_free_passes_used INTO v_used;

  IF v_used IS NULL THEN
    SELECT COALESCE(floor_plan_free_passes_used, p_limit)
      INTO v_used
      FROM public.profiles
     WHERE user_id = p_user_id;
    IF v_used IS NULL THEN v_used := p_limit; END IF;
    RETURN QUERY SELECT false, v_used, p_limit;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_used, p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_floor_plan_pass(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_floor_plan_pass(uuid, int) TO service_role;

CREATE OR REPLACE FUNCTION public.read_floor_plan_pass_status()
RETURNS TABLE (used int, lifetime_limit int, byok_active boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT
      COALESCE(p.floor_plan_free_passes_used, 0),
      3,
      COALESCE(
        (SELECT k.active FROM public.client_byok_keys k
          WHERE k.client_id = v_uid AND k.vendor = 'gemini'),
        false
      )
    FROM (SELECT 1) _
    LEFT JOIN public.profiles p ON p.user_id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.read_floor_plan_pass_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_floor_plan_pass_status() TO authenticated;

COMMENT ON COLUMN public.profiles.floor_plan_free_passes_used IS
  'Lifetime count of AI-powered floor-plan vectorizations charged to the platform master key. BYOK users bypass this counter. Capped at 3 by consume_floor_plan_pass.';