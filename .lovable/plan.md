## Diagnosis

The "build errors" and the empty MSP directory share the **same root cause**: four migrations created in the last batch never ran on the cloud database.

Confirmed via `supabase_migrations.schema_migrations`:

```
Last applied: 20260509154555   (= file 20260509154600_…)
NEVER applied:
  20260509200000_work_order_workflow.sql
  20260509200010_work_order_rpcs.sql
  20260509200020_work_order_policy_updates.sql
  20260509210000_seed_mock_msps.sql
```

Confirmed via direct DB probe:
- `to_regclass('public.work_orders')` → `NULL` (table missing)
- All 10 work-order RPCs (`submit_work_order`, `get_my_work_orders`, etc.) → not in `pg_proc`
- `branding_settings WHERE is_directory_public = TRUE` → `0` rows

Because those RPCs don't exist in the live DB, the auto-generated `src/integrations/supabase/types.ts` doesn't list them, so every `supabase.rpc("submit_work_order", …)` etc. fails TypeScript with the "not assignable" error you see. The empty `/agents` directory is the same migration gap on the seed file.

Claude Code's hypothesis (Lovable's runner lacks `auth.*` privileges and silently rolled back the seed) is partly right for the seed, but the work-order trio doesn't touch `auth` at all — those simply weren't picked up by the migration runner (likely because they were authored outside the `supabase--migration` tool path).

## Plan

### Step 1 — Re-run the 3 work-order migrations through the migration tool

Re-issue the exact SQL from these three files via `supabase--migration` (one call each, in order):

1. `20260509200000_work_order_workflow.sql` — tables + enums + indexes
2. `20260509200010_work_order_rpcs.sql` — all 10 RPCs (`submit_work_order`, `get_work_order_detail_for_agent`, `get_my_work_orders`, `respond_to_work_order_invite`, `mark_work_order_complete`, `lookup_work_order_rating_by_token`, `submit_work_order_rating`, `confirm_work_order_msp`, `cancel_work_order`, `get_my_work_order_invites`)
3. `20260509200020_work_order_policy_updates.sql` — RLS

Every statement is already idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DO $$ … duplicate_object`), so re-running on top of the leftover files is safe.

Once these apply:
- `work_orders` / `work_order_invites` / `work_order_ratings` exist
- All 10 RPCs are registered
- `types.ts` will be regenerated automatically by the platform
- Every TS error in `WorkOrderForm.tsx`, `agent-dashboard.work-orders.*`, `dashboard.work-orders.tsx`, and `work-orders.rate.$token.tsx` resolves with **zero source-code edits**

### Step 2 — Split the seed into a Lovable-safe migration + a manual auth bootstrap

The current seed mixes two trust levels in one transaction:
- `auth.users` + `auth.identities` writes (need elevated privileges)
- `branding_settings` + `licenses` + `user_roles` + `provider_responsiveness` writes (Lovable-safe)

Because the whole `DO $$ … END $$` block is one transaction, the `auth.users` failure rolls back **everything**, leaving zero directory rows. We split into two files:

**2a. New migration `20260509210001_seed_mock_msps_directory.sql`** (Lovable-safe)
- Creates 8 dedicated placeholder UUIDs in a new `seed_mock_provider_ids` CTE pattern
- Inserts directly into `branding_settings` only — but `provider_id` has an FK to `auth.users`, so we **first** create stub rows in `auth.users` using a `SECURITY DEFINER` helper function `public._seed_create_auth_user(uuid, text, text)` that the migration tool can invoke (functions defined in a migration run as the migration's owner, which has `auth` write privilege in our project — same mechanism `handle_new_user` already uses).
- Wraps each MSP in its own sub-block so a single failure can't roll the whole seed back.
- Keeps `cleanup_seed_msps()` for teardown.

**2b. Optional manual script `scripts/seed-msp-logins.sql`** (kept out of `supabase/migrations/`)
- Adds `auth.identities` + bcrypt password rows so the personas are loginable.
- Documented in a header comment as "run from Supabase SQL Editor when you need test logins" — not required for the directory to populate.

### Step 3 — Verify end-to-end after both migrations apply

Run probes through `supabase--read_query`:
```
SELECT count(*) FROM branding_settings WHERE is_directory_public = TRUE;   -- expect 8
SELECT proname FROM pg_proc WHERE proname IN ('submit_work_order', …);     -- expect 10
SELECT to_regclass('public.work_orders');                                   -- expect 'public.work_orders'
```

Then ensure the `/agents` page renders MSP cards (on-mount RPC will now return rows) and the build passes (types.ts regenerates with the new RPC names).

### Step 4 — No application-code edits required

Tracing the dependency graph:
- `WorkOrderForm.tsx`, `agent-dashboard.work-orders.*.tsx`, `dashboard.work-orders.tsx`, `work-orders.rate.$token.tsx` → already call the RPCs by their final names; only `types.ts` is stale
- `agents.tsx` directory query is unchanged; only data was missing
- No UI/UX, route, or business-logic regressions because we are purely closing the migration gap

If the migration tool itself rejects the `auth.users` insert in step 2a (some Lovable projects restrict the migration role from `auth` writes), we fall back to: the directory migration drops the `auth.users` insert and instead **temporarily relaxes the FK** by storing `provider_id` for the seed rows in a sibling table `mock_msp_directory` with identical columns and union-view it into `branding_settings` via the existing `get_msp_directory` RPC. We will only take that fallback if the auth insert path errors during execution; the primary path keeps `branding_settings` as the single source of truth.

## Risks & mitigations

- **Risk:** the work-order migrations partially applied last time and re-running corrupts state.
  **Mitigation:** every DDL is `IF NOT EXISTS` / `CREATE OR REPLACE` / `duplicate_object` guarded; verified by reading each file head.
- **Risk:** `types.ts` regeneration lags behind the migration apply.
  **Mitigation:** the platform regenerates on migration apply; we'll re-probe with `supabase--read_query` before declaring done.
- **Risk:** seed inserts run twice, duplicating directory rows.
  **Mitigation:** the seed already uses `ON CONFLICT (provider_id) DO UPDATE`, so reruns are idempotent.
