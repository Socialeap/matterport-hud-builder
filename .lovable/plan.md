
# MSP Service Match — Final Implementation Plan (v3)

Final guardrails from review applied. Strict separation between (a) the existing 72h per-MSP lead-assignment workflow (`claim_pending_beacon_matches`, untouched) and (b) the new 24h agent-facing visibility window on the public MSP Service Match page.

---

## Guardrails baked into this plan

- **G1 — Match detection:** A beacon is a "service match" beacon iff `cardinality(essential_services) > 0 OR cardinality(preferable_services) > 0`. This single predicate is used everywhere the system distinguishes legacy beacons from service-match beacons (email enqueue branch, page rendering, summary RPC).
- **G2 — Idempotency key** for `capture-service-match` includes: `lower(email) | lower(city) | upper(coalesce(region,'')) | coalesce(zip,'') | sorted(essential_services) | sorted(preferable_services)`. Two requests with same essentials but different preferred services produce two distinct rows.
- **G3 — Geo:** `get_service_match_results` calls the existing `public._is_provider_serving_beacon(bs.provider_id, b.id)` helper. No bespoke city/ZIP/radius rebuild.
- **G4 — Safe summary RPC:** `get_service_match_summary` never returns agent name/email. For expired or invalid tokens it returns a single-row status object: `{ status: 'active' | 'expired' | 'not_found' }` (and only when `active` includes location/services/window fields).
- **G5 — Public-labelled directory fields** in Branding dashboard with helper text:
  *"These details may appear on your public MSP Directory card and MSP Service Match results."*
- **G6 — `claim_pending_beacon_matches` is not modified.** The 72h `exclusive_provider_id` / `exclusive_until` per-MSP private lead workflow stays exactly as-is.
- **G7 — Satisfaction-rating pointer** copy used verbatim:
  *"If you hire any matched MSP for one of the listed services, you may receive a request to provide a short satisfaction rating. Your feedback helps us improve future MSP Service Match results."*

---

## 1. Two windows, fully independent

| Mechanism | Purpose | Drives | Touched? |
|---|---|---|---|
| `agent_beacons.exclusive_provider_id` + `exclusive_until` (existing, 72h) | Private first-look lead routed to ONE Pro MSP | `claim_pending_beacon_matches` + `marketplace-lead-assigned` | **No** |
| `agent_beacons.pro_visibility_until` (NEW, 24h) | What the agent sees on the public match page | `get_service_match_results` only | New, additive |

## 2. Schema migration

```sql
ALTER TABLE public.agent_beacons
  ADD COLUMN essential_services  public.marketplace_specialty[] NOT NULL DEFAULT '{}',
  ADD COLUMN preferable_services public.marketplace_specialty[] NOT NULL DEFAULT '{}',
  ADD COLUMN pro_visibility_until timestamptz,
  ADD COLUMN match_token uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX ON public.agent_beacons (match_token);

-- Trigger: essential ∩ preferable must be empty
CREATE OR REPLACE FUNCTION public.enforce_service_pref_disjoint() ...
```

`beacon_notifications.kind` CHECK constraint is read at migration time and re-issued as the union of existing values + `service_match_ready`, `service_match_expanded`.

New table `service_match_interest_events`:
- `id, beacon_id, provider_id, event_type, created_at, metadata jsonb`
- `event_type CHECK IN ('notify_msp','click_studio','click_website','click_email','click_phone')`
- RLS: service-role insert; provider can read rows where `provider_id = auth.uid()`; admins read all.
- PII may appear in `metadata` only for `notify_msp` and only when parent beacon has `consent_given = true`.

Public contact fields on `branding_settings`:
```sql
ALTER TABLE public.branding_settings
  ADD COLUMN directory_website_url text,
  ADD COLUMN directory_contact_email text,
  ADD COLUMN directory_phone text;
```

## 3. RPCs (additive)

**`get_service_match_summary(p_match_token uuid) → jsonb`**
Returns `{ status: 'active' | 'expired' | 'not_found', ... }`. When `active`, also returns `{ city, region, zip, essential_services, preferable_services, pro_visibility_until, expires_at, is_pro_window }`. **Never** returns email, name, brokerage, IP, or user-agent.

**`get_service_match_results(p_match_token uuid)`** — `SECURITY DEFINER`, granted to `anon, authenticated`. Returns only public branding fields:
```
brand_name, slug, logo_url, tier, primary_city, region,
directory_website_url, directory_contact_email, directory_phone,
matched_essential text[], matched_preferable text[], missing_preferable text[],
match_score int, match_quality text  -- 'complete' | 'strong' | 'essential'
```
Logic:
1. Resolve beacon by `match_token` (must be active and not expired). Return empty if not.
2. **Geo (G3):** `WHERE public._is_provider_serving_beacon(bs.provider_id, b.id)`.
3. `bs.is_directory_public = TRUE`.
4. Hard requirement: `cardinality(b.essential_services) = 0 OR b.essential_services <@ bs.specialties`.
5. Tier visibility gate: if `now() < b.pro_visibility_until` → `bs.tier = 'pro'`; else both tiers.
6. Score = `cardinality(array(SELECT unnest(b.preferable_services) INTERSECT SELECT unnest(bs.specialties)))`.
7. Order: `(bs.tier='pro') DESC, score DESC, brand_name`.
8. `match_quality`: complete = all preferable matched (and essentials matched); strong = at least one preferable matched; essential = essentials only.

**`record_service_match_interest(p_match_token uuid, p_provider_id uuid, p_event_type text)`** — anon-callable, validates token and event type, validates provider appears in current results, inserts an event row. For `notify_msp` (and only when `consent_given = true`) enqueues a one-shot `marketplace-lead-interest` email to the chosen MSP via `enqueue_email`.

## 4. Edge function `capture-service-match` (new)

Mirrors `capture-beacon`: validation, suppression list check, IP rate-limit. Adds:
- Validates `essential_services` and `preferable_services` against the enum and enforces disjointness.
- **G2 idempotency:** `(lower(email), lower(city), upper(coalesce(region,'')), coalesce(zip,''), sorted(essential), sorted(preferable))`.
- Sets `pro_visibility_until = now() + interval '24 hours'`.
- Returns `{ match_token }`.
- Triggers `match-beacons` (no behavioral change to claim logic) so the email enqueue branch can run.

`supabase/config.toml`: `[functions.capture-service-match] verify_jwt = false`.

`supabase/functions/match-beacons/index.ts`: small additive branch — for any beacon where **G1** is true and no `service_match_ready` row exists in `beacon_notifications`, enqueue `service-match-ready` and insert the notification row. The existing `marketplace-lead-assigned` enqueue stays as-is.

## 5. UI: `/agents` directory

`src/routes/agents.tsx`:
- Replace each FilterGroup row's checkbox with a 3-state segmented control (`ToggleGroup type="single"`): **Not Needed / Preferable / Essential**. Same control desktop + mobile.
- Lifted state: `Record<MarketplaceSpecialty, 'none'|'preferable'|'essential'>`.
- Two CTAs at the bottom of the panel:
  - **Notify Me When Matches Are Available** — unchanged legacy `capture-beacon` flow. Always visible.
  - **Create MSP Service Match** — primary, **enabled only when at least one Essential or Preferable is set** (G1), opens `ServiceMatchForm`.

## 6. `ServiceMatchForm.tsx` (new)

Based on `BeaconForm` plus readonly chip lists for the chosen Essential and Preferable services. Same consent text + suppression behavior. POSTs to `capture-service-match`. On success: toast + "Open my match page" → `/agents/match/{match_token}`.

## 7. Public match page

Route: `src/routes/agents.match.$matchToken.tsx` (public, no auth).
- Loader calls `get_service_match_summary` first; if `not_found` or `expired`, render a friendly status page (no PII echoed). Otherwise call `get_service_match_results`.
- Visual language matches `/agents`: dark cinematic bg, subtle grid, glass cards, amber/cyan accents.
- Header: "MSP Service Match" + intro copy.
- Summary card: location, Essential chips, Preferable chips, window badge:
  - In Pro window: **"Pro Partner Exclusive Window — opens to all qualifying studios in {countdown}."**
  - After: **"Expanded Match Window — Pro and Starter studios shown."**
- MSP cards:
  - Logo, name, Pro/Starter badge, city/region.
  - ✓ Matched Essential, ✓ Matched Preferable, muted Missing Preferable.
  - Quality label (Complete / Strong / Essential).
  - **Visit Studio** → `/p/{slug}` (records `click_studio`).
  - **Website**, **Email** (`mailto:`), **Call** (`tel:`) — rendered only when the corresponding `directory_*` field is set; clicks record the matching event.
  - **Notify this MSP I'm interested** — calls `record_service_match_interest('notify_msp')`, shows inline confirmation, button disables for that card.
- Empty state: "No qualifying studios yet — we'll email you the moment one becomes available."
- Footer pointer (G7): satisfaction-rating sentence verbatim.
- Page never displays the agent's email or name.

## 8. Email templates

`src/lib/email-templates/service-match-ready.tsx` — subject "Your MSP Service Match is ready". Body: location, essential/preferable lists, window note, CTA → `/agents/match/{match_token}`. Optional `service-match-expanded.tsx` for the post-24h notice (gated by the new `kind` value). Registered in `registry.ts`.

`marketplace-lead-interest.tsx` (new, optional reuse of existing outreach template) — sent to a single MSP only when the agent clicks "Notify this MSP I'm interested".

The legacy `beacon-match-found` email continues for legacy beacons (G1 false). The two paths are mutually exclusive.

## 9. Branding dashboard (G5)

`src/routes/_authenticated.dashboard.branding.tsx` — three new optional inputs grouped under a labelled section **"Public Directory & Match Contact"**, with helper text:
*"These details may appear on your public MSP Directory card and MSP Service Match results."*
Fields: Public website URL, Public contact email, Public phone.

## 10. Privacy / security guarantees

- Match page resolved by unguessable `match_token` only.
- Public RPCs return only public branding fields and the new `directory_*` opt-in fields; never `auth.users.email`.
- `notify_msp` is the only event that hands the agent's contact info to an MSP, and only via the `marketplace-lead-interest` email (with `consent_given` re-checked).
- Other event types (`click_*`) store no PII.
- 3DPS does not auto-broker.

## 11. Files to change / create

Migrations
- `2026xxxx_msp_service_match.sql` — columns, disjointness trigger, `match_token` index, `service_match_interest_events`, `branding_settings.directory_*`, `beacon_notifications.kind` CHECK update, RPCs, RLS, grants.

Backend
- `supabase/functions/capture-service-match/index.ts` — new.
- `supabase/functions/match-beacons/index.ts` — additive enqueue branch (G1).
- `supabase/config.toml` — `verify_jwt=false` for `capture-service-match`.
- `src/lib/email-templates/service-match-ready.tsx` (+ `service-match-expanded.tsx`, `marketplace-lead-interest.tsx`) + `registry.ts`.

Frontend
- `src/routes/agents.tsx` — 3-state controls, lifted state, dual CTAs.
- `src/components/marketplace/ServiceMatchForm.tsx` — new.
- `src/routes/agents.match.$matchToken.tsx` — new public page.
- `src/routes/_authenticated.dashboard.branding.tsx` — three public-labelled directory contact fields.

## 12. Risks

- Enum coverage: every UI service must map to an existing `marketplace_specialty` enum value; audit all 13 before migration.
- `beacon_notifications.kind` CHECK: read current definition at migration time; union with new values.
- Two visibility windows (24h public match page vs 72h per-MSP private lead) documented in migration header.
- Public RPCs use explicit column allow-list — no `SELECT *` from `branding_settings` or `auth.users`.

## 13. Staged rollout

1. Migration (columns, token, events, branding directory fields, RPCs, CHECK update).
2. `capture-service-match` edge fn + email templates + additive branch in `match-beacons`.
3. Public match page wired to the two new RPCs.
4. `/agents` 3-state UI + dual CTAs + `ServiceMatchForm`.
5. Branding dashboard inputs for the three public contact fields.
6. Smoke-test end-to-end: submit (essentials only), submit (preferables only), submit (both) → match page → Pro-only window → simulate clock past 24h → expanded results → trigger each tracked event → "Notify MSP" delivers the lead-interest email.
