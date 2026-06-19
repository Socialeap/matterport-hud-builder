# Codex Review Queue

## Recently merged (main context)

- **PR #180** (Atlas-managed showcase runtime upgrade / republish path + P2 downgrade guard) — MERGED into `main` (`3f59b83`). Owner smoke test on a real 2.2.5 showcase still pending.
- **PR #179** (live-tour quiet View Sync + runtime **2.2.6**) — MERGED into `main` (`50fb018`).
- **PR #178** (auto-attach deployed showcase URL after PR merge) — MERGED into `main`.
- **PR #177** (docs: Atlas showcase-merge reconciliation) — MERGED into `main`.
  `BACKEND_ACTIVATION.md` records `20260613000000_frontiers3d_atlas_showcase_merge.sql` **APPLIED & VERIFIED**.
- **PR #176** (visual-map cockpit) + **PR #175** (PWA/App Shell) — MERGED into `main`.

## Current Review Request

- **Timestamp:** 2026-06-19
- **Repository:** /Users/shakoure/matterport-hud-builder (Socialeap)
- **Branch:** `frontiers3d/docs-ai-role-split` (off `main`). Base: `main`.
- **PR:** [#181](https://github.com/Socialeap/matterport-hud-builder/pull/181) — `docs: AI role split + Lovable sync protocol`
- **Base commit:** `3f59b83` · **Head commit:** `d6810f9`
- **Status:** ready for review — **docs-only; stop before merge**
- **Summary:** Documents the development workflow now that Claude Code/App is the primary
  implementation agent, Lovable is the secondary read-only/deploy-aware assistant, and Codex
  is the planning/review/handoff assistant. Formalizes the sync rules that prevent
  GitHub/Lovable divergence and backend-activation confusion. No application/runtime/backend
  changes.
- **Files changed (docs/handoff only):**
  - `CLAUDE.md` — NEW "AI Role Split & Lovable Sync Protocol" section (roles + sync rules + the pre-merge "confirm Lovable is idle and in sync" reminder), pointing to the detailed protocol.
  - `.codex-review/sync-protocol.md` — NEW detailed protocol (roles, branch/edit discipline, merge/push to main, backend activation, exceptions, divergence recovery).
  - `CODEX_REVIEW_QUEUE.md` — moved #180 to Recently merged; this entry.
  - `.codex-review/claude-session.md` — milestone entry.
- **Verification:** `git diff --check` clean; `verify:no-secrets` PASS; changed files are docs/handoff only (no app/route/runtime/migration/edge-function/lockfile/dependency/`routeTree.gen.ts` edits).
- **Backend Activation Required:** NO — documentation only.
- **End-State Alignment:**
  - Component: Admin & Operations / AI workflow governance.
  - Approved outcome advanced: a clear AI role split reduces branch drift, backend-activation confusion, and duplicated implementation work.
  - Boundaries preserved: documentation-only; no app/runtime/backend/deploy changes; `PRODUCT_END_STATES.md` untouched.
  - Cross-component effects: improves Claude/Lovable/Codex handoff discipline across all future work.
  - Acceptance evidence: `git diff --check` clean; `verify:no-secrets` PASS; diff limited to `CLAUDE.md`, `.codex-review/sync-protocol.md`, `CODEX_REVIEW_QUEUE.md`, `.codex-review/claude-session.md`.
  - Remaining gap: none for the docs scope; Lovable/Codex acknowledgement of the documented roles is an operational follow-up.
  - PRODUCT_END_STATES.md revision required: NO.
- **Decisions / approvals needed:** Owner review; **stop before merge** (confirm Lovable is idle and in sync first).
- **Recommended next action:** Review the docs PR; merge only after confirming Lovable is idle and in sync.
- **Other open PRs / context:** #180 merged into `main` (`3f59b83`), owner smoke test pending.
