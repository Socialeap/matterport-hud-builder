# Codex Review Queue

## Recently merged (main context)

- **PR #181** (docs: AI role split + Lovable sync protocol) — MERGED into `main` (`1377274`).
- **PR #180** (Atlas-managed showcase runtime upgrade / republish path + P2 downgrade guard) — MERGED into `main` (`3f59b83`). Owner smoke test on a real 2.2.5 showcase still pending.
- **PR #179** (live-tour quiet View Sync + runtime **2.2.6**) — MERGED into `main` (`50fb018`).
- **PR #178** (auto-attach deployed showcase URL after PR merge) — MERGED into `main`.
- **PR #177** (docs: Atlas showcase-merge reconciliation) — MERGED into `main`.
  `BACKEND_ACTIVATION.md` records `20260613000000_frontiers3d_atlas_showcase_merge.sql` **APPLIED & VERIFIED**.
- **PR #176** (visual-map cockpit) + **PR #175** (PWA/App Shell) — MERGED into `main`.

## Operational recoveries (main context)

- **2026-06-19 — Pratt Manhattan Gallery Atlas listing recovered** (data recovery, NOT schema activation). The hard-deleted curated listing was rebuilt from its surviving curation job via the **Lovable Cloud DB tool** (admin server fns need an authenticated admin session). New `atlas_entry_id` `514a948c-6b31-4394-8419-48ba1e11bd05` from job `390a00d9-8c2b-48f6-ac6b-ee7e7d395aca`; `publish_status=published`; URL `https://frontiers3d-atlas-showcases.netlify.app/there-is-a-certain-slant-of-light-pratt-manhattan-gallery/` re-attached after manifest verification; entry `inactive`, `relationship_status=unclaimed`, `owner_user_id=null`, `merged_at=null`. No migration/Edge Function/RLS/storage/secret/schema change. See `BACKEND_ACTIVATION.md` → Completed Activations. **Remaining (owner):** preview + manually activate if correct; optional runtime republish via the PR #180 path.

## Current Review Request

- **Timestamp:** 2026-06-19
- **Repository:** /Users/shakoure/matterport-hud-builder (Socialeap)
- **Branch:** `frontiers3d/docs-pratt-recovery` (off `main`). Base: `main`.
- **PR:** _(opening against `main` — URL to follow)_ — `docs: record Pratt Manhattan Gallery Atlas listing recovery`
- **Base commit:** `1377274` · **Head commit:** pending push
- **Status:** ready for review — **docs-only; stop before merge**
- **Summary:** Records the completed recovery of the hard-deleted **Pratt Manhattan Gallery**
  Atlas curated listing. The listing was rebuilt from its surviving curation job (entry-delete
  only nulled the `atlas_entry_id` FK; the job + draft + slug + deployed URL survived) via the
  **Lovable Cloud DB tool**, because the admin server functions require an authenticated admin
  session. This is a **data recovery / direct DB write, not a schema activation** — no
  migration, Edge Function, RLS/policy, storage, secret, or schema change.
- **Recovered facts:** job `390a00d9-8c2b-48f6-ac6b-ee7e7d395aca` → new `atlas_entry_id` `514a948c-6b31-4394-8419-48ba1e11bd05`; `publish_status=published`; `deployed_url`/`presentation_url` `https://frontiers3d-atlas-showcases.netlify.app/there-is-a-certain-slant-of-light-pratt-manhattan-gallery/` (manifest verified before write); entry `inactive`; `relationship_status=unclaimed`; `owner_user_id=null`; `merged_at` left `null`.
- **Files changed (docs only):**
  - `BACKEND_ACTIVATION.md` — Status note + Completed Activations entry (data recovery, not schema activation).
  - `CODEX_REVIEW_QUEUE.md` — #181 → Recently merged; Operational recoveries note; this entry.
  - `.codex-review/claude-session.md` — milestone entry.
- **Verification:** `git diff --check` clean; `verify:no-secrets` PASS; changed files are docs/handoff only (no app/route/runtime/migration/edge-function/lockfile/dependency/`routeTree.gen.ts` edits).
- **Backend Activation Required:** **NO** — completed **data recovery / direct DB write**, not schema activation. No migration/Edge Function/RLS/storage/secret/schema change.
- **End-State Alignment:**
  - Component: H. Atlas Discovery Map (curated showcases) + L. Admin & Operations.
  - Approved outcome advanced: recovered a deleted curated listing without recreating from scratch, keeping it on the Atlas curation → showcase repo → Netlify path.
  - Boundaries preserved: documentation-only PR; the recovery itself created the entry **inactive** (no auto-activation), re-attached only after manifest verification, and used existing data/tooling — no schema/policy/secret change; `PRODUCT_END_STATES.md` untouched.
  - Cross-component effects: restored the curation_job ↔ listing link so the PR #180 upgrade path stays usable.
  - Acceptance evidence: manifest verification passed before the DB write; `git diff --check` clean; `verify:no-secrets` PASS; diff limited to `BACKEND_ACTIVATION.md`, `CODEX_REVIEW_QUEUE.md`, `.codex-review/claude-session.md`.
  - Remaining gap: owner previews + manually activates the listing if correct; optional runtime republish via the PR #180 path.
  - PRODUCT_END_STATES.md revision required: NO.
- **Decisions / approvals needed:** Owner review; **stop before merge** (confirm Lovable is idle and in sync first).
- **Recommended next action:** Review the docs PR; owner previews/activates the recovered listing; merge the docs PR only after confirming Lovable is idle and in sync.
- **Other open PRs / context:** #180 + #181 merged into `main`; this is the only open PR.
