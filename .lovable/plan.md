## Goal

Activate **only** Track A PR-A1 — the additive, inert billing foundation. No checkout, webhook, cron, Edge Function, Stripe, or Track B work.

## Current state (verified)

Both migration files already exist in the repo, but **neither has been applied** to the database:
- `platform_fee_schedule`, `platform_fee_ledger`, `_resolve_platform_fee_cents` — absent
- `client_providers.acquisition_source`, `invitations.acquisition_source` — absent

## Steps

1. Apply `supabase/migrations/20260528400000_frontiers3d_platform_fee_foundation.sql` via the migration tool (full file body, unchanged).
2. Apply `supabase/migrations/20260529020000_frontiers3d_acquisition_attribution.sql` via the migration tool (full file body, unchanged). This is a `CREATE OR REPLACE` of `handle_new_user` — the body is byte-for-byte the existing function plus one propagated `acquisition_source` field. Signup is critical; verification B catches any break.
3. Run PR-A1 verification (A–J from `BACKEND_ACTIVATION.md`) using read-only SQL:
   - **A** Object presence (5 objects)
   - **C** Column shape, backfill = 0 rows non-default, 4-value CHECK on both tables (incl. `directory_request`)
   - **D** RLS enabled on both new tables
   - **E** Exactly 20 active fee rows; dump grid
   - **F** Resolver returns correct cents for all 20 combos
   - **G** Resolver rejects invalid inputs (unknown source, 0, 6, NULLs)
   - **H** Ledger exists and is empty
   - **I** Resolver granted to `service_role` only, not PUBLIC
   - **B / J** Signup paths — verified by inspecting the new `handle_new_user` body + invitation propagation logic (cannot run live `auth.users` inserts from a read-only query; will confirm via function source + CHECK constraints).
4. Report pass/fail per check. If anything fails, stop and report — do not advance to A2/A3/A4 or Track B.

## Non-goals (explicitly skipped)

- A2, A3, A4 migrations
- Track B / Map Oracle migrations
- Edge Function deploys
- Stripe / secrets / cron / data mutations beyond what these two migrations perform

## Backend Activation

**Backend Activation Required: YES** — two additive migrations only. **Destructive: NO.**
