ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS is_free boolean NOT NULL DEFAULT false;

ALTER TABLE public.client_providers
  ADD COLUMN IF NOT EXISTS is_free boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_token uuid;
  v_invitation RECORD;
BEGIN
  -- Create profile
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  -- Check for invite token
  v_token := (NEW.raw_user_meta_data->>'invite_token')::uuid;

  IF v_token IS NOT NULL THEN
    SELECT * INTO v_invitation
    FROM public.invitations
    WHERE token = v_token
      AND status = 'pending'
      AND expires_at > now()
    LIMIT 1;

    IF v_invitation.id IS NOT NULL THEN
      -- Link client to provider, propagating is_free attribute
      INSERT INTO public.client_providers (client_id, provider_id, is_free)
      VALUES (NEW.id, v_invitation.provider_id, COALESCE(v_invitation.is_free, false))
      ON CONFLICT DO NOTHING;

      INSERT INTO public.user_roles (user_id, role)
      VALUES (NEW.id, 'client')
      ON CONFLICT (user_id, role) DO NOTHING;

      UPDATE public.profiles
      SET provider_id = v_invitation.provider_id
      WHERE user_id = NEW.id;

      UPDATE public.invitations
      SET status = 'accepted', updated_at = now()
      WHERE id = v_invitation.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;