# Codex Review Queue

## Recently merged (main context)

- **PR #179** (live-tour quiet View Sync + runtime **2.2.6**) — MERGED into `main` (`50fb018`).
- **PR #178** (auto-attach deployed showcase URL after PR merge) — MERGED into `main`.
- **PR #177** (docs: Atlas showcase-merge reconciliation) — MERGED into `main`.
  `BACKEND_ACTIVATION.md` records `20260613000000_frontiers3d_atlas_showcase_merge.sql` **APPLIED & VERIFIED**.
- **PR #176** (visual-map cockpit) + **PR #175** (PWA/App Shell) — MERGED into `main`.

## Current Review Request

- **Timestamp:** 2026-06-18
- **Repository:** /Users/shakoure/matterport-hud-builder (Socialeap)
- **Branch:** `frontiers3d/atlas-showcase-runtime-republish` — **rebased onto `main`** (`50fb018`, which now carries runtime **2.2.6** via #179). Base: `main`. NOT stacked on the live-tour branch.
- **PR:** [#180](https://github.com/Socialeap/matterport-hud-builder/pull/180) — `feat(atlas): Atlas-managed showcase runtime upgrade (republish) path`
- **Base commit:** `50fb018` · **Head commit:** `b0f3c80`
- **Status:** ready for review
- **Summary:** Atlas equivalent of the Builder Patch Tool: an existing **published** curated
  showcase at an older runtime (e.g. 2.2.5) upgrades to the current runtime (2.2.6) by
  regenerating from its stored curation draft and redeploying through its GitHub source repo
  + Netlify — **without recreating the listing**. Single-file patching (Presentation Upgrade
  Center) still rejects `family=atlas`. **Key finding:** the regenerate→PR→merge→redeploy→
  re-attach machinery already exists and always stamps the *current* runtime
  (`buildShowcaseFiles` → `buildRuntimeManifestFields("atlas")`); what was missing was
  runtime visibility, a guided/guarded upgrade affordance, and a clearer rejection message.
- **Files changed:**
  - `src/lib/atlas-runtime-upgrade.mjs` (+ `.d.mts`) — NEW pure helpers (the Atlas patch-tool logic): `computeShowcaseRuntimeStatus` (older→`upgrade_available`, equal→`current`, newer→`ahead_of_build` [no downgrade], unreadable→`unknown`), `canRepublishShowcase` guard, `buildShowcaseInputFromJob` / `resolveRepublishSlug` (reuse curation data + existing slug), `buildRepublishJobUpdate` (preserves live URL + listing until verify).
  - `src/lib/atlas-curation.functions.ts` — NEW `inspectShowcaseRuntime` (read-only deployed vs current) + `republishCuratedShowcase` (Atlas-only; delegates to the shared helpers; opens upgrade PR on the SAME slug; sets `pr_open` so the existing #178 Approve & Publish merges/redeploys/re-attaches; never clears `deployed_url`/`presentation_url`; never changes activation).
  - `src/lib/atlas-showcase-publish.ts` — added optional `package_schema`/`runtime_version`/`package_family` to the verifier's `manifest` type (read-only).
  - `src/routes/_authenticated.admin.atlas-curation.tsx` — published-state UI: auto runtime check, "deployed X · current Y · upgrade available / up to date / ahead of this build" badge, guided **"Upgrade runtime to X.Y.Z"** button (disabled when current/ahead) → republish, then existing **Approve & Publish**.
  - `src/lib/presentation-upgrade-session.mjs` — `atlas_managed` guidance now: _"This is an Atlas-managed showcase. Use Admin → Atlas Curation → Upgrade runtime / Republish showcase."_ `canUpgrade` stays **false** (never patches the file).
  - `tests/atlas-runtime-upgrade.test.mjs` — NEW (18: U1–U5 version compare; U6–U10 guard; U11–U14 slug/data/URL/listing preservation; U15–U16 single-file patcher still rejects atlas + new message; U17–U18 no client-side secrets / dynamic-import boundary).
- **Design decision (owner-confirmed):** Guided two-step (open upgrade PR, then Approve & Publish) — matches the existing re-open→merge pattern; no auto-merge.
- **Verification (rebased on main):** `tsc` **0**; `eslint` **0** (changed files); `vite build` OK (routeTree SSR-register drift reverted); `verify:html` PASS; `verify:no-secrets` PASS; `git diff --check` clean; `test:intelligence` **617/617** (18 new).
- **Manual acceptance (pending — owner):**
  1. `/admin/atlas-curation`, select a published 2.2.5 showcase → badge "deployed 2.2.5 · current 2.2.6 · upgrade available".
  2. "Upgrade runtime to 2.2.6" → confirm → upgrade PR opens on the same `<slug>/` folder.
  3. "Approve & Publish" → merges, Netlify redeploys, live URL re-attaches; listing active/inactive unchanged.
  4. Public `/atlas` opens the same listing; deployed `atlas-manifest.json` reports `runtime_version: 2.2.6`; Live Tour quiet View Sync works.
  5. Upload that showcase's HTML to the Presentation Update Center → rejected with the new Atlas-Curation message; file not patched.
- **Known failures / risks:** None functional. Reuses the existing GitHub-merge path → still needs the showcases repo default branch to have no blocking branch protection (else merge manually + "Mark deployed & attach URL"). Runtime check is a live read-only fetch of the deployed manifest.
- **Backend Activation Required:** NO — new server fns + pure helper + admin UI + tests only; no migration, Edge Function, secret, RLS, storage, or webhook.
- **End-State Alignment:**
  - Component: H. Atlas Discovery Map (curated showcases) + G. Presentation Upgrade Center boundary + L. Admin & Operations.
  - Approved outcome advanced: existing showcases upgrade to the current runtime without recreating listings (closes an `atlas-discovery.md` "Current Gaps" item); upgrade stays on the Atlas GitHub→Netlify path.
  - Boundaries preserved: single-file path still rejects `family=atlas` (canUpgrade false); no auto-activation; secrets stay server-side (dynamic-import boundary test); slug/path/URL preserved; activation untouched; no Matterport SDK; no migration.
  - Cross-component effects: confined to the admin curation route + the Upgrade Center rejection copy; reuses existing publish/merge/verify infrastructure.
  - Acceptance evidence: 617/617 incl. 18 new; tsc/eslint/build/verify:html/verify:no-secrets PASS; flow proven by reuse of #178 merge/deploy/re-attach functions; owner smoke test pending.
  - Remaining gap: owner `/admin/atlas-curation` smoke test on a real published showcase; confirm showcases repo branch protection allows API merge.
  - PRODUCT_END_STATES.md revision required: NO.
- **Decisions / approvals needed:** Owner review/merge + the manual smoke test above.
- **Recommended next action:** Review + merge; then run the smoke test on a real 2.2.5 showcase.
- **Other open PRs / context:** None blocking — #178 (auto-attach) + #179 (runtime 2.2.6) already merged into `main`; this builds directly on both.
