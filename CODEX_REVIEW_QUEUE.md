# Codex Review Queue

## Recently merged (main context)

- **PR #181** (docs: AI role split + Lovable sync protocol) — MERGED into `main` (`1377274`).
- **PR #180** (Atlas-managed showcase runtime upgrade / republish path + P2 downgrade guard) — MERGED into `main` (`3f59b83`). Owner smoke test on a real 2.2.5 showcase still pending.
- **PR #179** (live-tour quiet View Sync + runtime **2.2.6**) — MERGED into `main` (`50fb018`).
- **PR #178** (auto-attach deployed showcase URL after PR merge) — MERGED into `main`.
- **PR #177** (docs: Atlas showcase-merge reconciliation) — MERGED into `main`.
  `BACKEND_ACTIVATION.md` records `20260613000000_frontiers3d_atlas_showcase_merge.sql` **APPLIED & VERIFIED**.
- **PR #176** (visual-map cockpit) + **PR #175** (PWA/App Shell) — MERGED into `main`.

## Current Review Request

- **Timestamp:** 2026-06-19
- **Repository:** /Users/shakoure/matterport-hud-builder (Socialeap)
- **Branch:** `frontiers3d/docs-sync-sha-verification` (off `main`). Base: `main`.
- **PR:** [#183](https://github.com/Socialeap/matterport-hud-builder/pull/183) — `docs: strengthen Lovable/GitHub sync protocol with SHA verification`
- **Base commit:** `1377274` · **Head commit:** `26fd57c` (branch tip; PR [#183](https://github.com/Socialeap/matterport-hud-builder/pull/183) is the canonical live head — act on the PR's current head, which includes this trailing queue-bookkeeping commit).
- **Status:** ready for review — **docs-only; stop before merge**
- **Summary:** Strengthens the Lovable/GitHub sync protocol so post-merge testing can't run
  stale code. GitHub `main` is the code source of truth; after any merge Claude reports the
  PR number + merge commit SHA + an expected verification marker + whether Lovable sync is
  required, and Lovable must confirm the GitHub-main SHA, its own workspace/deployed SHA, the
  SHA match, and marker presence before Shakoure tests. SHA mismatch or Lovable local edits =
  STOP. Motivated by the #179/#180 episode (merged on GitHub, stale in Lovable). No app/
  runtime/backend changes.
- **Files changed (docs/handoff only):**
  - `CLAUDE.md` — added a "Post-merge SHA verification" block to the AI Role Split & Lovable Sync Protocol section.
  - `.codex-review/sync-protocol.md` — NEW §7 (post-merge SHA verification: Claude report fields, Lovable pre-test confirmation, stop conditions, local-edit handling, example markers).
  - `CODEX_REVIEW_QUEUE.md` — #181 → Recently merged; this entry.
  - `.codex-review/claude-session.md` — milestone entry.
- **Verification:** `git diff --check` clean; `verify:no-secrets` PASS; changed files are docs/handoff only (no app/route/runtime/migration/edge-function/lockfile/dependency/`routeTree.gen.ts` edits).
- **Backend Activation Required:** NO — documentation only.
- **End-State Alignment:**
  - Component: Admin & Operations / AI workflow governance.
  - Approved outcome advanced: post-merge SHA verification stops Shakoure from testing stale Lovable code and misreading working fixes as failures.
  - Boundaries preserved: documentation-only; no app/runtime/backend/deploy changes; `PRODUCT_END_STATES.md` untouched.
  - Cross-component effects: tightens Claude/Lovable handoff discipline for every future merge.
  - Acceptance evidence: `git diff --check` clean; `verify:no-secrets` PASS; diff limited to `CLAUDE.md`, `.codex-review/sync-protocol.md`, `CODEX_REVIEW_QUEUE.md`, `.codex-review/claude-session.md`.
  - Remaining gap: none for the docs scope; operational adoption of the SHA check by Lovable.
  - PRODUCT_END_STATES.md revision required: NO.
- **Decisions / approvals needed:** Owner review; **stop before merge** (confirm Lovable is idle and in sync first).
- **Recommended next action:** Review the docs PR; merge only after confirming Lovable is idle and in sync.
- **Other open PRs / context:** **#182** (docs: Pratt Manhattan Gallery recovery) is **open** and also edits `CODEX_REVIEW_QUEUE.md` + `.codex-review/claude-session.md` — expect a small queue/log conflict at the second merge; resolve by keeping both the recovery record and this entry. #180 + #181 merged into `main`.
