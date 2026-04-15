
-- Auto-assign 'provider' role when a purchase is completed
CREATE OR REPLACE FUNCTION public.assign_provider_role_on_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.user_id, 'provider')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assign_provider_role
AFTER INSERT ON public.purchases
FOR EACH ROW
EXECUTE FUNCTION public.assign_provider_role_on_purchase();

-- Auto-assign 'client' role when a client_providers link is created
CREATE OR REPLACE FUNCTION public.assign_client_role_on_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.client_id, 'client')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assign_client_role
AFTER INSERT ON public.client_providers
FOR EACH ROW
EXECUTE FUNCTION public.assign_client_role_on_link();
