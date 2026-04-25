## Problem (re-stated)

The Builder currently surfaces two disjointed accordions — **Property Intelligence (Ask AI)** and **Property Docs** — that are actually two halves of one pipeline. Worse, the **Mapper authoring surface** (the AI Architect that generates a JSON-Schema mapper from a property-class description, plus the manual JSON editor and PDF auto-induce) lives on an entirely separate page (`/dashboard/vault/templates`) and is invisible from the Builder.

The full pipeline that needs to be cohesive in the new "AI Chat (Ask AI)" section is:

```text
                    ┌───────────────────────────┐
                    │ 0. Mapper (the blueprint) │
                    │   • AI Architect (2-turn) │  ← class-of-property → fields
                    │   • Auto-induce from PDF  │
                    │   • Manual JSON editor    │
                    └─────────────┬─────────────┘
                                  │ chosen / created by MSP
                                  ▼
        ┌─────────────────┐   ┌──────────────┐   ┌──────────────────┐
        │ 1. Source Doc   │ → │ 2. Extract & │ → │ 3. Ready for     │
        │ (PDF/DOCX/URL)  │   │   Index      │   │ visitor "Ask AI" │
        └─────────────────┘   └──────────────┘   └──────────────────┘
```

The "long redundant list" the user sees in *Property Docs* today is the **catalog of every uploaded `vault_assets.property_doc` row**, with auto-generated names like `www.sleepermagazine.com` (URL hostname) — not Mappers. That confusion is the core UX failure to fix.

The unresponsive **"Open Property Mapper"** / **"Manage existing mappers"** buttons on the MSP Vault page also need a hardened fix.

---

## Goals

1. Collapse Property Intelligence + Property Docs + the now-hidden Mapper authoring surface into **one unified "AI Chat (Ask AI)"** section in the Builder, with a clear 3-step pipeline.
2. Make the **AI-assisted Architect** a first-class option *inside* that unified section — the MSP can describe a property class and finalize a Mapper without leaving the Builder.
3. Give every Mapper a **human Mapper Name** ("Hotel Resort", "Boutique Hotel") that's required at creation, separate from the technical `label` and the source filename.
4. Stop polluting the MSP Mapper picker with internally auto-generated host templates (`Auto: www.sleepermagazine.com`, etc.).
5. Fix the unresponsive Vault → Property Docs callout buttons.

---

## Plan

### 1. Database — extend `vault_templates`

Single migration:
- `display_name text` — the human-readable Mapper name. Backfilled from `label`.
- `is_internal boolean default false` — flags per-host auto-templates created server-side. Backfilled `true` where `label LIKE 'Auto: %'`.

Both columns are nullable/defaulted so existing rows survive. RLS policies stay intact.

### 2. Mapper Name everywhere it's authored

- **`useVaultTemplates` / `useAvailableTemplates`**: select & write `display_name`, `is_internal`. MSP-facing lists filter `is_internal = false`. Client-facing list keeps showing every active mapper (clients only see their MSP's curated mappers anyway).
- **`provider.ts` `VaultTemplate` type**: extend with `display_name?: string`, `is_internal?: boolean`.
- **Templates page (`vault.templates.tsx`)**: add a required **Mapper Name** input at top of the editor dialog. Demote existing `Label` to *"Technical label (advanced — defaults to Mapper Name)"*. `TemplateCard` shows `display_name` prominently with `doc_kind` as subtitle.
- **`TemplateArchitect.tsx`**: when the user finalizes the Architect schema, derive a default `display_name` suggestion from the property-class description (first ~50 chars, title-cased). It's pre-filled but editable.

### 3. Server-side auto-template hygiene

- **`supabase/functions/extract-url-content/index.ts`** (`Auto: ${hostname}` insert): set `is_internal = true`.
- **`PropertyIntelligenceSection.ensureAutoTemplate`** (walk-in upload path): set `is_internal = true`.

Net effect: those rows continue to power existing extractions but disappear from MSP Mapper pickers and from the new unified section's mapper dropdown.

### 4. Builder — unified "AI Chat (Ask AI)" section

In `EnhancementsSection.tsx`, replace the two top accordion items (`intelligence` + `docs`) with **one** AccordionItem: **"AI Chat — Ask AI"** (`Wired` badge). Inside, render a tabbed body so the full pipeline lives in one place:

**Tab A — Mappers (blueprints)** *(MSP-only; hidden for client-only sessions via role check)*

A consolidated mini-surface that exposes the same authoring power as the Templates page, including the Architect:

- **Active Mapper picker** (per-property): a `<select>` of the MSP's `display_name` mappers. Defaults to the MSP's most recent active mapper.
- **"+ New Mapper"** button → opens a dialog that embeds three options as tabs:
  1. **AI Architect** *(default + recommended)* — embeds the existing `<TemplateArchitect>` two-turn flow with the class-of-property prompt and Source-of-Truth tuning. On finalize, requires Mapper Name, creates the row, and auto-selects it for the active property.
  2. **Auto-induce from PDF** — embeds the existing `SchemaInductionSection` (re-exported from the templates page or lifted into `src/components/vault/`).
  3. **Manual JSON** — embeds the existing JSON `<Textarea>` with the same validation as the templates page.
- **"Manage all mappers →"** link to `/dashboard/vault/templates` for the heavyweight surface (delete, version, edit existing).

To avoid duplication, refactor:
- Lift `SchemaInductionSection`, `DryRunSection`, and the editor dialog body from `vault.templates.tsx` into `src/components/vault/` so both the Templates page and the new in-Builder dialog import the same components. `TemplateArchitect` is already standalone.

**Tab B — Source Docs** *(MSP and client)*

Per-property list. Each row shows:
- Filename / URL.
- Status chip: `Indexed (N chunks)` / `Pending` / `Failed`.
- The Mapper used (joined `property_extractions.template_id` → `vault_templates.display_name`). Click to view fields extracted.
- Re-index, delete actions.

Top-of-tab action: **Upload doc / Paste URL** (the existing PropertyIntelligenceSection upload dialog, extended with a Mapper picker pre-filled from Tab A's selection).

**Tab C — Visitor Q&A preview** *(read-only)*

Shows the canonical questions the visitor will be able to ask, derived from the indexed extractions for the selected property (uses the existing `canonical_qas` jsonb on `property_extractions`). Gives the MSP/client a confidence check before publishing.

### 5. Remove the now-redundant catalog

- Drop the global `<VaultCatalogList category="property_doc">` from EnhancementsSection. The "long redundant list" was that block.
- Remove `<PropertyDocsPanel>` rendering from `PropertyModelsSection.tsx` (line ~243). All extraction UX moves into the new AI Chat section. `PropertyDocsPanel.tsx` itself stays for the LUS-paused read-only fallback.

### 6. Fix the unresponsive Vault → Property Docs buttons

In `PropertyDocArchitectCallout`:
- Add `type="button"` to both controls.
- Wrap onClick with `e.preventDefault(); e.stopPropagation()` before `navigate(...)`.
- In `vault.templates.tsx`, reorder the `architect=1` `useEffect`: open editor first via `setEditor`, *then* clear the search param via `requestAnimationFrame` so URL update doesn't clobber the dialog state.
- Add a single `console.debug` + `toast.message("Opening Property Mapper…")` for visible signal.

### 7. Verification

- Migration applied; `useAvailableTemplates` excludes `is_internal=true`.
- From Builder → Enhancements → AI Chat: all three tabs work; MSP can create a Mapper end-to-end via Architect without leaving the Builder; new mapper appears in the per-property picker immediately.
- From MSP Vault → Property Docs tab: both buttons reliably open the Architect dialog from any starting state.
- `bun x tsc --noEmit` clean.
- No regression in existing extractions (auto-host templates still resolve for older `property_extractions` rows).

---

## Files touched

**New / lifted shared components**
- `src/components/vault/SchemaInductionSection.tsx` (lifted from templates route)
- `src/components/vault/DryRunSection.tsx` (lifted)
- `src/components/vault/MapperEditorDialog.tsx` (new — wraps Architect + Induce + Manual JSON tabs, used by both Templates page and Builder)

**Edited**
- New SQL migration: `vault_templates` adds `display_name`, `is_internal` + backfill.
- `src/lib/extraction/provider.ts` — type extension.
- `src/hooks/useVaultTemplates.ts`, `src/hooks/useAvailableTemplates.ts` — read/write new columns; MSP filter.
- `src/components/vault/TemplateArchitect.tsx` — emit suggested `display_name` on finalize.
- `src/routes/_authenticated.dashboard.vault.templates.tsx` — Mapper Name field, use lifted components, render `display_name` on cards, hardened auto-open effect.
- `src/routes/_authenticated.dashboard.vault.tsx` — `PropertyDocArchitectCallout` event hardening.
- `supabase/functions/extract-url-content/index.ts` — `is_internal = true` on auto inserts.
- `src/components/portal/PropertyIntelligenceSection.tsx` — `ensureAutoTemplate` flags `is_internal = true`; row UI shows mapper `display_name`.
- `src/components/portal/EnhancementsSection.tsx` — collapse to single AI Chat accordion with the three tabs.
- `src/components/portal/PropertyModelsSection.tsx` — remove inner `<PropertyDocsPanel>` mount.

No data destroyed. Auto-host templates keep functioning but disappear from MSP-facing pickers.
