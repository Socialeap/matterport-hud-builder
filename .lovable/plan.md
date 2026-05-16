# Fix: "token issuance failed" on Presentation export

## Root cause (verified)

Server log from the failed export:

```
[generatePresentation] token mint failed despite env being set:
presentation-token: insert failed: Could not find the table
'public.presentation_tokens' in the schema cache
```

`select to_regclass('public.presentation_tokens')` returns NULL — the table is not in the live database.

The migration file `supabase/migrations/20260427000010_presentation_tokens.sql` already exists in the repo and defines the table, indexes, RLS, and service-only policies correctly, but it was never applied to this Cloud project. Every other piece of the pipeline is wired correctly:

- `src/lib/portal.functions.ts` (≈line 1335) reads `PRESENTATION_TOKEN_SECRET` + `SUPABASE_SERVICE_ROLE_KEY`, both present, then calls `ensurePresentationToken(model.id)`.
- `src/lib/presentation-token-server.ts` does `service.from('presentation_tokens').insert(...)` → fails because the relation is missing → throws → caller surfaces the friendly error.
- `supabase/functions/_shared/presentation-token.ts` reads from the same table at verify time (would also fail once tokens existed).

## Execution path traced

```
Builder → generatePresentation (serverFn)
   → ensurePresentationToken(savedModelId)
      → service.from('presentation_tokens').update(...).eq(...)   ← schema cache miss
      → service.from('presentation_tokens').insert(...).select()  ← never reached
   → throws "Ask AI couldn't be set up… token issuance failed."
```

After the table exists, the same path completes, the HMAC + sha256(hash) row inserts, the token value is folded into the exported HTML, and the visitor's Ask AI runtime can verify it via `synthesize-answer` (which reads the same table).

## Solutions considered

1. **Apply the existing migration as-is via a new migration call** — safest. The SQL is already idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) and the RLS policies use unique names. Re-running it on a project where it somehow partially landed will not error or duplicate. **Chosen.**
2. Drop and recreate the table — unnecessary and destructive. Rejected.
3. Skip token mint entirely (degrade to deterministic-only mode) — already happens when env is missing, but here env IS configured, so silently degrading would mask the bug and disable Ask AI synthesis on every export. Rejected.
4. Catch the schema-cache error in `presentation-token-server.ts` and degrade — hides the real fix and leaves Ask AI broken indefinitely. Rejected.

## Change set (single migration, no code changes)

Create `supabase/migrations/<new-timestamp>_presentation_tokens_apply.sql` containing the exact body of `20260427000010_presentation_tokens.sql`. Because every statement is `IF NOT EXISTS` / uniquely-named policy, this is a safe no-op on any environment that already has the table and a clean install on this one.

Specifically the migration will (re)assert:

- `public.presentation_tokens` table with PK + FK to `saved_models(id) ON DELETE CASCADE`
- partial indexes `presentation_tokens_model_active_idx` and `presentation_tokens_revoked_idx`
- `ENABLE ROW LEVEL SECURITY`
- four `service_only` policies (select/insert/update/delete all `false` for non-service callers)

No frontend, server-fn, or edge-function code is touched. The existing token issuer, verifier, and the parity test (`tests/presentation-token-parity.test.mjs`) already line up with this schema.

## Ripple-effect check

- **Builder export** — fixed; mint succeeds, `__PRESENTATION_TOKEN__` and `__SYNTHESIS_URL__` get injected, downloaded HTML works.
- **Visitor Ask AI** — `synthesize-answer` (`supabase/functions/synthesize-answer/index.ts`) calls `verifyPresentationToken`, which reads the new table via service role; previously would have 401-looped, now verifies cleanly.
- **RLS** — service-only policies; no client-readable surface, no data exposed.
- **Idempotency** — re-applying on a project that already has the table is a no-op (every DDL guarded).
- **Existing exports** — any HTML built before this fix shipped without a token (deterministic-only mode) and remains valid; no migration of stored data needed.
- **Tests** — none rely on the table being absent; `presentation-token-parity.test.mjs` only exercises the canonicalisation bytes.

## Verification after apply

1. `select to_regclass('public.presentation_tokens')` → returns `presentation_tokens`.
2. From the builder, click Download Presentation → file downloads, no error toast.
3. Worker logs show no `[generatePresentation] token mint failed` lines.
4. `select count(*) from public.presentation_tokens` increments by 1 per export.
5. Open the downloaded HTML, ask Ask AI a question → `synthesize-answer` returns 200 (token verifies).

---

# Addendum — Agent Profile as Presentation Starter Kit

(Full plan in chat; capturing scope here for the build queue.)

Promote `public.profiles` into a real **Agent Profile** page so the agent's
identity + preferences become a reusable seed for every new presentation.

## Scope
1. New route `/_authenticated/dashboard/profile` with sections:
   - Identity & Contact (display_name, title_role, company, phone, avatar, bio)
   - Voice & Messaging (default welcome note, saved welcome variants, AI persona tone, signature CTA)
   - Default Presentation Preferences (starter template, tour behavior, enhancement toggles, branding overrides for Pro, privacy mode, GA4 ID)
   - Reusable Property Brain (links to Vault templates the agent uses)
2. DB additions to `profiles`: `bio`, `signature_cta`, `ai_persona_tone`, `welcome_variants jsonb`, `presentation_defaults jsonb`, `default_starter_template`.
3. Server fns in `src/lib/agent-profile.functions.ts`: extend `getMyAgentProfile`, add `updateMyAgentProfile`, add `hydratePresentationFromProfile({ starterTemplate })`.
4. Builder hydration: replace hard-coded empty defaults with `hydratePresentationFromProfile`.
5. UI affordances: "Reset section to my profile defaults" links inside Agent / Branding / Enhancements sections.

## Builder Top-Right "Setup" Button (NEW)
Add a header control next to Import/Export on `/p/$slug/builder` so the
agent explicitly chooses the start mode for each new presentation:

- **Prefill from My Profile** — force-applies saved profile data to the
  Agent/Manager Contact form (overwrites current values).
- **Start Blank** — clears agent fields and disables auto-prefill, so the
  agent can immediately Import a `.3dps-draft.json` or hand-fill from scratch.

Implementation notes:
- Refactor existing auto-prefill `useEffect` into a callable
  `applyProfileToAgent({ force, notify })` so the button and the
  first-load auto-prefill share one code path.
- Add `handleClearAgentFields()` that resets to `DEFAULT_AGENT`, drops any
  staged avatar file, and sets `agentAutofilledRef.current = true` to
  prevent auto-prefill from clobbering the cleared state.
- Render a `DropdownMenu` (Sparkles / Eraser icons) — disabled "Prefill"
  item when no `userId`.
- Existing auto-prefill on first empty load is preserved (non-breaking).

## Out of scope (this addendum)
- Cloning a finished saved presentation as a template (handled by existing
  draft Export/Import for now).
- Per-agent profile presets beyond a single default set.
