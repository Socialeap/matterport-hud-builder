# AI Role Split + Lovable Sync Protocol

**Owner:** Shakoure · **Status:** Active · **Scope:** development workflow governance
(documentation-only; no application/runtime/backend behavior).

This is the detailed companion to the **AI Role Split & Lovable Sync Protocol**
section in `CLAUDE.md`. It exists so Claude, Lovable, and Codex understand their
roles and the sync rules, and so GitHub and Lovable do not diverge.

## 1. Roles

### Claude Code / Claude App — primary implementation agent
- Owns repo implementation: branches, code edits, PR preparation, tests, and code
  verification (`tsc`, `eslint`, `vite build`, `verify:html`, `verify:no-secrets`,
  `test:intelligence`).
- Prepares PRs against `main` and updates `CODEX_REVIEW_QUEUE.md` +
  `.codex-review/claude-session.md` per the `CLAUDE.md` rules.
- Does **not** perform Lovable-managed backend activation or claim a backend change
  is live (see §4).

### Lovable — secondary, read-only / deploy-aware (default)
- Default posture is **read-only**: it may review plans and report deployment /
  backend / environment status without editing repo code.
- Retains deployment + backend-activation awareness. Use Lovable for:
  - deployment state and post-merge sync status,
  - Supabase / Lovable-managed environment checks,
  - backend-activation verification and Lovable-specific activation.
- Should be the agent consulted to confirm "is the workspace in sync and idle?"

### Codex — planning / prompt / review / handoff
- Clarifies goals, drafts/refines prompts, reviews Claude and Lovable output, and
  decides **proceed / revise / merge / stop**.
- Maintains review/handoff context; does not implement code itself.

## 2. Branch & edit discipline

- Claude and Lovable must **not** edit the same branch concurrently.
- One active implementation branch per change; Claude owns it end-to-end unless an
  explicit exception is declared (§5).
- Treat `main` as the single source of truth that both GitHub and Lovable track.

## 3. Merge / push to `main`

- Before merging or pushing to `main`, **Shakoure must confirm Lovable is idle and
  in sync.**
- Claude must surface this reminder before any merge:
  > "Please confirm Lovable is idle and in sync."
- Claude prepares and pushes PRs but **stops before merge** unless the owner has
  explicitly authorized the merge for that PR.

## 4. Backend activation

- Backend activation (Supabase migrations, Edge Functions, Storage policies, RLS,
  triggers/functions, secrets) is a **separate, explicitly-requested and confirmed**
  step — see the Backend Activation Policy in `CLAUDE.md` and `BACKEND_ACTIVATION.md`.
- Documentation-only or code PRs must **not** imply backend activation. Every task
  ends with an explicit **Backend Activation Required: YES/NO** statement.
- Lovable performs/verifies Lovable-managed activation; Claude never claims a backend
  change is live without that confirmation.

## 5. Exceptions

- Any case where **Lovable edits repo code** is an **exception** and must be:
  1. explicitly called out as an exception, and
  2. scheduled so it does **not** overlap with Claude's active branch.

## 6. Divergence recovery

- If Lovable and GitHub diverge, **stop** and choose **one** recovery path; do not
  layer fixes or work both copies in parallel.
- **Do not** hand-copy raw blobs as a routine reconciliation. Prefer a clean,
  reviewable path: rebase/merge through Git, or re-sync from the agreed source of
  truth (`main`), with the owner deciding which side wins.
- Record the chosen recovery path and outcome in `.codex-review/claude-session.md`.
