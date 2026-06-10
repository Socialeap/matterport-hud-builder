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
