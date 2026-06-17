# Plan: Add Frontiers3D Operation Visual Map As Owner-Facing Documentation

## Goal
Add the uploaded `frontiers3d_operation_visual_map_updated.html` as documentation (not app/runtime code) and create supporting files for owner orientation.

## Files to Create

1. `docs/operations/visual-map/index.html`
   - Copy of the uploaded HTML, self-contained, no external dependencies.
   - No redesign; only minimal path/title cleanup if needed.

2. `docs/operations/visual-map/README.md`
   - What the visual map is.
   - What it is not (not a source of truth, not an app route, not a public feature).
   - Source-of-truth hierarchy (PRODUCT_END_STATES.md > GitHub main > BACKEND_ACTIVATION.md > CODEX_REVIEW_QUEUE.md > STATUS.md).
   - Status definitions (Current, Active, Planned, Mixed, Needs decision).
   - Update cadence (after major PR merges, backend activation changes, product end-state changes, major roadmap decisions, weekly owner review if state changed; not after every small bugfix).
   - Note that it should not be treated as a deployable app route or public feature unless explicitly approved later.

3. `CODEX_REVIEW_QUEUE.md` (new file at repo root)
   - Compact handoff note that the Operation Visual Map has been added as owner-facing documentation.
   - Required checklist fields per the project rule.

4. `.codex-review/claude-session.md` (new file)
   - Timestamped milestone entry for this session.

## Files to Change
- None (docs-only addition).

## What NOT to Change
- `src/`, `public/`, app routes, runtime/package generation paths.
- Application code, route tree, migrations, backend files, Edge Functions.
- Dependencies, lockfiles, secrets, RLS, grants, policies.
- Atlas runtime, Builder runtime, presentation packages.

## Verification Steps
1. Confirm the HTML is self-contained and can be opened locally.
2. Confirm the committed files are docs-only (`git diff --name-only`).
3. Run `git diff --check` (no trailing whitespace / conflicts).
4. Run `npm run verify:no-secrets` if the script exists.
5. Confirm no app/runtime/backend files changed.

## PR
- Title: `docs(operations): add Frontiers3D operation visual map`
- Stop before merge.

## Backend Activation Required
NO — documentation only.
