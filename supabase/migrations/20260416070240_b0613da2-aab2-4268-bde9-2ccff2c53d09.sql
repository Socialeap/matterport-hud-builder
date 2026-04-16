
-- Update handle_new_user to consume invite tokens
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    -- Look up valid invitation
    SELECT * INTO v_invitation
    FROM public.invitations
    WHERE token = v_token
      AND status = 'pending'
      AND expires_at > now()
    LIMIT 1;

    IF v_invitation.id IS NOT NULL THEN
      -- Link client to provider
      INSERT INTO public.client_providers (client_id, provider_id)
      VALUES (NEW.id, v_invitation.provider_id)
      ON CONFLICT DO NOTHING;

      -- Assign client role
      INSERT INTO public.user_roles (user_id, role)
      VALUES (NEW.id, 'client')
      ON CONFLICT (user_id, role) DO NOTHING;

      -- Update profile with provider_id
      UPDATE public.profiles
      SET provider_id = v_invitation.provider_id
      WHERE user_id = NEW.id;

      -- Mark invitation as accepted
      UPDATE public.invitations
      SET status = 'accepted', updated_at = now()
      WHERE id = v_invitation.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- RLS: Clients can view their provider's license
CREATE POLICY "Clients can view provider license"
ON public.licenses
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.client_providers cp
    WHERE cp.client_id = auth.uid()
      AND cp.provider_id = licenses.user_id
  )
);

-- Helper function for clients to get their provider's license
CREATE OR REPLACE FUNCTION public.get_provider_license(client_uuid uuid)
RETURNS TABLE(tier app_tier, license_status license_status, license_expiry timestamptz, studio_id uuid, provider_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT l.tier, l.license_status, l.license_expiry, l.studio_id, l.user_id as provider_id
  FROM public.licenses l
  INNER JOIN public.client_providers cp ON cp.provider_id = l.user_id
  WHERE cp.client_id = client_uuid
  LIMIT 1;
$$;
