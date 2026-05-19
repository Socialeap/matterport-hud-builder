-- 1) Backfill: any active Starter/Pro license must have the provider role
INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT l.user_id, 'provider'::public.app_role
FROM public.licenses l
WHERE l.license_status = 'active'::public.license_status
  AND l.tier IN ('starter'::public.app_tier, 'pro'::public.app_tier)
  AND (l.license_expiry IS NULL OR l.license_expiry > now())
ON CONFLICT (user_id, role) DO NOTHING;

-- Backfill from active admin grants
INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT ag.provider_id, 'provider'::public.app_role
FROM public.admin_grants ag
WHERE ag.revoked_at IS NULL
  AND (ag.expires_at IS NULL OR ag.expires_at > now())
ON CONFLICT (user_id, role) DO NOTHING;

-- Backfill from completed purchases (safety in case trigger was ever skipped)
INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT p.user_id, 'provider'::public.app_role
FROM public.purchases p
WHERE p.status = 'completed'
ON CONFLICT (user_id, role) DO NOTHING;

-- 2) License-driven role grant (covers admin grants that flow into licenses,
--    Stripe webhook upserts that hit UPDATE rather than INSERT, etc.)
CREATE OR REPLACE FUNCTION public.assign_provider_role_on_license()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.license_status = 'active'::public.license_status
     AND NEW.tier IN ('starter'::public.app_tier, 'pro'::public.app_tier) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.user_id, 'provider'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_provider_role_on_license ON public.licenses;
CREATE TRIGGER trg_assign_provider_role_on_license
AFTER INSERT OR UPDATE OF license_status, tier ON public.licenses
FOR EACH ROW
EXECUTE FUNCTION public.assign_provider_role_on_license();

-- 3) Extend purchases trigger to also fire on UPDATE of status (pending -> completed)
DROP TRIGGER IF EXISTS trg_assign_provider_role ON public.purchases;
CREATE TRIGGER trg_assign_provider_role
AFTER INSERT OR UPDATE OF status ON public.purchases
FOR EACH ROW
EXECUTE FUNCTION public.assign_provider_role_on_purchase();

-- 4) Admin-grant-driven role grant
CREATE OR REPLACE FUNCTION public.assign_provider_role_on_admin_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.revoked_at IS NULL
     AND (NEW.expires_at IS NULL OR NEW.expires_at > now()) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.provider_id, 'provider'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_provider_role_on_admin_grant ON public.admin_grants;
CREATE TRIGGER trg_assign_provider_role_on_admin_grant
AFTER INSERT OR UPDATE OF revoked_at, expires_at ON public.admin_grants
FOR EACH ROW
EXECUTE FUNCTION public.assign_provider_role_on_admin_grant();