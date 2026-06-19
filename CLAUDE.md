# CLAUDE.md — Project Instructions for Claude Code

## Project Overview

This is the **3D Presentation Studio (3DPS)** — a white-label Matterport tour builder platform. The frontend is a TanStack Start (React + Vite) app deployed via Lovable. The backend is Supabase (Postgres, Edge Functions, Auth, Storage, RLS).

- **Package manager:** Bun
- **Framework:** TanStack Start (file-based routing via TanStack Router)
- **UI:** shadcn/ui + Tailwind CSS + Radix primitives
- **Database:** Supabase (Postgres with RLS)
- **Auth:** Supabase Auth (email + Google OAuth)
- **Payments:** Stripe (Embedded Checkout + Connect)
- **Deployment:** Lovable (frontend) + Supabase (backend)
- **Repo owner:** Socialeap (GitHub)

## AI Role Split & Lovable Sync Protocol

Three AI assistants collaborate on this repo. Keep their roles distinct to avoid
GitHub/Lovable divergence, backend-activation confusion, and duplicated work. The
detailed rules and recovery paths live in `.codex-review/sync-protocol.md` — read
it before any branch/merge/activation coordination.

**Roles**

- **Claude Code / Claude App — primary implementation agent.** Owns repo changes,
  branch/PR preparation, tests, and code verification (`tsc`, `eslint`, `build`,
  `verify:html`, `verify:no-secrets`, `test:intelligence`).
- **Lovable — secondary, read-only / deploy-aware by default.** Use it for
  deployment state, backend-activation verification, Supabase/Lovable-managed
  environment checks, and Lovable-specific activation. Lovable normally does **not**
  edit repo code.
- **Codex — planning / prompt / review / handoff.** Use it to clarify goals,
  review Claude/Lovable output, and decide proceed / revise / merge / stop.

**Sync rules**

- Claude and Lovable must **not** edit the same branch concurrently.
- Before merging or pushing to `main`, Shakoure must confirm Lovable is **idle and
  in sync**. Claude must surface this reminder before any merge:
  > "Please confirm Lovable is idle and in sync."
- Backend activation must be **explicitly requested and confirmed**. Documentation-
  only or code PRs must **not** imply backend activation (see the Backend Activation
  Policy below and `BACKEND_ACTIVATION.md`).
- Lovable may **review** plans and deployment/backend status **without editing**.
- If Lovable/GitHub diverge, **stop** and pick **one** recovery path (see the sync
  protocol). Do **not** routinely hand-copy raw blobs to reconcile.
- Any exception where Lovable edits repo code must be **explicitly called out as an
  exception** and must **not** overlap with Claude's active branch.

## Product End-State Alignment Rule

`PRODUCT_END_STATES.md` (repo root) is the compressed product-direction baseline. Detailed per-component workflows live in scoped memory under `.lovable/memory/features/` (indexed in `.lovable/memory/index.md`). Consult them so work advances the approved end-states without re-deriving direction or drifting from it — and without paying token cost on trivial work.

**Read once per development session:** read `PRODUCT_END_STATES.md` at the start of any session that will plan, implement, debug, or ship.

**Re-read only the relevant component baseline + its linked scoped memory before:**

- creating or materially revising a plan;
- implementing a feature or architectural change;
- debugging a behavioral regression;
- changing public copy or user-facing workflows;
- declaring a PR ready for review or merge.

**While doing the above:**

- Identify conflicts with the approved end-state **before** editing, and report them first.
- **Never modify an approved product end-state without explicit user (Shakoure) approval.**
- Keep detailed discoveries in scoped memory or tactical docs — not in the global baseline.
- Treat implementation anchors as current references, not permanent architecture.

**PWA / App Shell routing:** When work touches mobile UX, installability, offline behavior, service-worker caching, update prompts, notifications, long-running job alerts, app shortcuts, or share-target behavior, consult the PWA/App Shell docs (`.lovable/memory/features/pwa-app-shell.md`) and the current `public/sw.js` + `public/sw-cache-policy.js` before planning or editing. Do not broaden service-worker caching to private/admin/API/server-function/upload/Matterport/Live-Tour data without explicit owner approval.

**Skip the End-State read entirely** for trivial status checks, simple Git operations, formatting-only changes, and unrelated mechanical tasks — do not spend tokens re-reading the baseline for work that cannot affect product direction.

**Required completion block** — include for every qualifying task (planning, implementation, debugging, copy/workflow changes, or PR readiness):

```text
End-State Alignment
- Component:
- Approved outcome advanced:
- Boundaries preserved:
- Cross-component effects:
- Acceptance evidence:
- Remaining gap:
- PRODUCT_END_STATES.md revision required: YES/NO
```

## Backend Activation Policy for Lovable + Supabase

This project is Lovable-managed with Supabase. PR merges into `main` only sync code into the repo/Lovable workspace. They do **not** automatically activate backend changes. Supabase migrations, Edge Functions, Storage policies, RLS policies, triggers/functions, and secrets require a separate backend activation step through Lovable agent tooling, Supabase Dashboard, or Supabase CLI.

### Rules

1. **Never assume backend changes are live after a PR merge.** Code deployment and backend activation are separate steps in this project.

2. **For any task involving Supabase migrations, Edge Functions, Storage buckets, Storage policies, RLS policies, database triggers/functions, or secrets**, create or update a repo-root file named `BACKEND_ACTIVATION.md`.

3. `BACKEND_ACTIVATION.md` must be specific enough that Lovable does not need to infer backend intent from the repo.

4. List exactly which backend actions are required and which backend areas must not be touched.

5. Include exact migration file paths, Edge Function names, storage bucket/policy changes, RLS policy changes, database functions/triggers, and required secrets/env vars.

6. Include exact SQL or CLI commands needed when relevant.

7. Include verification SQL/checks and the expected success result.

8. Safety-check all SQL before finalizing. Scan for `DROP`, `DELETE`, `TRUNCATE`, destructive `ALTER`, policy removal, RLS weakening, or secret changes.

9. Clearly flag destructive operations. Use a bold warning if any destructive SQL is present.

10. **Do not apply, recommend applying, or imply approval for destructive backend changes without explicit human approval.**

11. **Never claim a feature is fully activated until the backend change has been applied and verified.**

## CODEX_REVIEW_QUEUE.md Update Rule

After completing or materially revising **every PR**, update `CODEX_REVIEW_QUEUE.md` before reporting the PR ready for review or merge. This is mandatory even when no backend activation is required.

### Required checklist fields

- Current date/time (ISO 8601)
- Repository path and active branch
- PR number and URL
- Base commit and head commit
- Current status: `planning` | `implementing` | `blocked` | `ready for review` | `ready to merge`
- Concise summary of what changed (what the PR does, not a step list)
- Exact files changed
- Verification commands and results (`test:intelligence N/M`, `verify:html`, `tsc`, `build`)
- Known failures, risks, or untested behavior
- Backend activation requirements (YES/NO per the policy below)
- End-State Alignment block (per the Product End-State Alignment Rule) for the affected component
- Decisions or approvals still needed
- Recommended next action
- Superseded PRs, plans, and prior recommendations explicitly identified

### Format rules

- **Replace** the existing "Current Review Request" section — never append another transcript entry.
- Keep the entire file under 250 lines.
- Keep it current: verify the file reflects the actual Git branch, PR, commit history, and test status before ending any implementation session.
- Never leave an older PR as the current request after a newer PR revision has been completed.

### Session milestone log

After updating the queue, **append** a brief timestamped milestone entry to `.codex-review/claude-session.md` (curated rolling log — newest last, compact, no large code blocks, no secrets).

### Required Completion Behavior

At the end of every task, include one of these two sections:

**A. If no backend activation is required:**

```
Backend Activation Required: NO
Reason: [brief explanation]
```

**B. If backend activation is required:**

```
Backend Activation Required: YES
Activation file: BACKEND_ACTIVATION.md
Required actions:
- [exact backend action]
Verification:
- [exact verification SQL/check]
Expected result:
- [expected outcome]
```
