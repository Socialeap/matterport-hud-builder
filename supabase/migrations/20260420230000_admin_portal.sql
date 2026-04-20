-- Admin portal: admin_grants table, RLS admin-select policies, role seed

-- ─── admin_grants ────────────────────────────────────────────────────────────
CREATE TABLE public.admin_grants (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by    uuid        NOT NULL REFERENCES auth.users(id),
  tier          public.app_tier NOT NULL DEFAULT 'starter',
  expires_at    timestamptz,        -- NULL = lifetime
  revoked_at    timestamptz,        -- NULL = still active
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.admin_grants (provider_id);
ALTER TABLE public.admin_grants ENABLE ROW LEVEL SECURITY;

-- Admins can fully manage grants
CREATE POLICY "admin_manage_grants"
  ON public.admin_grants FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Providers can read their own grant (to show the expiry alert on the dashboard)
CREATE POLICY "provider_read_own_grant"
  ON public.admin_grants FOR SELECT
  USING (provider_id = auth.uid());

-- ─── Admin SELECT policies on key tables ─────────────────────────────────────
CREATE POLICY "admin_select_all_branding_settings"
  ON public.branding_settings FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin_select_all_page_visits"
  ON public.page_visits FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin_select_all_saved_models"
  ON public.saved_models FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin_select_all_profiles"
  ON public.profiles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin_select_all_client_providers"
  ON public.client_providers FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin_select_all_licenses"
  ON public.licenses FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin_select_all_order_notifications"
  ON public.order_notifications FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Allow admin to update branding_settings (needed for grant tier changes)
CREATE POLICY "admin_update_all_branding_settings"
  ON public.branding_settings FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

-- Allow admin to upsert licenses (needed when granting a tier)
CREATE POLICY "admin_upsert_licenses"
  ON public.licenses FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- ─── Admin helper function: provider list ────────────────────────────────────
-- Returns all MSP rows (branding_settings + profile + email) for admin callers.
-- SECURITY DEFINER so it can read auth.users; aborts if caller is not admin.
CREATE OR REPLACE FUNCTION public.get_providers_for_admin()
RETURNS TABLE (
  provider_id   uuid,
  brand_name    text,
  slug          text,
  tier          public.app_tier,
  display_name  text,
  email         text,
  start_date    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    bs.provider_id,
    bs.brand_name,
    bs.slug,
    bs.tier,
    p.display_name,
    au.email::text,
    au.created_at AS start_date
  FROM public.branding_settings bs
  JOIN public.profiles p ON p.user_id = bs.provider_id
  JOIN auth.users au ON au.id = bs.provider_id
  ORDER BY au.created_at DESC;
END;
$$;

-- ─── Admin role seed ──────────────────────────────────────────────────────────
-- Silently no-ops if shakoure@transcendencemedia.com has not signed up yet.
-- Re-run this block manually after first login if the user row wasn't present.
DO $$
DECLARE v_uid uuid;
BEGIN
  SELECT id INTO v_uid
    FROM auth.users
   WHERE email = 'shakoure@transcendencemedia.com'
   LIMIT 1;
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_uid, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
END $$;
