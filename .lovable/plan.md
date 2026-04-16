

# Perpetual License + Lead-Hook Bridge Implementation Plan

This is a major architectural overhaul spanning billing, database, HTML export, and AI chat behavior. Here is the phased plan.

---

## Phase 1: Database — New `licenses` Table

Create a new `licenses` table (per your preference for a dedicated table) to track franchise health:

```text
licenses
├── id               uuid PK
├── user_id          uuid (references auth.users)
├── tier             enum ('starter', 'pro')
├── license_status   enum ('active', 'past_due', 'expired')
├── license_expiry   timestamptz
├── studio_id        uuid UNIQUE (the Lead-Hook bridge identifier)
├── stripe_subscription_id  text
├── created_at       timestamptz
├── updated_at       timestamptz
```

- RLS: users can read their own row; service role can manage all
- `studio_id` is auto-generated on insert (default `gen_random_uuid()`)
- A helper function `get_license_status(user_uuid)` for quick checks

---

## Phase 2: Stripe Subscription Products

Replace the 3 one-time products with 2 subscription products using setup fees:

| Product | Setup Fee | Annual Recurring |
|---------|-----------|------------------|
| Starter Studio | $149 | $49/yr |
| Pro Studio | $299 | $59/yr |

**Implementation:**
- Use `batch_create_product` to create 2 new products with `recurring_interval: 'year'`
- Setup fees will be applied via `subscription_data.invoice_settings` in the checkout session
- Update `create-checkout` edge function: switch `mode` to `"subscription"`, add setup fee logic, pass `subscription_data.metadata.userId`
- Remove the old "Pro Upgrade" tier (replaced by subscription upgrade path)

---

## Phase 3: Webhook Updates

Extend `payments-webhook/index.ts` to handle subscription lifecycle events:

- `customer.subscription.created` → Insert into `licenses` table with `status: 'active'`, `license_expiry: now + 1 year`, generate `studio_id`
- `invoice.payment_succeeded` → Extend `license_expiry` by 1 year
- `customer.subscription.updated` → Sync status changes (e.g., `past_due`)
- `customer.subscription.deleted` → Set `license_status: 'expired'`

---

## Phase 4: Lead-Hook Bridge (Pro Only)

### New Edge Function: `handle-lead-capture`

A public endpoint that self-contained HTML files POST to:

```text
POST /handle-lead-capture
Body: { studio_id, visitor_email, property_name? }
```

Logic:
1. Look up `studio_id` in `licenses` table
2. Verify `tier = 'pro'` AND `license_status = 'active'`
3. Look up the provider's email from `profiles` (via `licenses.user_id`)
4. Send a transactional email via the existing email infrastructure to the agent/provider with the lead details
5. Return success/failure to the HTML file

### New Email Template: `lead-capture-alert`

A branded email template notifying the agent that a visitor provided their email, including the visitor's email, property name, and timestamp.

### HTML Export Injection (in `portal.functions.ts`)

During `generatePresentation`:
- If provider is **Pro** with active license: inject `studio_id` and the Lead-Hook endpoint URL into the HTML bundle's JavaScript
- Modify the AI chat system prompt: when AI detects interest or the conversation reaches a natural "contact" moment, it asks for the visitor's email and POSTs it to the Lead-Hook endpoint via `fetch()`
- If provider is **Starter**: AI uses `mailto:` protocol as fallback (existing behavior)

---

## Phase 5: Pricing Page Reframe

Update `_authenticated.dashboard.pricing.tsx`:
- Change copy to "Purchase your Studio (One-time setup) + Low Annual Operating License"
- Two tiers only: Starter ($149 + $49/yr) and Pro ($299 + $59/yr)
- Explicitly list "Automated AI Lead Generation (Lead-Hook Bridge)" as a Pro-only feature
- Remove the "Pro Upgrade" card

---

## Phase 6: License Guard in Builder

In `HudBuilderSandbox.tsx`:
- Query the `licenses` table for the current user
- If `license_expiry` is past or `license_status = 'expired'`:
  - Disable the Export/Generate button
  - Show banner: "Operating License Renewal Required. Your Studio setup is permanent, but your AI engine and Lead-Hook bridge require an active license."

---

## Dependency Note: Email Domain

The Lead-Hook Bridge sends emails via `notify.3dps.transcendencemedia.com`, which is still pending DNS verification. The code will be fully wired up, but lead capture emails will only deliver once DNS verification completes. You can monitor this in **Cloud → Emails**.

---

## Files Changed/Created

- **New migration**: `licenses` table, enum types, helper function
- **New edge function**: `supabase/functions/handle-lead-capture/index.ts`
- **New email template**: `src/lib/email-templates/lead-capture-alert.tsx`
- **Modified**: `supabase/functions/create-checkout/index.ts` (subscription mode)
- **Modified**: `supabase/functions/payments-webhook/index.ts` (subscription events + license table)
- **Modified**: `src/routes/_authenticated.dashboard.pricing.tsx` (new copy/tiers)
- **Modified**: `src/lib/portal.functions.ts` (Lead-Hook injection in HTML export)
- **Modified**: `src/components/portal/HudBuilderSandbox.tsx` (license guard)
- **Modified**: `src/lib/email-templates/registry.ts` (register new template)
- **Modified**: `supabase/config.toml` (add `handle-lead-capture` with `verify_jwt = false`)

