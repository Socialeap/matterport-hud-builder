# Codex Review Queue

## Current Review Request

- **Timestamp:** 2026-06-17
- **Repository:** /Users/shakoure/matterport-hud-builder (Socialeap)
- **Branch:** `frontiers3d/visual-map-cockpit` — STACKED on `frontiers3d/docs-pwa-app-shell` (PR #175). PR base = the PWA branch so the diff is overhaul-only; retarget to `main` after #175 merges.
- **PR:** (to be opened) — `feat(visual-map): calmer progressive-disclosure cockpit`
- **Base commit:** `6bcec73` (tip of the PWA branch)
- **Head commit:** pending commit on current branch
- **Status:** ready for review
- **Summary:** UI/UX overhaul of the Operation Visual Map (`docs/operations/visual-map/index.html`)
  into a calm, progressive-disclosure cockpit. Replaces the dense progress spine
  with a 5-tile **System Health Dashboard** (counts + plain English, no
  percentages); adds **view modes** (Overview · Health · Flow · Domains ·
  Decisions · Source Truth) that show one mental model at a time; minimal node
  cards (icon · title · one status · short read) with all detail moved to the
  **inspector**; progressive drill-down (no branches open by default → click a
  domain → only its components → click a component → inspector); a "**Start
  here**" recommender; tooltips (hover + keyboard) on status/source/concept
  labels; owner-readable label renames (Product Direction, Code Reality, Backend
  / Live Activation, etc.); reduced visual noise; responsive (tiles stack, tabs
  wrap, inspector below map). Same DATA model, calmer rendering.
- **Files changed:**
  - `docs/operations/visual-map/index.html` — full presentation-layer rewrite (DATA object preserved verbatim).
  - `docs/operations/visual-map/README.md` — "How to read it" (views/drill-down/start-here/tooltips).
  - `CODEX_REVIEW_QUEUE.md` + `.codex-review/claude-session.md` — this update.
- **Verification:** `git diff --check` clean; `verify:no-secrets` PASS; inline JS
  parses (`new Function`); self-contained (0 external URLs / no fetch); DOM-stub
  harness drives every view + inspector (14/14 checks); real-browser screenshots
  (desktop overview, domain drill-down, mobile full-page) confirm calm layout.
  Source-of-truth hierarchy + conservative statuses unchanged.
- **Known failures / risks:** None. Docs-only; surfaced read-only at `/admin/visual-map`
  via existing `?raw` iframe (`sandbox="allow-scripts"`) — no route/runtime change.
- **Backend Activation Required:** NO — documentation only.
- **End-State Alignment:**
  - Component: Public Marketing and PWA / Operations visual map
  - Approved outcome advanced: Owner can understand system state in <5s and drill
    down intentionally; orientation cockpit only — reflects, never outranks, sources.
  - Boundaries preserved: No DATA semantics changed; conservative statuses kept;
    no runtime/backend/public-feature change; source-of-truth hierarchy intact.
  - Cross-component effects: Lower cognitive load for owner planning across all domains.
  - Acceptance evidence: 14/14 harness checks; 3 browser screenshots; first load = 1 cockpit + 9 domains, no open children, no percentages.
  - Remaining gap: None for this PR; first-load selection persists across views by design.
  - PRODUCT_END_STATES.md revision required: NO.
- **Decisions / approvals needed:** Owner review/merge. Merge #175 first (or retarget this PR to `main`).
- **Recommended next action:** Review the three screenshots + open the map; then merge after #175.
- **Superseded:** Supersedes the PWA-only review request (now folded under this stacked branch, which includes #175's commit `6bcec73`).
