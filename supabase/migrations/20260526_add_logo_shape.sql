-- Add logo_shape column to branding_settings.
-- Controls how the primary logo is rendered: 'circle', 'square', or 'landscape'.
--
-- ┌─────────────────────────────────────────────────────────────┐
-- │  HOW TO APPLY (Supabase Dashboard)                         │
-- │                                                            │
-- │  1. Go to https://supabase.com/dashboard                   │
-- │  2. Select your project                                    │
-- │  3. Click "SQL Editor" in the left sidebar                 │
-- │  4. Paste the SQL below into the editor                    │
-- │  5. Click "Run"                                            │
-- │  6. Verify: run the query at the bottom of this file       │
-- └─────────────────────────────────────────────────────────────┘

ALTER TABLE public.branding_settings
  ADD COLUMN IF NOT EXISTS logo_shape text NOT NULL DEFAULT 'circle';

-- Verification query (run separately after the ALTER):
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--  WHERE table_name = 'branding_settings'
--    AND column_name = 'logo_shape';
-- Expected: one row showing  logo_shape | text | 'circle'::text
