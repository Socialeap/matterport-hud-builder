## Goal

Reorganize the Client Presentation Builder so every customization sourced from the MSP's Production Vault lives under a single new collapsible card called **Enhancements**. Inside, each Vault category is its own nested accordion. The user picks a property at the top, then toggles the assets that should apply to that property.

This pass is **phased**:
- ✅ **Wired now**: Property Intelligence (Property Docs), Sound Library (vault audio overrides per‑property music URL).
- 🟡 **UI present, runtime later**: Visual Portal Filters, Interactive Widgets, Custom Iconography, External Links — each shows the MSP's catalog with a "Coming soon" badge so the asset is visible but cannot be applied yet.

## UX layout (Builder, left column)

```text
[ Branding ]                       (existing)
[ Property Models ]                (existing)
[ Enhancements ]                   ← NEW collapsible card
   ┌───────────────────────────────────────────────┐
   │  Apply to: [ Tab: Property 1 ][ Property 2 ]… │  ← property tabs
   │                                               │
   │  ▸ Property Intelligence (Ask AI)             │  ← moved from outside
   │  ▸ Sound Library                              │  ← NEW, wired
   │  ▸ Property Docs (Floorplans, etc.)           │  ← already wired via Intelligence
   │  ▸ Visual Portal Filters     [Coming soon]    │  ← NEW, UI only
   │  ▸ Interactive Widgets       [Coming soon]    │  ← NEW, UI only
   │  ▸ Custom Iconography        [Coming soon]    │  ← NEW, UI only
   │  ▸ External Links            [Coming soon]    │  ← NEW, UI only
   └───────────────────────────────────────────────┘
[ Agent / Manager Contact ]        (existing)
```

- Empty state per category: "Your provider hasn't published any assets in this category yet."
- Each item row shows the asset's label, description, format chip, and a per-property toggle (or radio for Sound Library since only one ambient track plays at a time).

## Behaviour details

**Property tab bar**
- Reads from the same `models[]` already in `HudBuilderSandbox`.
- Tab label = `model.propertyName || model.name || "Property N"`.
- Selecting a tab scopes every nested category to that `model.id`.

**Sound Library (wired)**
- Lists `vault_assets` where `category_type='spatial_audio'` for the linked provider (RLS already permits clients to read their provider's active assets).
- Per-property single-select. Choosing an asset overrides `model.musicUrl` for that property; "None" clears it.
- Existing manual `musicUrl` text input in `PropertyModelsSection` stays as a fallback / advanced override; Sound Library selection wins when set.
- Persisted into the existing draft autosave (no schema change) and into `saved_models.tour_config.enhancements` on save.

**Property Intelligence (wired, moved)**
- The current `<PropertyIntelligenceSection>` is rendered unchanged inside the new accordion's "Property Intelligence (Ask AI)" sub-item. No prop or runtime changes.
- The wrapper passes the active property tab so the section opens on the correct property automatically.

**Property Docs (wired)**
- Read-only catalog of the provider's `property_doc` vault assets, with an indicator showing which are already extracted/applied to the active property (mirrors logic already in `PropertyIntelligenceSection`). Acts as a discovery surface — actual upload/extract continues through Property Intelligence to avoid duplication.

**Coming-soon categories**
- Render the catalog of MSP-published assets so clients can preview what's available.
- Each row shows a disabled "Apply to this property" control with a `Coming soon` badge and a tooltip: "Your provider has published this asset. Runtime support is rolling out — selections aren't applied to the tour yet."

## Persistence model (no DB migration this pass)

Add a new field to the existing `saved_models.tour_config` JSONB blob:

```json
{
  "enhancements": {
    "<propertyId>": {
      "spatial_audio": "<vault_asset_id|null>",
      "visual_hud_filter": ["<vault_asset_id>", ...],
      "interactive_widget": [...],
      "custom_iconography": [...],
      "external_link": [...]
    }
  }
}
```

- Read/write happens entirely client-side in `HudBuilderSandbox`.
- Draft autosave (`src/lib/portal/draft-storage.ts`) gains a parallel `enhancements` field — backwards compatible (older drafts simply have it `undefined`).
- `savePresentationRequest` already serializes the full state; `enhancements` rides along inside `tour_config`.

## Runtime wiring this pass (Sound Library only)

In `src/lib/portal.functions.ts` (and the corresponding generator that emits the standalone HTML), at the point where each property's `musicUrl` is resolved, pick in this order:
1. `enhancements[propertyId].spatial_audio` → resolve to the vault asset's `asset_url`.
2. Existing `model.musicUrl` text input.
3. None.

No changes to filter/widget/icon/link emission — those keys are written to `tour_config` but ignored by the generator.

## Files to add or change

**New**
- `src/components/portal/EnhancementsSection.tsx` — the outer accordion shell, property tab bar, and category dispatcher.
- `src/components/portal/enhancements/SoundLibraryPicker.tsx` — wired single-select per property.
- `src/components/portal/enhancements/VaultCatalogList.tsx` — generic read-only/disabled list reused by all "Coming soon" categories.
- `src/hooks/useVaultAssetsByCategory.ts` — typed query hook keyed by `(providerId, category_type)`.

**Modified**
- `src/components/portal/HudBuilderSandbox.tsx`
  - Move the `intelligence` AccordionItem out and replace it with one new `enhancements` AccordionItem hosting `<EnhancementsSection>`.
  - Add `enhancements` state + setter, thread into draft autosave and `savePresentationRequest`.
- `src/lib/portal/draft-storage.ts` — extend `DraftState` with optional `enhancements` field.
- `src/lib/portal.functions.ts` — read `tour_config.enhancements[propertyId].spatial_audio` and apply override before HTML generation.
- `src/components/portal/PropertyIntelligenceSection.tsx` — accept an optional `activePropertyId` prop so the moved section honours the parent tab; default behaviour unchanged when omitted.

**Untouched (intentional)**
- No database migration, no edge function changes, no changes to the generated tour runtime apart from the music-source resolver.
- `PropertyModelsSection` keeps its existing `musicUrl` input as the legacy fallback so already-saved draft files keep working.

## Safety / regression review (trigger trace)

1. **Existing drafts** load with `enhancements === undefined` → generator falls through to existing `model.musicUrl` path → unchanged output. ✅
2. **Existing saved_models** in DB have `tour_config` without `enhancements` → same fallthrough on regenerate. ✅
3. **Property Intelligence** keeps its own state, queries, and effects; only its mount location changes. The `extractionDirty` banner in `HudBuilderSandbox` continues to fire because the `onExtractionSuccess` callback is forwarded unchanged. ✅
4. **Pricing / checkout flow** depends on `models.filter(m => m.matterportId).length`, not on enhancements — no impact. ✅
5. **License / access guards** wrap the whole left column; the new section sits inside the same guard. ✅
6. **Coming-soon assets** never reach the generator (the generator simply ignores those keys), so MSPs can publish them safely without breaking client tours. ✅
7. **RLS** on `vault_assets` already permits clients to read active assets from their linked provider — the new picker uses that policy with no schema change. ✅

## What this plan deliberately does NOT do

- No runtime support yet for filters, widgets, icons, or links — surfaced as "Coming soon".
- No new DB tables, migrations, or edge functions.
- No changes to MSP-side Vault management UI.
- No changes to pricing logic.

Each "Coming soon" category will graduate to "wired" in a follow-up pass, one at a time, with its own runtime change and verification.
