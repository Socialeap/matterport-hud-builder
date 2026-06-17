# Frontiers|3D Operation Visual Map

Owner-facing orientation map for the Frontiers|3D platform. Open
[`index.html`](./index.html) directly in a browser to view it — it is a
single self-contained HTML file with no external dependencies and no
network calls.

## What this is

- A high-level visual overview of the platform's major systems, revenue
  tracks, workflows, dependencies, unresolved decisions, and roadmap
  lanes.
- A quick orientation tool for Shakoure (owner) and for AI-agent
  handoffs.
- A planning/review aid that should reflect the current state of the
  platform's moving parts.

## What this is NOT

- **Not a source of truth.** It reflects the source-of-truth documents
  but does not outrank them.
- **Not an app route.** It is not wired into `src/routes/` and must not
  be served as a public page unless explicitly approved later.
- **Not runtime code.** It is not bundled, not imported, not part of
  any build or deploy pipeline.
- **Not a public feature.** It is internal owner-facing documentation.

## Source-of-truth hierarchy

When this map and the documents below disagree, the documents win:

1. `PRODUCT_END_STATES.md` — product direction / authority
2. GitHub `main` — code reality
3. `BACKEND_ACTIVATION.md` — backend / live activation reality
4. `CODEX_REVIEW_QUEUE.md` — current work queue
5. `STATUS.md` — state reconciliation (if present)

## Status definitions

- **Current** — Live / Available
- **Active** — In Progress
- **Planned** — Roadmap
- **Mixed** — Hybrid (partially live, partially planned)
- **Needs decision** — Unresolved

## Update cadence

Update this map after:

- major PR merges
- backend activation changes
- product end-state changes
- major roadmap decisions
- a weekly owner review, only if platform state meaningfully changed

Do **not** update it for every small bugfix.

## Location rule

This file lives under `docs/` on purpose. Do not move it into `src/`,
`public/`, or any app route. Do not import it from runtime code.
