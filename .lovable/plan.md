## Scope

Two things in this plan:
1. **The audit you asked for** — language realignment in the dashboard onboarding modal *and* a check that the codebase's mental model is internally consistent with how the Ask AI pipeline actually flows.
2. **A blocking build-error fix** — the build is currently failing on `extract-url-content` due to a TypeScript generics regression. Unrelated to your request, but it must be fixed in the same pass or nothing else ships.

---

## Audit findings

### Your premise vs the code — the nuance that matters

You said: *"Property Docs in the Production Vault are only used as TEMPLATES — the LLM identifies important property data types to create a JSON schema for indexing what the Client uploads."*

That's **exactly true for one path**, but the codebase has **two distinct concepts** that both currently get called "property docs," and that's the root of the confusion:

| Concept | DB location | Role in the Ask AI pipeline |
|---|---|---|
| **Vault Templates** (`vault_templates` table, edited at `/dashboard/vault/templates`) | One row per JSON Schema | Pure schema. Optionally seeded by uploading a sample PDF that runs through `induce-schema` (GPT-4o-mini) to *infer* a JSON Schema. The PDF itself is **discarded** — only the resulting schema is saved. **Never read by Ask AI.** ← This is what you're describing. |
| **Vault Property Docs** (`vault_assets` rows where `category_type='property_doc'`) | One row per uploaded PDF, per provider | Real per-property documents. Extracted by `extract-property-doc` against a chosen template, which produces `fields` + `chunks` in `property_extractions`. The **chunks ARE embedded and DO feed Ask AI** for that specific property. |

So the modal step #4 — *"For property docs, the AI assistant reads them to answer buyer questions"* — isn't entirely wrong; it's just dangerously ambiguous. It refers to category #2 (per-property doc uploads), but a reader who's just been told to "stock the vault" naturally interprets it as the global vault uploads (which is mostly category #1 in the Templates page). The two surfaces are bleeding into each other in the user's head, exactly as you suspected.

### Pipeline congruence — verdict: mostly congruent, one true ambiguity

Going layer by layer:

- **`vault_templates` table** → schema only. ✅ Matches your model.
- **`induce-schema` edge function** → reads sample PDF text, returns a JSON Schema, **does not** persist or index the sample PDF. ✅ Matches your model.
- **`vault_assets` (`property_doc` category)** → real per-property docs that ARE indexed. This contradicts the pure "template-only" framing — these uploads **are** read by the AI. **This is the real source of confusion.**
- **`extract-property-doc`** → applies the chosen template's schema to the uploaded property doc, persists `fields` + `chunks` to `property_extractions`. Chunks then get embedded by the worker and used by Ask AI. ✅ Internally consistent.
- **`extract-url-content`** → same pattern but for URLs; auto-generates a per-host template if none chosen.
- **Ask AI runtime (`portal.functions.ts`)** → reads `property_extractions.chunks` + `canonical_qas` + `fields`. Never touches `vault_templates` directly at runtime.

So the data flow is correct and self-consistent. **The bug is purely a labeling/wording bug** that has propagated across three surfaces and one bullet list. No code refactor is needed; we need to clarify the language so what the UI says matches what the pipeline does.

---

## What needs to change

### 1. Fix the inaccurate / ambiguous wording (the actual ask)

**`src/routes/_authenticated.dashboard.index.tsx`** (the "Stock Your Vault" card and its modal — lines 178–198):

- Bullet (line 183): *"Add property docs for AI to read"* → *"Add property doc samples to teach the AI what fields to extract"*
- Modal step #4 (line 196): *"For property docs, the AI assistant reads them to answer buyer questions."* → *"For property doc samples, the AI learns the field structure (e.g. price, beds, year built) so it knows what to extract from your clients' future uploads."*
- Modal step #3 (line 195): *"Your clients can now drop it into any tour they build."* — keep, but for the property-docs case it doesn't apply (clients don't drop *templates* into tours). Add a brief clarifier: *"(non-template assets only — templates work behind the scenes)"*.

### 2. Tighten the Templates page copy so it says what it actually does

**`src/routes/_authenticated.dashboard.vault.templates.tsx`**:

- Line 165–168 subtitle: rephrase from *"Define what gets extracted from each property doc kind"* → *"Define the field schema (price, address, beds, etc.) the AI uses when extracting data from your clients' property doc uploads. Templates are schema-only — they aren't read at runtime."*
- Line 416–419 dialog description: add a one-liner that distinguishes "the sample PDF you upload here is used only to **induce** the schema; it's not stored or read by Ask AI."

### 3. Tighten the Vault index page copy

**`src/routes/_authenticated.dashboard.vault.tsx`** line 463: *"Define what gets extracted from each uploaded doc"* → *"Define the schema your clients' property docs are extracted against."*

### 4. (Optional but recommended) Add a small inline disambiguation badge

In the dashboard "Stock Your Vault" card, the bullets currently mix Pro features (audio, widgets, icons) with property docs/templates. The latter two go to **different pages** with **different roles**. Adding an explicit two-row mini-CTA inside the modal — *"Want reusable assets? Open Vault. Want to teach the AI a new doc type? Open Templates."* — costs nothing and removes the ambiguity at its source.

### 5. Fix the blocking build errors in `extract-url-content`

The current build fails with 5 TS errors all in `supabase/functions/extract-url-content/index.ts`:

```
TS2339: Property 'id' does not exist on type 'never'  (line 405, 427)
TS2769: No overload matches this call  (line 413)
TS2345: SupabaseClient ... not assignable to ...  (line 570)
```

Root cause: `ensureUrlTemplate(serviceClient: ReturnType<typeof createClient>, ...)` — the bare `ReturnType<typeof createClient>` collapses Supabase's generated row types to `never`, so `.from("vault_templates").insert({...})` and `.select("id")` are typed as `never` and refuse the call.

Fix: type the parameter as `SupabaseClient` from `@supabase/supabase-js@2.103.0` instead of relying on `ReturnType`, or change the function to use the local closure (which already has the correctly-typed `serviceClient`) by inlining the helper or accepting `serviceClient: any` in this single helper. Cleanest is the explicit `SupabaseClient` import:

```typescript
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
async function ensureUrlTemplate(
  serviceClient: SupabaseClient,
  providerId: string,
  hostname: string,
): Promise<string | null> { ... }
```

This also resolves the line-570 mismatch where the typed-`never` client was being passed back in.

---

## Files touched

- **edit** `src/routes/_authenticated.dashboard.index.tsx` — copy changes in "Stock Your Vault" card bullets + modal steps.
- **edit** `src/routes/_authenticated.dashboard.vault.templates.tsx` — page subtitle + dialog description copy.
- **edit** `src/routes/_authenticated.dashboard.vault.tsx` — line-463 micro-copy.
- **edit** `supabase/functions/extract-url-content/index.ts` — type the `ensureUrlTemplate` parameter as `SupabaseClient` to clear all 5 TS errors.

## What this plan does NOT do

- **No data model changes.** `vault_templates` and `vault_assets` stay as-is.
- **No pipeline changes.** Extraction, embedding, Ask AI all unchanged.
- **No new features.** Pure clarification + a build-fix.
- **No removal of the per-property doc upload path.** It's legitimate and correctly indexed — only the words around it change.

## Verification checklist

1. Open `/dashboard` → "Stock Your Vault" → "How does this work?" modal: step 4 now correctly explains the schema-induction role, with no implication that the AI reads the sample PDF at runtime.
2. Open `/dashboard/vault/templates`: the subtitle and "New Template" dialog clearly say templates are schema-only and the sample PDF is used only to induce the schema.
3. Open `/dashboard/vault`: the small Templates teaser card uses the new wording.
4. `bun run build` (or the platform's typecheck) succeeds — the 5 TS errors in `extract-url-content` are gone.
5. Existing extraction flows (PDF and URL) still produce `property_extractions` rows correctly — this is a pure type fix, no runtime behavior changes.
