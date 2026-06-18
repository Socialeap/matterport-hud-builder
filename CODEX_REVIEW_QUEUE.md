# Codex Review Queue

## Current Review Request

- **Timestamp:** 2026-06-17
- **Repository:** /Users/shakoure/matterport-hud-builder (Socialeap)
- **Branch:** `frontiers3d/visual-map-cockpit` → **PR #176**, base `main`. (Was stacked on PR #175/PWA; #175 is now MERGED into `main`, so the base was retargeted to `main` and the diff is overhaul-only.)
- **PR:** #176 — `feat(visual-map): calmer progressive-disclosure cockpit`
- **Base commit:** `origin/main` (already contains the PWA commit `6bcec73` via the #175 merge)
- **Head commit:** `c794ddd`
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
- **Review fixes:** Codex P2 (flow rows rendered `data-node=""` because `DATA.flow`
  has no `id`, so clicking a step fell back to "Start here") — FIXED by assigning
  synthetic `flow-<i>` ids at render time and resolving them in `findNode`; DATA
  object left byte-for-byte unchanged. Harness now clicks steps and asserts the
  step detail renders.
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
- **Decisions / approvals needed:** Owner review/merge of PR #176 into `main`.
- **Recommended next action:** Open the map (or `/admin/visual-map`), review the three screenshots, then merge #176.
- **Superseded:** PWA-only review request (PR #175, now MERGED into `main`).
