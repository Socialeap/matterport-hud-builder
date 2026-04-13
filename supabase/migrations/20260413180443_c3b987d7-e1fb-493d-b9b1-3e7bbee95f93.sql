
-- Create role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'provider', 'client');

-- Create tier enum
CREATE TYPE public.app_tier AS ENUM ('starter', 'pro');

-- Create invitation status enum
CREATE TYPE public.invitation_status AS ENUM ('pending', 'accepted', 'expired');

-- ============================================================
-- PROFILES TABLE
-- ============================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- USER_ROLES TABLE
-- ============================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

-- Security definer function to check roles (avoids recursive RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Only admins can insert roles
CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete roles"
  ON public.user_roles FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- BRANDING_SETTINGS TABLE
-- ============================================================
CREATE TABLE public.branding_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_name TEXT NOT NULL DEFAULT '',
  accent_color TEXT NOT NULL DEFAULT '#3B82F6',
  hud_bg_color TEXT NOT NULL DEFAULT '#1a1a2e',
  gate_label TEXT NOT NULL DEFAULT 'Enter',
  logo_url TEXT,
  favicon_url TEXT,
  tier app_tier NOT NULL DEFAULT 'starter',
  custom_domain TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id)
);

ALTER TABLE public.branding_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Providers can view their own branding"
  ON public.branding_settings FOR SELECT
  USING (auth.uid() = provider_id);

CREATE POLICY "Providers can update their own branding"
  ON public.branding_settings FOR UPDATE
  USING (auth.uid() = provider_id);

CREATE POLICY "Providers can insert their own branding"
  ON public.branding_settings FOR INSERT
  WITH CHECK (auth.uid() = provider_id);

-- ============================================================
-- INVITATIONS TABLE
-- ============================================================
CREATE TABLE public.invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token UUID NOT NULL DEFAULT gen_random_uuid(),
  status invitation_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, email)
);

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Providers can view their own invitations"
  ON public.invitations FOR SELECT
  USING (auth.uid() = provider_id);

CREATE POLICY "Providers can create invitations"
  ON public.invitations FOR INSERT
  WITH CHECK (auth.uid() = provider_id AND public.has_role(auth.uid(), 'provider'));

CREATE POLICY "Providers can update their own invitations"
  ON public.invitations FOR UPDATE
  USING (auth.uid() = provider_id);

CREATE POLICY "Providers can delete their own invitations"
  ON public.invitations FOR DELETE
  USING (auth.uid() = provider_id);

-- ============================================================
-- SAVED_MODELS TABLE
-- ============================================================
CREATE TABLE public.saved_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled Presentation',
  properties JSONB NOT NULL DEFAULT '[]'::jsonb,
  tour_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.saved_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients can view their own models"
  ON public.saved_models FOR SELECT
  USING (auth.uid() = client_id);

CREATE POLICY "Clients can insert their own models"
  ON public.saved_models FOR INSERT
  WITH CHECK (auth.uid() = client_id);

CREATE POLICY "Clients can update their own models"
  ON public.saved_models FOR UPDATE
  USING (auth.uid() = client_id);

CREATE POLICY "Clients can delete their own models"
  ON public.saved_models FOR DELETE
  USING (auth.uid() = client_id);

CREATE POLICY "Providers can view models under their account"
  ON public.saved_models FOR SELECT
  USING (auth.uid() = provider_id);

-- ============================================================
-- CLIENT_PROVIDERS junction (link clients to providers)
-- ============================================================
CREATE TABLE public.client_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, provider_id)
);

ALTER TABLE public.client_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Providers can view their clients"
  ON public.client_providers FOR SELECT
  USING (auth.uid() = provider_id);

CREATE POLICY "Clients can view their provider"
  ON public.client_providers FOR SELECT
  USING (auth.uid() = client_id);

-- ============================================================
-- SHARED TRIGGERS
-- ============================================================

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_branding_settings_updated_at
  BEFORE UPDATE ON public.branding_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_invitations_updated_at
  BEFORE UPDATE ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_saved_models_updated_at
  BEFORE UPDATE ON public.saved_models
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- STORAGE BUCKET for brand assets
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('brand-assets', 'brand-assets', true);

CREATE POLICY "Brand assets are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'brand-assets');

CREATE POLICY "Providers can upload brand assets"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'brand-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Providers can update their brand assets"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'brand-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Providers can delete their brand assets"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'brand-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
