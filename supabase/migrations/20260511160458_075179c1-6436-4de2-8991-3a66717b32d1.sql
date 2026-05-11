DROP FUNCTION IF EXISTS public.admin_get_user_emails_by_ids(uuid[]);

CREATE OR REPLACE FUNCTION public.admin_get_user_emails_by_ids(
  _ids uuid[]
) RETURNS TABLE (
  user_id uuid,
  email   text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  SELECT u.id, u.email
  FROM auth.users u
  WHERE u.id = ANY(_ids);
$$;

COMMENT ON FUNCTION public.admin_get_user_emails_by_ids(uuid[]) IS
  'Service-role-only batch lookup of auth.users.email by id. Replaces the per-row auth.admin.getUserById N+1 pattern.';

REVOKE ALL ON FUNCTION public.admin_get_user_emails_by_ids(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_user_emails_by_ids(uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_user_emails_by_ids(uuid[]) TO service_role;

DROP FUNCTION IF EXISTS public.admin_get_user_id_by_email(text);

CREATE OR REPLACE FUNCTION public.admin_get_user_id_by_email(
  _email text
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  SELECT u.id
  FROM auth.users u
  WHERE LOWER(u.email) = LOWER(_email)
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.admin_get_user_id_by_email(text) IS
  'Service-role-only targeted lookup of auth.users.id by email (case-insensitive). Replaces auth.admin.listUsers({perPage:200}) + in-memory scan, which silently broke on tenants with > 200 users.';

REVOKE ALL ON FUNCTION public.admin_get_user_id_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_user_id_by_email(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_user_id_by_email(text) TO service_role;