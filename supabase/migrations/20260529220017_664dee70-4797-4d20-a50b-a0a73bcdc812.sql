-- PR-A2 part 1/2: Engine-1 directory_request binding trigger
CREATE OR REPLACE FUNCTION public._link_client_provider_on_work_order_confirm()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'confirmed'::public.work_order_status
     AND NEW.confirmed_provider_id IS NOT NULL
     AND NEW.agent_user_id IS NOT NULL
     AND (
          OLD.status IS DISTINCT FROM 'confirmed'::public.work_order_status
          OR OLD.confirmed_provider_id IS DISTINCT FROM NEW.confirmed_provider_id
         )
  THEN
    INSERT INTO public.client_providers (client_id, provider_id, acquisition_source)
    VALUES (NEW.agent_user_id, NEW.confirmed_provider_id, 'directory_request')
    ON CONFLICT (client_id, provider_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_work_order_confirm_links_client_provider
    AFTER UPDATE OF status, confirmed_provider_id ON public.work_orders
    FOR EACH ROW
    EXECUTE FUNCTION public._link_client_provider_on_work_order_confirm();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;