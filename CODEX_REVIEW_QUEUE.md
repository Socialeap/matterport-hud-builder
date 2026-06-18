# Codex Review Queue

## Recently merged (main context)

- **PR #177** (docs: Atlas showcase-merge reconciliation) — MERGED into `main`.
  `BACKEND_ACTIVATION.md` now records `20260613000000_frontiers3d_atlas_showcase_merge.sql`
  as **APPLIED & VERIFIED**; `atlas-discovery.md` obsolete migration gap cleared.
- **PR #176** (visual-map cockpit) + **PR #175** (PWA/App Shell) — MERGED into `main`.

## Current Review Request

- **Timestamp:** 2026-06-18
- **Repository:** /Users/shakoure/matterport-hud-builder (Socialeap)
- **Branch:** `frontiers3d/live-tour-quiet-sync` (off `origin/main`), base `main`.
- **PR:** (to be opened) — `feat(live-tour): quiet View Sync + no annotation-triggered Matterport reloads (runtime 2.2.6)`
- **Base commit:** `origin/main` · **Head commit:** pending
- **Status:** ready for review
- **Summary:** Two Live Tour UX defects. (1) A View Sync reload replayed Matterport's
  startup UI (intro/help/highlight reel) because the teleport URL builder lacked
  reel/help suppression params. (2) Concern that annotation/tool actions reload the
  peer's viewer. **Root cause / proof:** the ONLY iframe `src` writer is
  `applyTeleport` (View Sync / saved-stop); annotation, tool, stroke, clear,
  navlock, and floor handlers never call it (source-guarded). Fix, parity-matched
  across Builder + Atlas runtimes: (A) `rewriteIframeForTeleport` →
  `normalizeMatterportLiveSyncUrl` — adds verified Matterport quiet params
  `help=0&hl=0&dh=0` (with existing `qs=1&play=1&title=0&brand=0`), idempotent,
  preserves m/ss/sr, only decorates `matterport.com` URLs; (B) `applyTeleport`
  no-op guard — converges the view key but SKIPS reassigning `iframe.src` when the
  frame already shows that view, so duplicate/echo/same-view re-syncs never reload.
  No wipe-on-sync (2.2.5 persistence preserved).
- **Files changed:**
  - `src/lib/atlas-live-tour-runtime.mjs` + `src/lib/portal/builder-runtime-spans.mjs` — normalize helper + no-op `applyTeleport` guard (parity).
  - `src/lib/atlas-runtime-version.mjs` — runtime **2.2.5 → 2.2.6** + changelog.
  - `tests/live-tour-quiet-sync.test.mjs` (NEW, 10: normalize unit+parity for both runtimes + source guards).
  - `tests/builder-live-tour.test.mjs` (X1–X5: quiet params, no-op guard, tool/stroke/clear never touch src).
  - `tests/builder-runtime-spans.test.mjs` (js:glue re-pin → `dcda269d…`, 89481) + `tests/presentation-legacy-bootstrap.test.mjs` (R1 → 2.2.6 + quiet-param assertions).
- **Matterport params (verified vs Matterport URL-parameter docs):** `play=1` auto-open · `qs=1` quickstart→Inside View · `help=0` no help · `hl=0` auto-collapse highlight reel · `dh=0` no dollhouse fly-in/button (no `hl=2` exists; `hl=0` is the safe value). `title=0`/`brand=0` preserve prior behavior.
- **Verification:** `tsc` 0; `test:intelligence` **598/598** (15 new); `verify:html` PASS (glue IIFE parses, no risky escapes); `verify:no-secrets` PASS; `vite build` OK (pre-existing routeTree SSR-register drift reverted); `git diff --check` clean.
- **Manual acceptance (pending — owner, two desktops):**
  1. A syncs view (U + Matterport Copy) → B moves with **no** reel/logo/help popup.
  2. B syncs back → same.
  3. A selects Draw/Focus/Eraser/Pointer → B's viewer does **not** reload.
  4. A draws / B draws+erases → seen with no reload; Clear wipes only on click.
  5. Voice + fullscreen still work; Atlas modal + direct Netlify showcase both OK.
- **Known failures / risks:** None. Initial iframe markup intentionally untouched (first-load intro is expected; out of scope). The no-op guard skips reload when coords are unchanged — a same-coordinate re-sync won't force-snap a guest who manually moved (acceptable; move to a different view to re-sync).
- **Backend Activation Required:** NO — generated runtime + version + tests only; no migration, Edge Function, secret, RLS, storage, or backend.
- **End-State Alignment:**
  - Component: Explore Together / Presentation Runtime / Atlas curated showcases
  - Approved outcome advanced: View Sync + annotation collaboration feel seamless — no Matterport startup-UI replays, no annotation-triggered viewer reloads.
  - Boundaries preserved: No Matterport SDK; no backend; desktop-only; no mobile collaboration; annotations persist unless Clear/Eraser; Builder+Atlas parity.
  - Cross-component effects: Builder exports, Atlas showcases, and Upgrade Center-bootstrapped packages all inherit 2.2.6.
  - Acceptance evidence: 598/598 incl. 15 new; normalize unit+parity; source guards; behavioral X1–X5; R1 bootstrap @ 2.2.6.
  - Remaining gap: Owner two-browser manual acceptance.
  - PRODUCT_END_STATES.md revision required: NO.
- **Decisions / approvals needed:** Owner review/merge + two-browser acceptance.
- **Recommended next action:** Review + merge; then run the two-desktop acceptance.
- **Other open PRs:** #178 (Atlas auto-attach deployed URL) — independent, still open.
