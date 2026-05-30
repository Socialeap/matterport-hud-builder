-- PR-A4: Enforce platform-routed release (additive trigger only)
CREATE OR REPLACE FUNCTION public._enforce_saved_models_release_via_platform()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (
        (NEW.status = 'paid' AND COALESCE(OLD.status, '') IS DISTINCT FROM 'paid')
        OR
        (COALESCE(NEW.is_released, false) = true AND COALESCE(OLD.is_released, false) = false)
     )
     AND auth.role() = ANY (ARRAY['authenticated', 'anon'])
  THEN
    RAISE EXCEPTION
      'saved_models can only be marked paid/released by the platform payment flow. Route the client through Stripe checkout (create-connect-checkout).'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_saved_models_release_guard
    BEFORE INSERT OR UPDATE ON public.saved_models
    FOR EACH ROW
    EXECUTE FUNCTION public._enforce_saved_models_release_via_platform();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;