-- admin_get_user_emails_by_ids + admin_get_user_id_by_email
-- ─────────────────────────────────────────────────────────
-- Service-role-only helpers for batched lookups against `auth.users`.
--
-- Replaces two scale-bombs in src/lib/portal.functions.ts:
--   1. `getProviderOrders` previously called
--      `supabaseAdmin.auth.admin.getUserById(clientId)` once per client
--      (Promise.all over the array). For 50+ clients this hammers the
--      GoTrue admin API on every dashboard load and rate-limits.
--   2. `setClientFreeFlag` previously called
--      `supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 })`
--      to find a single user by email — silently broken once the
--      tenant has more than 200 users, and leaks all 200 user records
--      into worker memory each call.
--
-- Both are now collapsed into a single SQL query each, executed through
-- a SECURITY DEFINER RPC so the service role can read `auth.users.email`
-- without granting that read to authenticated users at the table level.
--
-- Authorization: REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO service_role.
-- The functions are unreachable from anon/authenticated JWTs even if
-- their schema name leaks. PostgREST surfaces them only because the
-- service role can call them.

-- ── 1. Batch resolver: user_ids → emails ─────────────────────────────
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
  'Service-role-only batch lookup of auth.users.email by id. Replaces '
  'the per-row auth.admin.getUserById N+1 pattern.';

REVOKE ALL ON FUNCTION public.admin_get_user_emails_by_ids(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_user_emails_by_ids(uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_user_emails_by_ids(uuid[]) TO service_role;

-- ── 2. Targeted lookup: email → user_id ──────────────────────────────
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
  'Service-role-only targeted lookup of auth.users.id by email '
  '(case-insensitive). Replaces auth.admin.listUsers({perPage:200}) + '
  'in-memory scan, which silently broke on tenants with > 200 users.';

REVOKE ALL ON FUNCTION public.admin_get_user_id_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_user_id_by_email(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_user_id_by_email(text) TO service_role;
