## Problem

BYOK is currently a **MSP/provider** feature:
- `AskAiByokSection` is rendered on `/dashboard/account` (MSP-only via `!isClient`).
- The DB schema (`provider_byok_keys`) is keyed by `provider_id`, with one key shared across **every** presentation that provider has.
- `synthesize-answer` looks up BYOK by `saved_models.provider_id` (the MSP).
- `set_provider_byok_active` flips `byok_active` for **every** counter under that MSP.
- `ask-quota-exhausted` email goes to the **MSP's email** (looked up via `auth.admin.getUserById(model.provider_id)`).

You want the opposite: BYOK belongs to the **Client** (the person building a specific presentation), the 20 free answers are funded by you (developer) per-presentation, and after that the **client** is prompted to add their key. The MSP should never see BYOK UI.

## Architectural Decision

Two reasonable scopes for the client's BYOK key:

1. **Per-client** (one key, applies to all presentations the client owns): simpler, mirrors the existing per-provider model.
2. **Per-presentation / per-saved_model** (one key per published tour): finer-grained, but a client with multiple properties would have to re-enter the same key.

**Recommendation: per-client**, keyed by `auth.uid()` of the client (the builder owner), not by MSP. Quota counters remain per-`(saved_model, property)` and flip when the client's key validates. This is the smallest, safest change and matches user intent ("the Client adds their own Gemini API key").

If you'd rather have per-presentation scoping, say so before approval and I'll adjust step 2's schema.

## Plan

### 1. Move the UI from MSP account → Client builder

- Remove `<AskAiByokSection />` from `src/routes/_authenticated.dashboard.account.tsx` (and unused import).
- Create `src/components/portal/AskAiClientByokSection.tsx` — a client-facing variant of the existing component:
  - Same validate / save / remove / fingerprint / status flow.
  - Customer-facing copy aimed at the **client / property owner**, not the MSP.
  - Reuses `read_byok_status` / `validate-byok` (both already auth-scoped to `auth.uid()`).
- Mount it in the Builder **inside the Property Intelligence area**. Property Intelligence is rendered by `EnhancementsSection.tsx` (line 173). Add the BYOK panel there as a sibling block under the same accordion item, with a clear heading like "Visitor Ask AI — your Gemini key (optional)" and an explainer:
  > The first 20 visitor questions per property are funded by Transcendence Media. Add your own Gemini key here to lift that cap. The key stays encrypted and is only used to answer questions about *your* properties.
- Gate visibility: only render when `viewerRole === "client"` (already computed in `HudBuilderSandbox`) — pass it down to `EnhancementsSection`. MSPs/admins viewing a builder will not see the section.

### 2. Re-key BYOK from provider → client (DB migration)

New migration `supabase/migrations/<ts>_byok_client_scope.sql`:

- Add `client_byok_keys` table with the **same shape** as `provider_byok_keys`, but `client_id uuid NOT NULL REFERENCES auth.users(id)` and `UNIQUE (client_id, vendor)`. Same RLS lockdown (all policies `USING (false)` — accessor only via security-definer RPC).
- Replace `read_byok_status(p_vendor)` to read from `client_byok_keys` keyed on `auth.uid()`.
- Replace `set_provider_byok_active(p_provider_id, p_active)` with `set_client_byok_active(p_client_id, p_active)` that flips `byok_active` on the **specific saved_models that belong to that client** (resolved through `branding_settings → provider_id` and the client's `client_providers` link, OR via a new `saved_models.client_id` if available — see schema check below).
- Keep `provider_byok_keys` for now (deprecated, not deleted) so we don't lose any data; mark unused with a comment. No reads will hit it after the migration.

Schema verification step (read-only, no migration risk): confirm whether `saved_models` has a column linking to the client/builder owner. If not, the migration adds a helper view that resolves "client owns this saved_model" via `client_providers`. I will check this in the build phase before writing the migration so it matches reality.

### 3. Update edge functions

- `validate-byok/index.ts`:
  - Write to `client_byok_keys` with `client_id = userId`.
  - Call `set_client_byok_active(p_client_id: userId, …)`.
  - DELETE branch: same swap.
- `synthesize-answer/index.ts`:
  - Resolve the **client** for the saved_model (via the client→saved_model link confirmed in step 2), not `model.provider_id`.
  - Look up `client_byok_keys` instead of `provider_byok_keys`. Fall back to TM key when none active. Behavior of quota counters and `outcome='byok'` is unchanged.

### 4. Re-target the exhaustion email to the Client

In `synthesize-answer`'s `enqueueExhaustionEmail`:

- Instead of resolving the MSP's email via `auth.admin.getUserById(model.provider_id)`, resolve the **client owner** of the saved_model.
- `agentName` → client's `display_name`.
- `byokSetupUrl` → the **client's builder page** for this presentation (e.g. `https://3dps.transcendencemedia.com/p/{slug}/builder#ask-ai-byok`) instead of `/dashboard/account`. The builder page already exists at `/p/$slug/builder`; we add an anchor or query param the new component scrolls to.
- Update `src/lib/email-templates/ask-quota-exhausted.tsx` copy:
  - Subject: "Your free Ask AI answers for {propertyName} are about to run out" (or similar).
  - Body: addressed to the client / property owner, not "Agent". Explain: "The 20 free Gemini-powered answers for this presentation have been used. Add your own Gemini API key in the Builder to keep Ask AI running for visitors."
  - CTA button label: "Add my Gemini key" → `byokSetupUrl`.
  - Update `previewData` accordingly.

### 5. Add an "about to finish" warning email (NEW)

You asked for an alert "before" the 20-answer subsidy runs out, not just at exhaustion. Add a one-shot warning at a low remaining count (default: **3 remaining**):

- Migration: extend `ask_quota_counters` with `warning_email_sent_at timestamptz`.
- Add RPC `claim_ask_warning_email(saved_model_id, property_uuid)` mirroring the existing `claim_ask_exhaustion_email` pattern (atomic UPDATE … WHERE warning_email_sent_at IS NULL RETURNING …).
- In `synthesize-answer`, after a `counted` outcome, if `remaining <= 3` and `warning_email_sent_at IS NULL` and BYOK not active, claim and enqueue a new template `ask-quota-warning`.
- New email template `src/lib/email-templates/ask-quota-warning.tsx` cloned from `ask-quota-exhausted` with appropriate copy ("3 free Ask AI answers left for {propertyName}"). Register it in `registry.ts`.

### 6. Cleanup / regression sweep

- Update `pricing-copy.ts` so the BYOK copy is client-facing.
- Search the codebase for stale "MSP" / "provider" references to BYOK in user-visible strings and update to "your Gemini key" / "client" wording.
- Keep `provider_byok_keys` table + edge function code paths as a deprecated fallback for one release (read-only) so any in-flight requests don't 500. After verifying no reads, remove in a follow-up.

## Files Touched

```text
DELETE/REMOVE
  src/routes/_authenticated.dashboard.account.tsx       (remove <AskAiByokSection/> + import)

NEW
  src/components/portal/AskAiClientByokSection.tsx
  src/lib/email-templates/ask-quota-warning.tsx
  supabase/migrations/<ts>_byok_client_scope.sql

EDIT
  src/components/portal/EnhancementsSection.tsx         (mount client BYOK panel under Property Intelligence)
  src/components/portal/HudBuilderSandbox.tsx           (pass viewerRole down)
  src/lib/email-templates/ask-quota-exhausted.tsx       (rewrite for client audience)
  src/lib/email-templates/registry.ts                   (register warning template)
  src/lib/pricing-copy.ts                               (client-facing copy)
  supabase/functions/validate-byok/index.ts             (client_byok_keys + set_client_byok_active)
  supabase/functions/synthesize-answer/index.ts         (client lookup, warning email, exhaustion email recipient + URL)
  supabase/functions/_shared/byok-crypto.ts             (no functional change; comment refresh only)
  src/components/dashboard/AskAiByokSection.tsx         (DELETE after confirming no other importers)
```

## Risk & Mitigation

- **Migration safety**: New table + new RPCs, leave old table intact. Edge functions switch atomically when redeployed. If anything regresses, rolling back the edge function deploy reverts behavior.
- **Existing keys**: No production MSPs are affected because the per-MSP key never matched the new client-scoped flow. We don't migrate data; clients re-enter their key from the builder. We can optionally surface a one-time toast on the MSP account page explaining the move.
- **Quota counters**: Already keyed `(saved_model_id, property_uuid)` — no schema change needed for the activation flip; only the source of `client_id` changes.
- **Email blast risk**: The warning email is gated by `warning_email_sent_at` UNIQUE-claim, identical to the exhaustion claim, so no duplicate sends even under concurrent retries.
- **Builder visibility**: BYOK panel renders only when `viewerRole === "client"`, so MSPs previewing a client's builder do not see it.

After approval I'll verify the saved_models→client linkage in the live schema before writing the migration, so the join is real and not assumed.