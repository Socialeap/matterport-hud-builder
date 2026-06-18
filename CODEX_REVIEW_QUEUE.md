# Codex Review Queue

## Recently merged (main context)

- **PR #177** (docs: Atlas showcase-merge reconciliation) — MERGED into `main`.
  `BACKEND_ACTIVATION.md` now records `20260613000000_frontiers3d_atlas_showcase_merge.sql`
  as **APPLIED & VERIFIED**; `atlas-discovery.md` obsolete migration gap cleared.
- **PR #176** (visual-map cockpit) + **PR #175** (PWA/App Shell) — MERGED into `main`.

## Current Review Request

- **Timestamp:** 2026-06-18
- **Repository:** /Users/shakoure/matterport-hud-builder (Socialeap)
- **Branch:** `frontiers3d/atlas-showcase-auto-attach`, base `main` (latest `main` merged in; conflicts resolved in handoff files only).
- **PR:** #178 — `feat(atlas): auto-attach deployed showcase URL after PR merge`
- **Base commit:** `origin/main` · **Head commit:** pending (post-merge)
- **Status:** ready for review
- **Summary:** Closes the "stuck on awaiting deploy" gap in Atlas showcase publishing.
  The merge → verify → attach backend already existed, but the in-merge poll is
  only ~15s, so real Netlify deploys land in `pending_deploy` and needed a manual
  "Retry deploy & attach". Adds a **non-destructive** `pollShowcaseDeployment`
  server fn (verify the deployed URL → attach `presentation_url` on success →
  leave `pending_deploy` on a slow deploy; **never** `failed`) and a bounded
  **client auto-poll** (~6s then 8s × up to 12) after Approve & Publish so the
  live URL attaches on its own. Pending badge shows "checking deploy…". Manual
  "Retry deploy & attach" remains as fallback.
- **Files changed:**
  - `src/lib/atlas-showcase-deploy-plan.mjs` (+ `.d.mts`) — NEW pure `planShowcaseDeploymentOutcome` (ok→published+attach; not-ok→pending_deploy, retryable, never failed).
  - `src/lib/atlas-curation.functions.ts` — NEW `pollShowcaseDeployment` server fn (admin-gated; reuses `resolveShowcaseUrl`/`defaultShowcaseUrl`/`verifyDeployedShowcase`).
  - `src/routes/_authenticated.admin.atlas-curation.tsx` — bounded auto-poll after merge + "checking deploy…" indicator.
  - `tests/atlas-showcase-deploy-plan.test.mjs` (4) + `tests/atlas-showcase-auto-attach.test.mjs` (6, source guards incl. no-client-secret).
- **No new DB columns/migrations** — uses existing `publish_status`/`deployed_url`/`published_at`/`publish_error`/`showcase_slug`/`atlas_entry_id` + `atlas_entries.presentation_url`.
- **Verification:** `tsc` 0; `test:intelligence` 583/583 (10 new); `verify:no-secrets` PASS; eslint clean on changed files; `vite build` OK (pre-existing routeTree SSR-register drift reverted). Deterministic-URL + verify-gate + no-false-success + secret-confinement covered by tests.
- **Manual acceptance (pending — owner, needs a live Netlify deploy):**
  1. Generate curated showcase.
  2. Approve & Publish (merges showcase PR).
  3. Watch the pending badge show "checking deploy…".
  4. Presentation URL auto-fills once Netlify is live.
  5. Public `/atlas` opens the listing and loads the Netlify showcase.
  6. Listing activation remains manual/intentional (stays inactive until activated).
- **Known failures / risks:** None. Auto-poll is bounded + non-destructive; manual retry preserved. Server fns deploy with the app (Lovable "Publish → Update"); no Supabase activation.
- **Backend Activation Required:** NO — application/server-fn code only; no migration, Edge Function, secret, RLS, storage, or webhook. Reuses already-configured server-only `ATLAS_SHOWCASES_GITHUB_TOKEN` / `NETLIFY_ATLAS_*`.
- **End-State Alignment:**
  - Component: Atlas Discovery / Atlas Curation + Showcase Publishing
  - Approved outcome advanced: Curated showcases reach `published` with the live URL attached automatically once Netlify deploys — no manual URL step — listing stays inactive until explicit activation.
  - Boundaries preserved: Hard verify gate (no false success); never auto-activates; non-destructive poll; secrets server-only; no runtime refactor.
  - Cross-component effects: Editor's Presentation URL auto-populates from the attached `presentation_url`.
  - Acceptance evidence: 583/583 tests incl. 10 new; verify-gate + transition + secret-confinement unit/source tests; manual live acceptance pending.
  - Remaining gap: Manual end-to-end acceptance against a live Netlify deploy; admin branch-protection check.
  - PRODUCT_END_STATES.md revision required: NO.
- **Decisions / approvals needed:** Owner review/merge + live acceptance.
- **Recommended next action:** Review + merge; then run the manual acceptance checklist above.
