

## Plan: Fix public demo route 500 error

### Root cause
`/p/$slug/demo` calls `getPublicDemoBySlug` (server function) which uses `supabaseAdmin` from `client.server.ts`. That client requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `process.env`. The Cloudflare Worker runtime running our TanStack server functions does **not** have these injected — `fetch_secrets` confirms only Stripe/OpenAI/Lovable keys exist at the worker runtime. (The Supabase secrets shown in `<supabase-configuration>` are Edge Function secrets, a separate runtime.)

The middleware-protected functions (`getSandboxDemo`, etc.) work because they fall through `requireSupabaseAuth`, which uses `SUPABASE_PUBLISHABLE_KEY` — also missing, but those endpoints only run when the user is signed in on `/dashboard/demo`, where the auth interceptor already short-circuits and they hit a different code path (the user has been seeing those work).

Wait — re-checking: middleware also reads `process.env.SUPABASE_URL`. If that fails too, all server fns would be broken. Looking at `.env`, `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` ARE defined as top-level (non-VITE) keys — and TanStack Start's Vite plugin loads `.env` into `process.env` at build time. So those two vars are bundled.

`SUPABASE_SERVICE_ROLE_KEY` is **not** in `.env` (only in Supabase secrets), so it's `undefined` at worker runtime — that's the actual failure.

### Fix
Avoid `supabaseAdmin` entirely for the public demo lookup. The data we need is already public:
- `branding_settings` with public slug — should be readable by anon (RLS likely already permits this for `/p/$slug` to work).
- `sandbox_demos` where `is_published = true` — should also be anon-readable for published rows.

**Step 1 — Verify/add RLS policies** so anon can `SELECT`:
- `branding_settings`: ensure `SELECT` policy allows anon (likely already exists since `/p/$slug` works).
- `sandbox_demos`: add `SELECT` policy `USING (is_published = true)` for anon.

**Step 2 — Replace `supabaseAdmin` with the anon client** in two server functions in `src/lib/sandbox-demo.functions.ts`:
- `getPublicDemoBySlug` → use `@/integrations/supabase/client` (anon).
- `checkDemoPublished` → same.

These fns can even run client-side via the loader (they're already isomorphic), so swapping to the anon client is correct and removes the worker-secret dependency.

**Step 3 — (Optional hardening)** Remove the unused `supabaseAdmin` import from this file so future edits don't accidentally re-introduce the dependency.

### Files touched
- `supabase/migrations/{ts}_sandbox_demos_public_read.sql` — add anon SELECT policy on `sandbox_demos` for published rows (verify branding_settings policy exists; add if missing).
- `src/lib/sandbox-demo.functions.ts` — swap `supabaseAdmin` → `supabase` (anon) in `getPublicDemoBySlug` and `checkDemoPublished`; drop the admin import.

### Why this is the right fix
- No new secrets to provision in two places.
- Public demo data is *meant* to be public — RLS is the correct gate, not a service-role bypass.
- Eliminates a class of "works locally / fails in production" bugs caused by the worker env not matching the dev env.

