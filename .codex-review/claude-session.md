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
