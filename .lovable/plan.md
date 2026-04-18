

## Plan: LUS Terminology Fix + Admin Account Provisioning

### Findings

**1. LUS terminology**
The incorrect expansion `"Lifetime Upgrade Service"` appears in **exactly one user-facing location**:
- `src/routes/_authenticated.dashboard.demo.tsx:317` — the publish-gate amber banner
All other references (hooks, server fns, comments, edge functions) already say `"License for Upkeep Services"` or just `"LUS"`.

**2. Admin account state**
- `shakoure@transcendencemedia.com` exists (user_id `a3d9b1d1-326d-405d-bceb-a980bebd77b6`)
- Has `provider` role ✓
- Has **no row in `licenses`** → `useLusLicense().isActive` returns `false` for this account today

**3. Preview vs Published — important clarification**
The preview URL (`id-preview--...lovable.app`) and published URL (`matterport-hud-builder.lovable.app`) **already share the same Lovable Cloud database**. Any change made while signed in on the preview is a real change to the same `licenses`, `sandbox_demos`, `branding_settings`, etc. tables that the published site reads.

So there's nothing to "bridge" environment-wise — once the admin has a license row, edits on preview will already persist and be visible on the published site under the same account. The only environment-flagged data is Stripe `purchases.environment` (`sandbox` vs `live`), which is irrelevant to LUS gating.

### Changes

**A. Fix the user-facing string** (1 file)
- `src/routes/_authenticated.dashboard.demo.tsx:317`
  - From: `Publishing requires an active LUS (Lifetime Upgrade Service) license.`
  - To: `Publishing requires an active LUS (License for Upkeep Services) license.`

**B. Provision the admin's permanent LUS license** (1 SQL insert via the data-mutation tool)
Insert a row into `public.licenses` for user `a3d9b1d1-326d-405d-bceb-a980bebd77b6`:
```sql
INSERT INTO public.licenses (user_id, tier, license_status, license_expiry)
VALUES ('a3d9b1d1-326d-405d-bceb-a980bebd77b6', 'pro', 'active', NULL)
ON CONFLICT (user_id) DO UPDATE SET
  license_status = 'active', license_expiry = NULL, tier = 'pro';
```
- `license_expiry = NULL` → never expires (matches `useLusLicense.isActive` logic which treats null expiry as "no expiry")
- `tier = 'pro'` → unlocks Pro-tier features
- Also satisfies the `_authenticated.dashboard.tsx` purchase gate (any license row passes)

If the table lacks a UNIQUE constraint on `user_id`, I'll do a guarded `INSERT … WHERE NOT EXISTS` instead.

**C. Confirm no admin role exists, optionally add one**
The account has only `provider`. The `app_role` enum includes `admin`. I'll add an `admin` role row as well so any future admin-only routes/RPCs (e.g. `has_role(uid, 'admin')` checks in RLS policies) treat shakoure as admin.

### What this does NOT change
- No code change to allow a "preview-only" override — unnecessary, since preview already writes to the live DB under the same auth.
- No change to LUS gating logic anywhere; we're just giving the admin a real license row.
- No `LUS` references in comments/docs need updating — they're already correct.

### Files touched
- `src/routes/_authenticated.dashboard.demo.tsx` — one-line copy fix
- One data migration (insert into `licenses` + `user_roles` for admin)

