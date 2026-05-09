## Issues Identified

**1. Visitor never receives a confirmation email.**
The `service-match-ready` email template exists and is registered, but `capture-service-match` edge function never enqueues it after a successful insert. The visitor only sees the on-screen toast.

**2. Admin "Open" button points to the public visitor match page.**
The admin table links to `/agents/match/$matchToken`, which is the agent-facing match page. That page intentionally hides visitor PII (per the recommendation spec) and only shows "no studios match yet" when the matcher returns nothing — so to an admin it looks like an empty/duplicate page with no context.

We need a separate **admin-only** match-detail view that shows visitor identity AND the matched MSPs side-by-side, while leaving the public `/agents/match/$matchToken` page unchanged (it must keep following the no-PII spec).

---

## Plan

### Part 1 — Send the visitor confirmation email

In `supabase/functions/capture-service-match/index.ts`, after a successful insert/upsert and before returning, enqueue the existing `service-match-ready` template via `enqueue_email`:

- Skip if the email is in `suppressed_emails`.
- Build `matchUrl` as `${SITE_URL or fallback}/agents/match/{match_token}`.
- Pass `agentName`, `city`, `essentialServices`, `preferableServices`, `matchUrl`.
- Stamp `agent_beacons.service_match_notified_at = now()` so we don't re-send on duplicate submissions.

This keeps email delivery on the existing pgmq queue (no new infra).

### Part 2 — Admin-only match detail view

Create a new authenticated route:

```
src/routes/_authenticated.admin.service-matches.$matchToken.tsx
```

It will:

- Call a new admin RPC `get_service_match_detail_for_admin(p_match_token uuid)` (SECURITY DEFINER, gated by `has_role(auth.uid(),'admin')`) that returns:
  - the beacon row (name, email, brokerage, city, region, zip, services, created_at, expires_at, pro_visibility_until, status), AND
  - the same matched-MSP rows produced by `get_service_match_results`.
- Render two stacked panels:
  1. **Visitor card** — name, company, email, location/ZIP, submitted-at, expires-at, current visibility window badge ("Pro Partner Exclusive — Xh left" or "Expanded Match Window"), Essential/Preferable service chips with icons.
  2. **Matched MSPs panel** — same card layout/quality labels as the public page (Complete / Strong / Essential), grouped/sorted exactly per the recommendation rules already implemented in `get_service_match_results` (Pro-first during 24h window; Pro then Starter after; ranked by preferable-match count). Includes an empty-state explaining no qualifying MSPs yet.
  3. A button to open the public visitor view in a new tab for QA.

### Part 3 — Wire it into the admin table

In `src/routes/_authenticated.admin.service-matches.tsx`, change the row "Open" button from `/agents/match/{token}` to `/admin/service-matches/{token}` (internal `<Link>`).

### Part 4 — Verification

After approval and implementation:
- Submit a "Notify Me" from the directory; confirm an email is enqueued in `email_send_log` with `template_name = 'service-match-ready'`.
- Open a row from the admin table; confirm the new admin detail view shows visitor info AND the matched-MSP list (or correct empty state).
- Public `/agents/match/$matchToken` remains unchanged and PII-free.

### Files touched

- **edit** `supabase/functions/capture-service-match/index.ts` — enqueue visitor email + stamp `service_match_notified_at`.
- **new migration** — add `get_service_match_detail_for_admin(uuid)` RPC.
- **new route** `src/routes/_authenticated.admin.service-matches.$matchToken.tsx`.
- **edit** `src/routes/_authenticated.admin.service-matches.tsx` — repoint "Open" button.
- No changes to `/agents/match/$matchToken` (spec-compliant as-is).