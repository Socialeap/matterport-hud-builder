
-- 1. Add model_status enum
CREATE TYPE public.model_status AS ENUM ('preview', 'pending_payment', 'paid');

-- 2. Add status and is_released to saved_models
ALTER TABLE public.saved_models
  ADD COLUMN status public.model_status NOT NULL DEFAULT 'preview',
  ADD COLUMN is_released boolean NOT NULL DEFAULT false;

-- 3. Add payment_link, payment_instructions, slug to branding_settings
ALTER TABLE public.branding_settings
  ADD COLUMN payment_link text,
  ADD COLUMN payment_instructions text,
  ADD COLUMN slug text;

-- Create unique index on slug (only for non-null values)
CREATE UNIQUE INDEX idx_branding_settings_slug ON public.branding_settings (slug) WHERE slug IS NOT NULL;

-- 4. Add provider_id to profiles
ALTER TABLE public.profiles
  ADD COLUMN provider_id uuid;

-- 5. Create order_notifications table
CREATE TABLE public.order_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL,
  client_id uuid NOT NULL,
  model_id uuid NOT NULL REFERENCES public.saved_models(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'unread',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_notifications ENABLE ROW LEVEL SECURITY;

-- Providers can view their own notifications
CREATE POLICY "Providers can view their notifications"
  ON public.order_notifications
  FOR SELECT
  TO authenticated
  USING (provider_id = auth.uid());

-- Providers can update their own notifications (mark as read)
CREATE POLICY "Providers can update their notifications"
  ON public.order_notifications
  FOR UPDATE
  TO authenticated
  USING (provider_id = auth.uid());

-- Clients can view their own notifications
CREATE POLICY "Clients can view their notifications"
  ON public.order_notifications
  FOR SELECT
  TO authenticated
  USING (client_id = auth.uid());

-- Clients can insert notifications (when they click Purchase)
CREATE POLICY "Clients can create notifications"
  ON public.order_notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (client_id = auth.uid());

-- RLS policy: providers can update status/is_released on their models
CREATE POLICY "Providers can update model status"
  ON public.saved_models
  FOR UPDATE
  TO authenticated
  USING (provider_id = auth.uid());

-- Trigger for updated_at on order_notifications
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_order_notifications_updated_at
  BEFORE UPDATE ON public.order_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
