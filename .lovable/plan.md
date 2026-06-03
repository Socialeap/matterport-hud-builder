## Current state (verified just now)

- `public.atlas_curation_jobs` exists ✅ (applied 2026-06-02).
- Columns added by `20260611…_atlas_curation_build.sql` (`build_status`, `built_at`, `package_filename`, `package_size_bytes`, `build_error`) → **not present**.
- Columns added by `20260612…_atlas_showcase_publish.sql` (`showcase_slug`, `publish_status`, `showcase_pr_url`, `deployed_url`, `published_at`, `publish_error`) → **not present**.
- Source already merged: `src/lib/atlas-showcase-publish.ts`, `atlas-curation-server.ts`, updated `atlas-curation.functions.ts`.
- Configured secrets do **not** include `ATLAS_SHOWCASES_GITHUB_TOKEN`, `NETLIFY_ATLAS_DEPLOY_TOKEN`, or `NETLIFY_ATLAS_SITE_ID`. `NETLIFY_OAUTH_CLIENT_ID` / `NETLIFY_OAUTH_CLIENT_SECRET` exist but are unrelated (different purpose).

So PR 140 is merged in code but **fully un-activated** on the backend.

## What I will do (build mode)

1. **Apply migration 20260611000000_frontiers3d_atlas_curation_build.sql** verbatim via `supabase--migration` (additive `add column if not exists` only — non-destructive, idempotent, no RLS/grant changes needed since the table already has them).

2. **Apply migration 20260612000000_frontiers3d_atlas_showcase_publish.sql** verbatim via `supabase--migration` (same shape: additive `add column if not exists` with a status check). Run as a separate migration call so each is reviewable.

3. **Request the three server-only secrets** via `secrets--add_secret`:
   - `ATLAS_SHOWCASES_GITHUB_TOKEN` — fine-grained GitHub PAT scoped to `Socialeap/frontiers3d-atlas-showcases` with Contents: read/write + Pull requests: read/write.
   - `NETLIFY_ATLAS_DEPLOY_TOKEN` — **freshly rotated** Netlify personal access token (the one previously pasted in chat is considered exposed and must not be reused).
   - `NETLIFY_ATLAS_SITE_ID` — the API ID of the one Netlify site connected to the showcases repo (Netlify → Site → Site configuration → Site details → Site ID).

4. **Update `BACKEND_ACTIVATION.md`** with a new "Atlas Showcase Publishing Activation (2026-06-03)" entry: which migrations were applied, verification SQL + results, secrets requested, security note about the rotated Netlify token, and the explicit boundary list (no outreach, no email, no billing, no auto-activation, no per-listing Netlify sites, no client-bundle token exposure).

5. **Verification SQL I will run after each migration:**
   ```sql
   SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='atlas_curation_jobs'
     AND column_name IN ('build_status','publish_status','showcase_slug',
       'showcase_pr_url','deployed_url','published_at','publish_error',
       'built_at','package_filename','package_size_bytes','build_error');
   ```
   Expect all 11 column names.

## What I cannot do for you (and will report as blockers)

These require either platform-side access or live admin interaction and cannot be done from the agent:

- **Confirm the Netlify site is connected to `Socialeap/frontiers3d-atlas-showcases`** — visible only in your Netlify account. I'll list it as a manual check.
- **Confirm GitHub token + Netlify token are valid against the repo / site** — first real PR open call will surface this; I'll add a one-shot diagnostic note in `BACKEND_ACTIVATION.md`.
- **Run the end-to-end smoke test** (create curated job → generate package → open PR → merge → "Mark deployed & attach URL" → verify `presentation_url`, listing stays inactive). This is the `/admin/atlas-curation` flow and must be driven by a signed-in admin in the browser. I'll provide a checklist mirroring your 6 sub-steps.

## Final report I'll deliver

Per your "Please report" list:
- Migrations: state before/after for both files (newly applied).
- Secrets: which 3 were just added vs already present.
- Showcase PR URL, deployed Netlify URL, atlas_entry id, inactive status → **deferred to your smoke test** (with the exact SQL to confirm `atlas_entries.status='inactive'` and `presentation_url` set).
- Blockers/follow-ups: Netlify site-connection check + token validity, plus the smoke test itself.

## Safety boundaries respected

Only additive column changes; no DROP/DELETE/TRUNCATE; no RLS or grant edits; no outreach, email, Stripe, or auto-activation code touched; secrets stay server-only (consumed via `process.env` inside `src/lib/atlas-showcase-publish.ts`, which is reached only via dynamic import from server-fn handlers, so they never enter the client bundle).
