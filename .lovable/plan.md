## Problem

1. **New mappers don't appear in the list.** The wizard saves to the `vault_templates` table, but the Property Mapper tab renders rows from `vault_assets`. The two never meet, so the new "Gallery/Exhibit" map is saved successfully but is invisible.
2. **Old "Add Property Mapper" modal still opens.** The intercept in `openCreate()` exists but the legacy `AssetEditorDialog` is always mounted in the tree and the legacy property-doc upload flow remains as a fallback path. We need to make the chooser the *only* possible entry point for the Property Mapper tab.

## Fix

### File: `src/routes/_authenticated.dashboard.vault.tsx`

1. **Render templates, not assets, on the Property Mapper tab.**
   - Read `templates` from the existing `useVaultTemplates()` hook (already imported).
   - In the tab body for `property_doc`, replace the `vault_assets` grid with a list of `vault_templates` rows.
   - Reuse the existing `AssetCard` visual pattern but bind to template fields (`label`, `doc_kind`, field count from `field_schema.properties`).
   - Wire each card's actions to template operations:
     - **Edit** → seed `mapperDraft` with existing template values (id, label, doc_kind, extractor, schema_text serialized from `field_schema`) and open `WizardModal` directly on the final "Name & Save" step.
     - **Delete** → call `useVaultTemplates().remove(id)` (with a confirm).
     - **Toggle Available** → call `useVaultTemplates().update(id, { is_active: next })`.
   - Use the asset-count badge on the tab trigger from `templates.length` for the property_doc tab (and `assetsByCategory[c.value].length` for all others).
   - Show the existing empty-state with a CTA that opens the chooser when there are no templates yet.

2. **Harden the Add Asset interception.**
   - Keep the existing early-return in `openCreate()` for `property_doc` → `setChooserOpen(true)`.
   - Additionally, in the rendered tab body, when the active category is `property_doc`, render the templates list path *exclusively*, never falling back to `EmptyState`'s default add path that goes through the legacy editor — point its `onAdd` to `setChooserOpen(true)`.
   - Guard the legacy `<AssetEditorDialog>` so it can never open while `activeTab === "property_doc"`: change its `open` prop to `editorOpen && !isStarter && activeTab !== "property_doc"`. This prevents any race where the legacy dialog could appear for the Property Mapper tab.
   - Remove the now-obsolete `property_doc` info banner inside `AssetEditorDialog` (lines 778–791) since users will never reach it for that category.

3. **Migration of existing legacy `vault_assets` rows of `category_type = 'property_doc'` (e.g. "Hotel Sample", "Sample 1422 Heritage Oak Court").**
   - These were uploaded under the previous "Property Docs" flow and are not Property Maps. Two safe options — recommend option A:
     - **A. Leave them in the database, hide from the Property Mapper tab.** The Property Mapper tab now shows templates only. The legacy rows remain accessible via the database for safety; we can add a one-time "Legacy Property Docs" subsection later if needed.
     - **B. Surface them in a small "Uploaded property documents (legacy)" sub-section under the templates list, read-only with a Delete action.**
   - We will go with **A** unless the user prefers B. No data is destroyed.

### Files

- `src/routes/_authenticated.dashboard.vault.tsx` — list/edit/delete/toggle wiring for templates on the Property Mapper tab; harden modal guards.

No DB migration. No changes to the wizard, the chooser dialog, or `useVaultTemplates`.

## Verification

After the change:
- Clicking "Add Asset" on the Property Mapper tab opens the 3-card chooser, never the legacy dialog.
- Completing the wizard for "Gallery/Exhibit" causes the new map to appear immediately in the Property Mapper tab list (refresh comes from `useVaultTemplates.refresh()` already called in `create`).
- Edit / Delete / Available toggle on a template card update `vault_templates` and reflect in the list.
- All other tabs (Sound Library, Visual Portal Filters, etc.) continue to use `vault_assets` unchanged.
