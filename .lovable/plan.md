## What's actually happening

The "Send Invite" flow on `/dashboard/clients` does three things in sequence:

1. **INSERT into `public.invitations`** (browser → PostgREST, RLS-checked as the user)
2. **POST `/lovable/email/transactional/send`** (browser → TanStack server route, JWT-checked, then service-role enqueue into pgmq)
3. **Dispatcher (`/lovable/email/queue/process`)** pulls from pgmq and calls the Lovable Email API.

The `is_free` toggle is **purely a column value** — no trigger, no CHECK constraint, no RLS branch keys off it. So "Free" itself can never cause a 403. The 403 must come from one of three real gates:

```text
[Browser] --insert--> invitations           ← RLS: auth.uid()=provider_id AND has_role(uid,'provider')
[Browser] --POST--> /lovable/email/.../send ← 401 if no Bearer; 5xx on enqueue fail
[Dispatcher] -----> Lovable Email API       ← 403 "Emails disabled" → row goes to DLQ
```

### Findings from the live DB

- `public.invitations` RLS INSERT requires **both** `auth.uid() = provider_id` **and** `has_role(uid, 'provider')`. PostgREST returns HTTP **403** when `WITH CHECK` fails.
- All three current Starter licensees (`978…`, `837…`, `8113…`) **do** have the `provider` role today — those rows were inserted by the mock-MSP seed migration, not by the production purchase trigger.
- Real role grants depend on `trg_assign_provider_role` on `purchases`, which only fires on **AFTER INSERT** when `NEW.status='completed'`. A future code path that pre-inserts a `pending` purchase row and later updates it to `completed` (or any flow that creates an active license without going through `purchases` insert) will leave the user **license-paid but role-less** → every invite insert returns 403.
- Past `email_send_log` rows for `invitation` show `status='dlq'` with `"Emails disabled for this project"`. That's a dispatcher-side 403 from the Lovable Email API, mapped to DLQ. It happens **after** the insert and after the 200 response from `/lovable/email/transactional/send`, so the UI today shows the success toast even though the email never leaves. The Starter user's "submitting failed" experience cannot come from this path, but the user-perceived failure (no email arrives) can.
- The current UI catch in `handleInvite` collapses every Supabase error into `"Failed to send invitation"` (only `duplicate` is special-cased), so we have no telemetry to tell 403 vs 409 vs network apart.

### Most likely root cause

The Starter MSP who tried to invite is missing the `provider` role on `public.user_roles`, so the `invitations` INSERT fails the `WITH CHECK` and PostgREST returns 403. The "Free" toggle is incidental.

## Plan

Four layered fixes — diagnostic first, then make the gates self-healing.

### 1. Surface the real error in the UI (telemetry)

`src/routes/_authenticated.dashboard.clients.tsx` — replace the silent
`"Failed to send invitation"` toast in `handleInvite` with one that:

- detects PostgREST RLS denial (`error.code === '42501'` or message contains `"row-level security"`) and shows `"Your account is missing the Provider role — try refreshing, or contact support."` plus a console.error with the full error object;
- keeps the duplicate-key branch;
- still falls back to the generic message for unknown errors.

This costs nothing and means the *next* report will be diagnosable in one screenshot.

### 2. Self-heal the `provider` role (root-cause fix)

Add a new migration with two safety nets so a paid Starter (or Pro) MSP can never be role-less:

**a. Backfill** — `INSERT INTO public.user_roles (user_id, role) SELECT user_id, 'provider' FROM public.licenses WHERE license_status='active' AND tier IN ('starter','pro') ON CONFLICT DO NOTHING;` plus the same for `admin_grants` (active, non-revoked).

**b. Forward-looking triggers** —
   - On `public.licenses` AFTER INSERT OR UPDATE OF `license_status`, `tier`: if `NEW.license_status='active'` and `NEW.tier IN ('starter','pro')`, upsert `user_roles(NEW.user_id,'provider')`.
   - On `public.purchases` change the existing `trg_assign_provider_role` to fire AFTER INSERT **OR UPDATE OF status** so a pending→completed transition also grants the role (idempotent thanks to ON CONFLICT).
   - On `public.admin_grants` AFTER INSERT WHEN `revoked_at IS NULL`, upsert the role.

All functions `SECURITY DEFINER` with `SET search_path = public`, mirroring the existing one.

### 3. Stop reporting "email sent" when the dispatcher is going to DLQ

Two small, isolated changes that don't touch business logic:

- **`src/routes/_authenticated.dashboard.clients.tsx`** — after the `fetch("/lovable/email/transactional/send")` resolves, surface a softer toast `"Invitation recorded — email delivery is in progress."` instead of `"Invitation sent"`, since the route only confirms enqueue, not delivery. This sets correct expectations and removes the false-success case for the "Emails disabled" scenario.
- **No change to the dispatcher** — the `403 → DLQ` mapping is already correct and intentional.

### 4. Verification

- Run the migration; re-query the role/license join to confirm every active Starter/Pro license has a `provider` role row.
- Simulate the failure locally by `DELETE FROM user_roles WHERE user_id=<starter> AND role='provider'`, attempt an invite from that account, and confirm the new toast shows the RLS-specific message; re-insert the role (or rely on the new license trigger by toggling `license_status`) and confirm the invite succeeds with both `Free` and `Pay` toggles.
- Inspect `email_send_log` to confirm a new `invitation` row reaches `status='sent'` (assuming Lovable Emails is enabled on this project).

## Files touched

- `src/routes/_authenticated.dashboard.clients.tsx` — better error toasts, softer success toast (UI only, no business logic).
- `supabase/migrations/<new>_self_heal_provider_role.sql` — backfill + three triggers.

## Out of scope

- The Stripe coupon / checkout work from prior turns is untouched.
- The Lovable Email "Emails disabled" project-level flag — that's a Cloud setting, not a code fix; the new toast just stops misrepresenting it.
- The `setClientFreeFlag` server function — unchanged; it's only used by the row-level toggle, not the create form.
