# Frontiers|3D Operation Visual Map

<!-- sync: 2026-06-17 re-trigger GitHub push for Progress Spine snapshot -->


Owner-facing orientation map for the Frontiers|3D platform. Open
[`index.html`](./index.html) directly in a browser to view it — it is a
single self-contained HTML file with no external dependencies and no
network calls.

## Private admin access

Also available in-app at **`/admin/visual-map`** (admin role required).
That route renders this same HTML via a Vite raw import (`?raw`) inside a
sandboxed `<iframe>` — no duplicate copy in `public/`, no raw HTTP
endpoint, not indexed, not a source of truth. Access is gated by the
existing `_authenticated/admin` layout.

Update cadence: major milestones, backend activations, roadmap
decisions, or a weekly owner review.


## What this is

- A high-level visual overview of the platform's major systems, revenue
  tracks, workflows, dependencies, unresolved decisions, and roadmap
  lanes.
- A quick orientation tool for Shakoure (owner) and for AI-agent
  handoffs.
- A planning/review aid that should reflect the current state of the
  platform's moving parts.

## How to read it (progressive disclosure)

The map is a calm cockpit, not an everything-at-once diagram. It opens on a
plain-English **System Health Dashboard** (Operational / Active Work /
Roadmap / Needs Decision / Critical Blockers — counts only, no percentages),
one cockpit node, and the major domains. Detail is revealed on demand:

- **Views** (tabs): Overview · Health · Flow · Domains · Decisions · Source Truth.
  Each view shows only its own mental model.
- **Drill down:** click a domain to open only its components; click any block
  to load plain-English detail in the right-side inspector.
- **Start here:** the default inspector recommends what to look at first
  (blockers/decisions, else active work nearest acceptance, plus the launch path).
- **Tooltips:** hover or keyboard-focus a status/source label for its meaning.

Statuses stay conservative: nothing is labeled *Current (Live)* unless it is
truly live/available.

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
