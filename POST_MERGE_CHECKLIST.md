# Post-Merge Backend Apply Checklist

This project syncs code between GitHub and Lovable, but **does not auto-apply
Supabase backend changes on PR merge to `main`**. This document is the manual
gate that has to run after any PR that touches `supabase/`.

> ⚠️ **Safety rule — never auto-apply destructive migrations.**
> Any migration containing `DROP`, `TRUNCATE`, `DELETE FROM`,
> `ALTER ... DROP`, `DISABLE ROW LEVEL SECURITY`, or `DROP POLICY`
> requires explicit human review and a backup confirmation before apply.
> The agent-mediated flow below honors this gate; a raw `supabase db push`
> does not. Use the destructive-diff grep in Step 0 before every apply.

---

## What automatic vs. manual looks like

| Change | On PR merge | How it actually gets applied |
|---|---|---|
| `supabase/migrations/*.sql` | ❌ Not applied | Lovable chat (`supabase--migration`) or `supabase db push` |
| `supabase/functions/*` | ❌ Not deployed | Lovable chat (`supabase--deploy_edge_functions`) or `supabase functions deploy` |
| Storage buckets + storage policies | ❌ Not applied | Same as migrations (defined in SQL) |
| RLS policies | ❌ Not applied | Same as migrations |
| `supabase/config.toml` per-function flags | ❌ Not applied | Re-deploy the function via Lovable chat |
| Secrets / env vars | ❌ Never via repo | Lovable Cloud → Secrets, or Workspace Settings → Build Secrets |
| Frontend (`src/**`) | ❌ Not published | Click **Publish → Update** in Lovable |
| `src/integrations/supabase/types.ts` | ✅ Auto-regenerated **only** when migration runs via Lovable agent | If you used raw CLI, ask agent to regen |

---

## What Claude Code (or any PR author) should include

When a PR touches the backend, the PR description must list:

- [ ] New migration filenames (e.g., `20260601120000_add_orders_index.sql`)
- [ ] Edge functions added/changed (with function names)
- [ ] Any new `process.env.X` / `Deno.env.get("X")` references → secret name + where to add (runtime vs build)
- [ ] Storage buckets created or modified
- [ ] RLS policy changes (which table, which role, which command)
- [ ] **Destructive operations flagged at the top** (DROP/TRUNCATE/etc.)
- [ ] Manual verification SQL the reviewer should run after apply

---

## Step 0 — Destructive-change gate (run before anything else)

```bash
git fetch origin main
git diff origin/main~1 origin/main -- supabase/migrations/ supabase/functions/ \
  | grep -iE 'DROP |TRUNCATE|DELETE FROM|DISABLE ROW LEVEL SECURITY|DROP POLICY|ALTER .* DROP'
```

- **No matches** → safe to proceed.
- **Any matches** → **STOP.** Get human review. Confirm a recent database
  backup exists. Apply via Lovable chat one migration at a time, not in bulk.

---

## Step 1 — Apply migrations

**Preferred (agent-mediated):**
Open a Lovable chat and say:
> Apply the new migrations in `supabase/migrations/` that haven't been run yet.
> Surface any security-linter warnings.

The agent runs each migration, regenerates `src/integrations/supabase/types.ts`,
and reports linter results.

**Alternative (CLI):**
```bash
supabase link --project-ref cllvwdzjgqlkdquroauz
supabase db push
```
If you go this route, also ask the Lovable agent to regenerate types so the
strict TS build doesn't fail.

### Verify
```sql
-- Recent migrations actually applied
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 10;

-- Spot-check a new table
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = '<new_table>';
```

---

## Step 2 — Deploy edge functions

**Preferred:** ask the Lovable agent:
> Deploy edge functions: `<fn-a>`, `<fn-b>`.

**Alternative:**
```bash
supabase functions deploy <fn-name> --project-ref cllvwdzjgqlkdquroauz
```

### Verify
- Hit the function with a known-safe test payload (use Lovable's
  `supabase--curl_edge_functions` or `curl` against the deployed URL).
- Check logs:
  ```
  Lovable chat: "Show me the last 50 log lines for <fn-name>."
  ```
- Confirm any new `[functions.<fn-name>]` block in `supabase/config.toml`
  (e.g., `verify_jwt = false`) is reflected after deploy. Re-deploy if not.

---

## Step 3 — Verify RLS policies

```sql
-- All policies on public + storage
SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;

-- Tables that should have RLS — confirm it's enabled
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

- Every table with user data must show `rowsecurity = true`.
- Reject policies with `qual = 'true'` unless intentionally public.
- For new policies, manually simulate an unauthorized session:
  ```sql
  SET LOCAL ROLE anon;
  SELECT * FROM <new_table> LIMIT 1;   -- should fail or return nothing
  RESET ROLE;
  ```

---

## Step 4 — Verify storage buckets + storage policies

```sql
-- Buckets and their visibility
SELECT id, name, public, created_at
FROM storage.buckets
ORDER BY created_at DESC;

-- Storage policies (also visible from Step 3 query)
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects';
```

- A `public = true` bucket means anonymous read of every object. Confirm that
  is intentional for each bucket the PR added.
- For private buckets, confirm a SELECT policy scopes by `auth.uid()` (or a
  similar owner check) — not just `true`.

---

## Step 5 — Add new secrets

For every new `process.env.X` / `Deno.env.get("X")` reference in the PR:

| Used in | Where to add |
|---|---|
| Server functions (`src/lib/**.functions.ts`) | Lovable Cloud → **Secrets** |
| Edge functions (`supabase/functions/**`) | Lovable Cloud → **Secrets** |
| `npm install` / `bun install` (private registry, build tools) | Workspace Settings → **Build Secrets** |

**Never** commit secrets to `.env*` — these files are gitignored
(see `AUDIT_REMEDIATION.md` Phase 1). After adding a runtime secret, re-deploy
any function that reads it (the value is injected at deploy time).

### Verify
- For an edge function: trigger it and check logs for the env-var-missing path.
- For a server function: hit the route that calls it and watch the network tab
  for a 500 with a missing-env error.

---

## Step 6 — Regenerate types (only if you used raw CLI)

If migrations were applied via `supabase db push` instead of the Lovable
agent, ask the agent:
> Please regenerate `src/integrations/supabase/types.ts` from the current schema.

Skip this step if you applied via Lovable chat — it happens automatically.

---

## Step 7 — Publish frontend

The frontend does **not** auto-publish on PR merge either. Open Lovable and
click **Publish → Update**. The Supabase backend changes from Steps 1–5 must
be live **before** this step, otherwise the new frontend code may call
endpoints, tables, or columns that don't exist yet.

---

## Quick reference — the full apply flow

```text
PR merged to main
    │
    ▼
Step 0  Destructive-diff grep         ──► STOP if matches
    │
    ▼
Step 1  Apply migrations              (Lovable chat or CLI)
    │
    ▼
Step 2  Deploy edge functions         (Lovable chat or CLI)
    │
    ▼
Step 3  Verify RLS policies           (pg_policies query)
    │
    ▼
Step 4  Verify storage buckets        (storage.buckets query)
    │
    ▼
Step 5  Add new secrets               (Lovable Cloud or Workspace)
    │
    ▼
Step 6  Regenerate types if CLI used
    │
    ▼
Step 7  Publish → Update              (frontend goes live)
```

---

## When in doubt

Open a Lovable chat and say:
> A PR with backend changes was just merged. Walk through the post-merge
> checklist for `<branch-name>` and apply what's safe. Stop and ask me before
> running any destructive SQL.
