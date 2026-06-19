# Claude Session Milestone Log

- **2026-06-17T18:34:25Z** — Added Frontiers|3D Operation Visual Map as
  owner-facing documentation at `docs/operations/visual-map/index.html`
  with a `README.md` explaining scope, source-of-truth hierarchy,
  status definitions, and update cadence. Docs-only PR; no app,
  runtime, or backend changes. Backend Activation Required: NO.
- **2026-06-17** — Surfaced the existing PWA/App Shell layer in owner-facing
  docs. Branch `frontiers3d/docs-pwa-app-shell` off `origin/main` `a632743`.
  Added an "App Shell / Delivery (PWA)" cluster (+ Installable App Shell /
  Notifications children) and a "PWA / App Shell" Progress Spine milestone
  (Mixed, 75) to `docs/operations/visual-map/index.html`; created scoped memory
  `.lovable/memory/features/pwa-app-shell.md` (+ index entry); referenced it
  from `PRODUCT_END_STATES.md` §K (still Partial, 92 lines); added a concise
  PWA/App-Shell routing rule to `CLAUDE.md`. Claims grounded in the real SW +
  cache policy (conservative static allowlist; hard DENY on /api,/admin,
  /dashboard,/p/,/_serverFn). Docs/governance/visual-map only — no service
  worker, runtime, or backend change. `git diff --check` clean; verify:no-secrets
  PASS; visual-map JS parses. Backend Activation Required: NO. (Note: local
  unpushed `f880740` — Atlas-migration-verified + STATUS.md — is a separate
  concern, not on origin/main and not part of this PR.)
- **2026-06-17** — Overhauled the Operation Visual Map into a calm
  progressive-disclosure cockpit. Branch `frontiers3d/visual-map-cockpit`,
  STACKED on the PWA branch (tip `6bcec73`) so the diff is overhaul-only.
  Full presentation-layer rewrite of `docs/operations/visual-map/index.html`
  (DATA object preserved verbatim): 5-tile System Health Dashboard (counts, no
  percentages); view modes Overview/Health/Flow/Domains/Decisions/Source Truth
  (one mental model at a time); minimal node cards with detail in the inspector;
  drill-down (no branches open by default → domain → components → inspector);
  "Start here" recommender from DATA; hover+keyboard tooltips on status/source/
  concept labels; owner-readable label renames; reduced visual noise; responsive
  (tiles stack, tabs wrap, inspector below map). README gained a "How to read it"
  section. Source-of-truth hierarchy + conservative statuses unchanged; surfaced
  read-only at `/admin/visual-map` via the existing `?raw` sandboxed iframe (no
  route/runtime change). Verified: JS parses; self-contained (0 external URLs);
  14/14 DOM-stub harness checks across all views; 3 real-browser screenshots
  (desktop overview, atlas drill-down, mobile full-page) confirm calm layout;
  `git diff --check` clean; verify:no-secrets PASS. Docs-only. Backend
  Activation Required: NO. Opened as PR #176; PR #175 (PWA) was MERGED into main
  meanwhile, so #176's base was retargeted to `main` (overhaul-only diff). Stopped before merge.
- **2026-06-18** — Fixed Codex P2 on PR #176: Flow-view rows rendered
  `data-node=""` (DATA.flow has no `id`), so clicking a step set selectedId="" and
  fell back to the "Start here" panel. Fix: render synthetic `flow-<i>` ids and
  resolve them in `findNode`; DATA object preserved byte-for-byte (30794 B,
  identical sha256). Harness now clicks steps and asserts step detail renders;
  parses, self-contained, diff still docs-only. Backend Activation Required: NO.
- **2026-06-18 (recovery check)** — Read-only recovery after a VS Code extension
  hang. Repo `/Users/shakoure/matterport-hud-builder`; branch
  `frontiers3d/visual-map-cockpit` @ `4f568a2`, clean + synced, already MERGED to
  main (PR #176; #175 also merged). NO in-flight Atlas work, no stash/worktree with
  Atlas changes, no open PRs — nothing lost. Atlas Curation + Showcase Publishing
  is code-complete + merged; migration `20260613000000_frontiers3d_atlas_showcase_merge.sql`
  is APPLIED & VERIFIED live per Lovable — BUT that doc update + STATUS.md are
  stranded on unpushed local commit `f880740`, so origin/main still reads NEEDS
  APPLY. Blockers: local Supabase CLI can't reach the Lovable Cloud project
  (use Lovable/Dashboard); Netlify + admin smoke test are owner-side. Safe to
  continue. Next: (1) docs-only reconcile of the showcase_merge applied state +
  STATUS.md; (2) admin Approve & Publish smoke test + branch-protection check;
  (3) republish showcases on current runtime. No files edited during recovery.
- **2026-06-18** — Docs-only reconciliation PR for the Atlas showcase merge
  migration. Branch `frontiers3d/atlas-showcase-merge-doc-reconcile` off
  `origin/main`. Redid (cleanly, on current main) the reconciliation stranded on
  unpushed `f880740`: `BACKEND_ACTIVATION.md` moves
  `20260613000000_frontiers3d_atlas_showcase_merge.sql` from Pending/NEEDS APPLY
  to Completed / APPLIED & VERIFIED (Lovable confirmed live: 3/3 columns +
  widened publish_status CHECK; no backend action required or performed).
  STATUS.md NOT added — absent on origin/main and the stranded copy is stale vs
  current main; recommended a separate refresh if a tracked STATUS.md is wanted.
  No migration applied/reapplied; no code/runtime/RLS/secret/deploy touched.
  Backend Activation Required: NO. Opened a focused docs-only PR; stopped before merge.
- **2026-06-18** — Codex P2 follow-up on the reconciliation PR: cleared the
  obsolete migration gap in `.lovable/memory/features/atlas-discovery.md:21`
  (it still listed "apply/verify showcase_merge" as a current gap, which CLAUDE.md
  routing would surface to future Atlas work). Replaced it with the remaining
  admin acceptance gap + a note that the migration is applied & verified. Now the
  documented backend state matches live reality in BOTH the handoff and scoped
  memory. Docs-only; same branch/PR #177. Backend Activation Required: NO.
- **2026-06-18** — Atlas Showcase Publishing: auto-attach deployed URL after PR
  merge. Branch `frontiers3d/atlas-showcase-auto-attach` off origin/main.
  Investigation found the merge→verify→attach backend ALREADY exists
  (mergeAndPublishShowcase / markShowcaseDeployed / verifyDeployedShowcase +
  deterministic defaultShowcaseUrl); confirmed with owner the real gap is "stuck
  on awaiting deploy" (in-merge poll ~15s → real Netlify deploys land
  pending_deploy needing a manual retry). Fix (no migration/secret): NEW pure
  helper `atlas-showcase-deploy-plan.mjs` (planShowcaseDeploymentOutcome:
  ok→published+attach, not-ok→pending_deploy retryable, NEVER failed); NEW
  non-destructive `pollShowcaseDeployment` server fn (admin-gated, verify→attach
  presentation_url on success, leave pending otherwise); bounded client auto-poll
  (~6s then 8s ×12) after Approve & Publish with a "checking deploy…" indicator;
  manual "Retry deploy & attach" kept as fallback. Tests: 10 new (4 transition
  unit + 6 source guards incl. secrets-never-in-client). tsc 0; test:intelligence
  583/583; verify:no-secrets PASS; eslint clean; build OK (reverted pre-existing
  routeTree SSR-register drift). Backend Activation Required: NO. Opened a PR;
  stopped before merge. Manual live-Netlify acceptance pending.
- **2026-06-18** — Live Tour polish: quiet View Sync + no annotation-triggered
  reloads (runtime 2.2.5 → 2.2.6). Branch `frontiers3d/live-tour-quiet-sync` off
  origin/main. Investigation proved the ONLY iframe.src writer is applyTeleport
  (View Sync / saved-stop); annotation/tool/stroke/clear/navlock/floor handlers
  never navigate. Fix (Builder + Atlas parity): (A) rewriteIframeForTeleport →
  normalizeMatterportLiveSyncUrl adds verified Matterport quiet params
  help=0/hl=0/dh=0 (with existing qs=1/play=1/title=0/brand=0), idempotent,
  preserves m/ss/sr, matterport.com-only; (B) applyTeleport no-op guard
  (lastTeleportedKey) skips iframe.src reassignment when already showing that
  view → duplicate/echo/same-view re-syncs never reload. No wipe-on-sync (2.2.5
  kept). Version bumped + changelog; js:glue re-pinned (dcda269d…, 89481);
  legacy-bootstrap R1 → 2.2.6 + quiet-param asserts. New tests: 15
  (tests/live-tour-quiet-sync.test.mjs 10 = normalize unit+parity both runtimes +
  source guards; builder-live-tour X1–X5 behavioral). tsc 0; test:intelligence
  598/598; verify:html PASS; verify:no-secrets PASS; build OK (reverted
  pre-existing routeTree SSR-register drift). Initial iframe markup intentionally
  untouched (out of scope). Backend Activation Required: NO. Opened a PR; stopped
  before merge; owner two-browser acceptance pending.
- **2026-06-18** — Codex P2 fix on PR #179 (quiet View Sync): Builder
  applyTeleport returned before window.__snapPrimaryActive(), so a no-op
  same-view teleport while a Property Feature/Mattertag (ghost iframe) was open
  could leave the user on the ghost view. Fixed: snap the primary iframe FIRST
  (idempotent), then the no-reload guard. New test X6 proves the snap runs on the
  no-op path while src is not reassigned. Atlas is single-iframe (no snap, no
  change). js:glue re-pinned (cc9de988…, 89753). tsc 0; test:intelligence
  599/599; verify:html + verify:no-secrets PASS; build OK. Backend Activation: NO.
- **2026-06-18** — Codex P2 #2 on PR #179 (quiet View Sync): the no-op guard used
  a separate lastTeleportedKey updated only on teleport-write, so an echo of a
  just-sent/just-followed view (local send sets currentViewKey, not
  lastTeleportedKey) wasn't recognized → reloaded anyway. Fix (both runtimes):
  dropped lastTeleportedKey; the guard now compares newKey to the pre-converge
  currentViewKey, which attemptSendLocation already keeps in sync (currentViewKey=key).
  Source guards assert the guard keys off currentViewKey AND that attemptSendLocation
  converges it. (The behavioral send→echo path is additionally covered by the
  pre-existing own-send echo-suppression window; an isolated test was dropped as
  confounded by that window — X2 + source guards prove the currentViewKey guard.)
  js:glue re-pinned (6af1a435…, 89934). tsc 0; test:intelligence 599/599;
  verify:html + verify:no-secrets PASS; build OK. Backend Activation: NO.

## 2026-06-18 — Atlas-managed showcase runtime republish/upgrade path
- Branch `frontiers3d/atlas-showcase-runtime-republish` (off live-tour-quiet-sync @ 5602a6e).
  Adds in-place runtime upgrade for live Atlas curated showcases (2.2.5 → current 2.2.6)
  without recreating listings. Single-file Upgrade Center still rejects family=atlas;
  upgrade stays on GitHub source + Netlify redeploy.
- Finding: regenerate→PR→merge→redeploy→re-attach already exists and always stamps the
  current runtime; missing piece was runtime visibility + a guided/guarded affordance.
- New server fns (atlas-curation.functions.ts): inspectShowcaseRuntime (read-only deployed
  vs current + upgradeAvailable) and republishCuratedShowcase (Atlas-only; guards
  published/pending + slug + entry; regenerates from draft_payload on the SAME slug;
  preserves deployed_url + presentation_url; sets pr_open so existing Approve & Publish
  finishes). atlas-showcase-publish.ts manifest type gained runtime_version fields.
  Admin route: published-state runtime badge + "Upgrade runtime to X.Y.Z" button (guided
  two-step, owner-confirmed).
- tsc 0; eslint 0 (changed files); build OK (routeTree SSR-register drift reverted);
  verify:html PASS. test:intelligence not re-run (no runtime/template change). Not yet
  committed/pushed — awaiting owner go-ahead. Backend Activation: NO.

## 2026-06-18 — Atlas runtime upgrade path COMPLETED + rebased onto main
- PR #179 (runtime 2.2.6) and #178 (auto-attach) merged. Rebased
  `frontiers3d/atlas-showcase-runtime-republish` cleanly onto main (50fb018) — NOT
  stacked on the live-tour branch. Content of base was byte-identical to main, so no
  conflicts.
- Completed the feature: extracted pure helpers into NEW src/lib/atlas-runtime-upgrade.mjs
  (+ .d.mts) — computeShowcaseRuntimeStatus (older→upgrade, equal→current, newer→
  ahead_of_build/no-downgrade, unreadable→unknown), canRepublishShowcase guard,
  buildShowcaseInputFromJob/resolveRepublishSlug (reuse curation data + existing slug),
  buildRepublishJobUpdate (preserves live URL + listing until verify). Refactored
  inspectShowcaseRuntime + republishCuratedShowcase to delegate to them. Admin UI now
  disables the Upgrade button when current/ahead. Requirement #6: Presentation Update
  Center atlas_managed guidance → "This is an Atlas-managed showcase. Use Admin → Atlas
  Curation → Upgrade runtime / Republish showcase." (canUpgrade stays false — never patches).
- NEW tests/atlas-runtime-upgrade.test.mjs (18): version compare, republish guard,
  slug/data/URL/listing preservation, single-file patcher STILL rejects family=atlas + new
  message, no client-side secrets / dynamic-import boundary.
- Verification (on main): tsc 0; eslint 0; vite build OK (routeTree drift reverted);
  verify:html PASS; verify:no-secrets PASS; git diff --check clean; test:intelligence
  617/617 (18 new). Backend Activation: NO. Opening PR against main.

## 2026-06-18 — PR #180 review fix: P2 server-side downgrade guard
- GitHub-ChatGPT P2: republishCuratedShowcase only ran the structural guard, so a
  direct server call / click-after-failed-inspection could regenerate a NEWER live
  folder with this build's OLDER runtime (downgrade once approved).
- Fix: NEW evaluateRuntimeUpgradeGate(deployed, current) in atlas-runtime-upgrade.mjs
  (proceed ONLY when status===upgrade_available; reject current/ahead_of_build/unknown).
  republishCuratedShowcase now re-reads the deployed manifest runtime via
  verifyDeployedShowcase and runs the gate BEFORE opening any PR; rejections throw
  WITHOUT marking the healthy published job failed. Also requires a live deployed_url.
  UI: Upgrade button enabled only when upgradeAvailable (covers unknown too).
- Tests U19 (gate decisions) + U20 (verify+gate ordered before publishShowcasePr).
- tsc 0; eslint 0; build OK; verify:html + verify:no-secrets PASS; git diff --check
  clean; test:intelligence 619/619 (20 new). Backend Activation: NO.
