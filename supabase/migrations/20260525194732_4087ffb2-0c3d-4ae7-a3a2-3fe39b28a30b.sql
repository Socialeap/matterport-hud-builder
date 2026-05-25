-- Remove the broad public SELECT policy on branding_settings.
-- Public-facing pages now fetch a curated, sanitized projection via
-- trusted server functions (supabaseAdmin) instead of relying on a
-- permissive RLS policy that exposed Stripe Connect IDs, payout fees,
-- and the directory contact email to anyone with a slug.
DROP POLICY IF EXISTS "Anyone can view branding by slug" ON public.branding_settings;