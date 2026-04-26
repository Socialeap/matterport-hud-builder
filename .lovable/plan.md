# Unify Property Intelligence + Property Docs into one section

## Why this is still split

A pass was made earlier, but it stopped halfway:

1. **`PropertyIntelligenceSection`** lives inside `EnhancementsSection` → "Property Intelligence (Ask AI)" accordion. This is the **active** ingest surface (file upload + URL paste + auto-template).
2. **`PropertyDocsPanel`** is *still* mounted inside `PropertyModelsSection.tsx` (line 243), rendered per-property card. This is a **second** full ingest surface (curated-template extraction + reindex + freeze). Both panels already share state via `usePropertyExtractions` + `useIndexing`, so the data is unified — but the **UI is not**.
3. **"Property Docs" accordion item** in `EnhancementsSection` is a stub `VaultCatalogList` that just lists provider-published docs and tells the user to scroll back up to Property Intelligence.

Net effect: clients see the same docs in **3 places** with confusing overlap, and the panel inside Property Models duplicates everything Property Intelligence already does.

## The fix: one section, two tabs

Replace the two separate accordion items ("Property Intelligence" and "Property Docs") with **one accordion item** called **"Property Intelligence & Docs"** (Wired). Inside it, a simple `Tabs` switch:

- **Tab 1 — Ask AI** (default): the existing `PropertyIntelligenceSection` UI — per-property rows with Upload / Paste URL / status pills. This is the "do something" tab.
- **Tab 2 — Provider Catalog**: the existing `VaultCatalogList category="property_doc"` — read-only list of docs the MSP has published. This is the "browse what's available" tab.

Both tabs scope to the same active property selected by the existing "Apply to:" tab bar above the accordion, so the mental model stays "pick a property → see/add its intelligence."

## Remove the duplicate inside Property Models

Delete the `<PropertyDocsPanel>` mount from `PropertyModelsSection.tsx`. All of its capabilities (upload, run extraction, reindex, delete, freeze badges, indexing status) already exist inside `PropertyIntelligenceSection`'s `ModelRow` — the unified Enhancements section becomes the single source of truth.

`PropertyDocsPanel.tsx` itself is left in the repo (not deleted) because `src/lib/portal.functions.ts` references a *different* server-side helper called `buildPropertyDocsPanel` for the generated end-product HTML — those are unrelated despite the name. We just stop importing the React component.

## Trigger-flow trace (safety check)

Before committing, mentally walk every place `PropertyDocsPanel` participates today:

1. **Indexing job kickoff** — driven by `usePropertyExtractions` → `useIndexing.request()`. Already triggered identically by `PropertyIntelligenceSection`'s `ModelRow`. Removing the duplicate panel cannot starve indexing, because the unified section still mounts `usePropertyExtractions(model.id)` for every property.
2. **`onExtractionSuccess` callback** — currently flows from `PropertyIntelligenceSection` up through `EnhancementsSection` to the builder (used to refresh saved-model state). `PropertyDocsPanel` does **not** call this callback, so removing it changes nothing on this wire.
3. **Freeze / LUS license gating** — both panels read `useLusFreeze` / `useLusLicense` independently. The Intelligence panel already renders the LUS-paused banner. Removing the Docs panel does not bypass any gate.
4. **Provider-vault picker ("pick existing doc + run template")** — this is the *one* feature only `PropertyDocsPanel` exposes today. Property Intelligence assumes upload-or-URL only. To avoid a regression for providers who curate templates, **add a third action** to each `ModelRow` in Property Intelligence: a small "From vault…" button that opens the existing picker dialog (vault doc × template) and calls the same `extract()` path. This preserves the curated-template workflow inside the unified section.
5. **End-product HTML generation** — server-side `buildPropertyDocsPanel` in `src/lib/portal.functions.ts` is untouched; it reads from `property_extractions` rows in the DB, which both ingest paths already write to.
6. **Indexing-status badge** — `IndexingStatusBadge` is rendered by both panels today; the unified section already renders it via the Intelligence rows, so visitors see no change.

## Technical changes (concise)

- `src/components/portal/EnhancementsSection.tsx`
  - Replace the two AccordionItems (`intelligence` + `docs`) with one item `intelligence-docs` containing a `Tabs` (`Ask AI` / `Provider Catalog`).
  - Inside Tab 1: `<PropertyIntelligenceSection ... />` (unchanged props).
  - Inside Tab 2: `<VaultCatalogList category="property_doc" emptyHint="Your provider hasn't published any property docs yet." />`.
  - Update intro copy to reflect the merge.
- `src/components/portal/PropertyModelsSection.tsx`
  - Remove `import { PropertyDocsPanel }` and the `<PropertyDocsPanel ... />` JSX block (lines 23 + 243-246). Leave everything else untouched.
- `src/components/portal/PropertyIntelligenceSection.tsx`
  - Add a "From vault…" action button next to each row's existing "Upload / URL" actions. Reuses the same picker UX as today's `PropertyDocsPanel` (vault doc + template selects → `extract({ vault_asset_id, template_id, saved_model_id })`).
  - Only render the button when `templates.length > 0` AND there is at least one provider-published `property_doc` (use `useAvailablePropertyDocs`).
  - All other rows / failure handling / busy-state code stays intact.
- No DB / RLS / edge-function changes. No changes to `usePropertyExtractions`, `IndexingProvider`, or the worker.

## Out of scope

- Deleting `PropertyDocsPanel.tsx` from disk (kept dormant; cheap revert path if a regression surfaces).
- Renaming the server-side `buildPropertyDocsPanel` helper.
- Any change to how the published tour renders the Ask AI panel.

## Verification after implementation

1. `tsc --noEmit` — confirm no broken imports after removing the panel mount.
2. Open a property in the builder → Enhancements → expand "Property Intelligence & Docs" → confirm both tabs render, Ask AI shows the per-property rows, Provider Catalog shows the published docs list.
3. Confirm the Property Models card no longer renders the second "Property Docs" subpanel.
4. Upload a doc via Ask AI → confirm extraction completes, indexing status flips ready, and the same row appears in the Provider Catalog tab (since it became a vault asset).
5. Paste a URL → confirm same path works.
6. With curated templates published by the provider, click "From vault…" → confirm the picker runs the curated-template extraction.
