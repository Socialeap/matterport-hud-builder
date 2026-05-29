ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS acquisition_source TEXT NOT NULL DEFAULT 'scs_direct';

DO $$ BEGIN
  ALTER TABLE public.invitations
    ADD CONSTRAINT invitations_acquisition_source_check
    CHECK (acquisition_source IN ('map_oracle', 'agent_form', 'directory_request', 'scs_direct'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
  BEGIN
    INSERT INTO public.profiles (user_id, display_name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: profile insert failed for %: %', NEW.id, SQLERRM;
  END;

  v_token := (NEW.raw_user_meta_data->>'invite_token')::uuid;

  IF v_token IS NOT NULL THEN
    SELECT * INTO v_invitation
    FROM public.invitations
    WHERE token = v_token
      AND status = 'pending'
      AND expires_at > now()
    LIMIT 1;

    IF v_invitation.id IS NOT NULL THEN
      INSERT INTO public.client_providers (client_id, provider_id, is_free, acquisition_source)
      VALUES (
        NEW.id,
        v_invitation.provider_id,
        COALESCE(v_invitation.is_free, false),
        COALESCE(v_invitation.acquisition_source, 'scs_direct')
      )
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
  ELSE
    BEGIN
      INSERT INTO public.branding_settings (provider_id)
      VALUES (NEW.id)
      ON CONFLICT (provider_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user: branding_settings seed failed for %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;