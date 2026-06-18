# Atlas Discovery Memory

## Product Outcome
Atlas is the public discovery layer for verified immersive physical and virtual spaces.

## Required Behavior
- Public map/search/filter/cluster/card/viewer experience scales with listing density.
- Only active listings appear publicly.
- Owner submissions are verification-first.
- Demos, curated showcases, client submissions, unclaimed listings, and virtual showrooms are labeled truthfully.
- Curated packages remain inactive until build, repository publication, host deployment, manifest verification, and admin activation succeed.
- Invalid presentation URLs cannot silently become active.

## Boundaries
- Curated listings never imply business endorsement or ownership.
- Package or PR creation alone never activates a listing.
- Virtual showroom pins must be visually distinct from physical listings.
- Map-click coordinate selection must remain within configured geo-fence rules.

## Current Gaps
- Run the admin Approve & Publish acceptance: confirm the `Socialeap/frontiers3d-atlas-showcases` default branch does not block API merges, then the end-to-end `/admin/atlas-curation` smoke test. (Migration `20260613000000_frontiers3d_atlas_showcase_merge.sql` is applied & verified live — see `BACKEND_ACTIVATION.md`.)
- Republish representative showcases with the current runtime.
- Complete launch-scale clustering and claim/operations acceptance.
