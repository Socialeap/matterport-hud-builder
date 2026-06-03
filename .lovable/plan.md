# Atlas Curated Showcase HUD — Post-Merge Verification & Republish

## Goal
Confirm the merged PR (curated showcase HUD + Explore Together) is live in code, regenerate the Opera Gallery New York showcase so its static `index.html` includes the new HUD, publish it through the existing GitHub → Netlify pipeline, and smoke-test the shared live tour. No unrelated systems are touched.

## Step 1 — Confirm code state (no edits)
- Read `src/lib/atlas-curation-server.ts` `renderCuratedHtml` and confirm it renders: top `f3d-bar` with Share, About, optional Claim, and the Live Tour launch button; About/Summary backdrop; `atlas-live-tour` overlay.
- Read `src/lib/atlas-live-tour.ts` and `src/lib/atlas-live-tour-runtime.mjs` to confirm Explore Together is wired (host/guest PIN, PeerJS via CDN, mic + graceful fallback, location sync, annotations, cleanup).
- Read `src/lib/atlas-showcase-publish.ts` + `src/lib/atlas-curation.functions.ts` to confirm the publish pipeline (PR to `Socialeap/frontiers3d-atlas-showcases`, `verifyDeployedShowcase` gate, `markShowcaseDeployed`) is unchanged.
- Read `src/routes/_authenticated.admin.atlas-curation.tsx` to confirm the admin "Generate package → open PR → Mark deployed" flow.

## Step 2 — Backend activation check
- Diff recent migrations under `supabase/migrations/` against the last activation entry in `BACKEND_ACTIVATION.md`. Expected: **NO** new migration, **NO** new secret. The HUD/Live Tour ships inside the generated static `index.html`; existing secrets (`ATLAS_SHOWCASES_GITHUB_TOKEN`, `NETLIFY_ATLAS_DEPLOY_TOKEN`, `NETLIFY_ATLAS_SITE_ID`) cover publishing.
- Append a short "Atlas HUD Republish (2026-06-03)" section to `BACKEND_ACTIVATION.md` recording the verification (no DB/secret change).

## Step 3 — Regenerate Opera Gallery New York
- From `/admin/atlas-curation`, open the existing Opera Gallery New York job and run **Generate package** so a fresh `index.html` + `atlas-manifest.json` are produced from the current `renderCuratedHtml` + `atlas-live-tour` template (includes Share, About, Claim if wired, Explore Together).
- Use **Open PR** to push the regenerated `opera-gallery-new-york/` folder to `Socialeap/frontiers3d-atlas-showcases`. Capture the PR URL.

## Step 4 — Merge + deploy
- Merge the showcase PR on GitHub. Netlify auto-deploys the showcases site.
- Wait for the Netlify build to finish, then run **Mark deployed & attach URL** in the admin. `verifyDeployedShowcase` hard-gates `publish_status='published'` on:
  - HTTP 200 at `/opera-gallery-new-york/`
  - HTTP 200 at `/opera-gallery-new-york/atlas-manifest.json`
  - `manifest.service === "frontiers3d-atlas"` and `manifest.kind === "curated_showcase"`

## Step 5 — Live URL verification
- Manually re-curl the two URLs above on both Netlify and GitHub Pages and record status codes + manifest values in the final report.

## Step 6 — Two-browser Explore Together smoke test
Using the browser tool on the deployed Netlify URL:
- Browser A: open the showcase, click **Explore Together**, host a session, capture PIN.
- Browser B: open the same URL in a fresh session, join with PIN, confirm guest connects.
- Verify: mic prompt path (and graceful fallback when denied), shared location/view sync, annotation/draw/focus if exposed, leave/close cleans up overlay and re-shows the page footer.
- Note: real microphone capture and cross-browser WebRTC peering may be limited inside the automation sandbox; if so, report the limitation and recommend a human re-test.

## Step 7 — Confirm exclusions
Grep the regenerated `index.html` (downloaded from Netlify) to confirm it does **not** contain: Ask AI, floor map, media gallery, password gate, Stripe, billing, outreach/email, or auto-activation hooks. Curated listing stays `kind='curated_showcase'` and is NOT auto-flipped to `status='active'`.

## Step 8 — Final report
Deliver in chat:
- Backend activation required (expected NO + reason)
- Showcase repo PR URL
- Deployed Netlify showcase URL
- Manifest verification result (service / kind / both 200s)
- Two-browser Explore Together result (with any permission caveats)
- Confirmation that no unrelated systems were touched

## Out of scope (will not touch)
Outreach/email, Stripe/billing, Map Oracle, Track A, provider directory, auto-activation of any Atlas listing, prospect emails.

## Technical notes
- All HUD code lives in `src/lib/atlas-curation-server.ts` + `src/lib/atlas-live-tour*` and is inlined into the generated static `index.html` (self-contained, no phone-home).
- PeerJS loads from CDN at runtime inside the showcase page; the showcase still requires no backend calls.
- If verification fails post-merge, `markShowcaseDeployed` will set `publish_status='failed'` rather than silently publishing — that is the intended guard.