## Diagnosis

PR #42 is fully wired in code:
- `supabase/migrations/20260501000000_studio_preview_tokens.sql` exists (table + `issue_studio_preview_token` + `verify_studio_preview_token` RPCs)
- `issueStudioPreviewToken` server fn in `src/lib/portal.functions.ts`
- `StudioPreviewPanel` fetches a token and appends `?previewToken=` to the iframe URL
- `src/routes/p.$slug.index.tsx` validates the token in its loader via `verify_studio_preview_token` and gates the embed on `embedPreviewValid`

I verified against the live database: `SELECT to_regclass('public.studio_preview_tokens')` returns NULL. The table and the two RPCs do not exist yet, which is exactly the failure path that surfaces the "Studio preview isn't provisioned on the database yet…" message in the Branding preview panel.

Note: the PR summary mentions an HMAC-signed approach using `PRESENTATION_TOKEN_SECRET`, but the migration's own header comment confirms the implementation was deliberately changed to a DB-row + RPC approach so the feature works without that secret. The shipped code matches the migration, not the PR summary's older description.

## Plan

Single step — apply the migration to the Lovable Cloud database:

1. Run `supabase/migrations/20260501000000_studio_preview_tokens.sql` against the project database. This:
   - Creates `public.studio_preview_tokens` (RLS enabled, all direct access denied)
   - Creates `public.issue_studio_preview_token(_slug text)` (SECURITY DEFINER, granted to `authenticated`)
   - Creates `public.verify_studio_preview_token(_token uuid, _slug text)` (SECURITY DEFINER, granted to `anon, authenticated`)

No code changes required. After the migration runs, reload the Branding tab — the Studio Preview iframe will obtain a token and the public route's loader will accept it, while public visitors hitting `?embed=studio-preview` without a valid token will continue to see "Coming Soon".

## Verification after apply

- `SELECT to_regclass('public.studio_preview_tokens');` returns the table
- Branding > Studio Preview renders the unpaid Studio (no error banner)
- `https://3dps.transcendencemedia.com/p/<slug>` (no params) still shows "Coming Soon"
- `https://3dps.transcendencemedia.com/p/<slug>?embed=studio-preview` (no token) still shows "Coming Soon"
