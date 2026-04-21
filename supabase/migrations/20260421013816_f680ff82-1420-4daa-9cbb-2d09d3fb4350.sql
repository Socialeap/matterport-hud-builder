-- 1) Add 'declined' to invitation_status enum
ALTER TYPE public.invitation_status ADD VALUE IF NOT EXISTS 'declined';

-- 2) Public lookup by token (returns safe subset only). SECURITY DEFINER so
--    anonymous visitors can resolve the token without us widening RLS on the
--    invitations table itself.
CREATE OR REPLACE FUNCTION public.get_invitation_by_token(_token uuid)
RETURNS TABLE(
  email text,
  status public.invitation_status,
  is_free boolean,
  expires_at timestamptz,
  provider_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.email, i.status, i.is_free, i.expires_at, i.provider_id
  FROM public.invitations i
  WHERE i.token = _token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(uuid) TO anon, authenticated;

-- 3) Accept invitation when the client is already signed in. Validates the
--    caller is signed in, that the auth user's email matches the invitation,
--    that the invitation is still pending and not expired, then links the
--    client to the provider and marks accepted.
CREATE OR REPLACE FUNCTION public.accept_invitation_self(_token uuid)
RETURNS TABLE(provider_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_invitation RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_invitation
  FROM public.invitations
  WHERE token = _token
  LIMIT 1;

  IF v_invitation.id IS NULL THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_invitation.status <> 'pending' THEN
    RAISE EXCEPTION 'Invitation is no longer pending' USING ERRCODE = 'P0001';
  END IF;
  IF v_invitation.expires_at <= now() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = 'P0001';
  END IF;
  IF lower(v_invitation.email) <> lower(v_user_email) THEN
    RAISE EXCEPTION 'Invitation email does not match the signed-in user' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.client_providers (client_id, provider_id, is_free)
  VALUES (v_user_id, v_invitation.provider_id, COALESCE(v_invitation.is_free, false))
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'client')
  ON CONFLICT (user_id, role) DO NOTHING;

  UPDATE public.profiles
  SET provider_id = v_invitation.provider_id
  WHERE user_id = v_user_id;

  UPDATE public.invitations
  SET status = 'accepted', updated_at = now()
  WHERE id = v_invitation.id;

  provider_id := v_invitation.provider_id;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_invitation_self(uuid) TO authenticated;

-- 4) Decline invitation (no auth required — invitee may not have an account)
CREATE OR REPLACE FUNCTION public.decline_invitation(_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.invitations
  SET status = 'declined', updated_at = now()
  WHERE token = _token AND status = 'pending';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decline_invitation(uuid) TO anon, authenticated;