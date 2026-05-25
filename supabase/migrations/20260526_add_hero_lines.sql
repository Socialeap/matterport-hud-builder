-- Add a dedicated hero_lines JSONB column to branding_settings.
-- Stores an array of 3 objects: [{ text, color, fontFamily }, ...].
-- Empty array [] means "use the hardcoded default headline."
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
  ADD COLUMN IF NOT EXISTS hero_lines jsonb DEFAULT '[]'::jsonb;

-- Verification query (run separately after the ALTER):
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_name = 'branding_settings'
--    AND column_name = 'hero_lines';
-- Expected: one row showing  hero_lines | jsonb
