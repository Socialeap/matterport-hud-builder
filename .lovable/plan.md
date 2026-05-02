# Streamline Vault → Property Mapper UX

## Goals
1. Rename the **Property Docs** tab → **Property Mapper** (label only — keep the underlying `property_doc` category enum so existing assets keep working).
2. Replace the current "Add Asset" → upload modal flow for Property Mapper with a single **3-card chooser modal** (Smart AI Blueprint / Pre-Built Template / Pro Developer Setup).
3. Remove the standalone "Property Mapper for AI Chat" intro card from the Vault page and the separate "Open Property Mapper" CTA — its messaging folds into the Smart AI Blueprint card description.
4. Each card opens the appropriate wizard step (the existing `WizardModal` machinery is reused so no logic is rewritten).

## Current state (verified)
- `src/routes/_authenticated.dashboard.vault.tsx` defines the `property_doc` category with label "Property Mapper" already (line 131) BUT the active-tab heading still derives from it, and the **+ Add Asset** button calls `openCreate()` which opens `AssetEditorDialog` (a generic file-upload form). For property docs this is the wrong destination.
- `PropertyDocArchitectCallout` (lines 906-967) is the current intro card linking to `/dashboard/vault/templates?architect=1`. To be removed.
- The mapper experience already lives at `/dashboard/vault/templates` (`_authenticated.dashboard.vault.templates.tsx`) and uses `WizardHub` (3 cards) + `WizardModal` (full wizard).
- `WizardHub` already supports both `compact` and rich flip-card modes; we'll reuse the rich mode inside the new chooser dialog.

## Changes

### A. `src/routes/_authenticated.dashboard.vault.tsx`
1. **Tab label** — update the user-facing label everywhere it's still "Property Docs". (Already says "Property Mapper" at line 131 — verify the page heading at lines 493-497 reads "Property Mapper" via `c.label`; no string change needed there. Also update the inline copy on line 446 and the toast/empty-state strings if they say "Property Docs".)
2. **Remove** the `PropertyDocArchitectCallout` render (line 488-490) and the function definition (lines 906-967). Also remove the now-unused `Sparkles`, `ArrowRight`, `FileJson`, `Wand2` imports if no longer used elsewhere on the page.
3. **Intercept `openCreate` for `property_doc`**: when `activeCategory.value === "property_doc"`, open the new `PropertyMapperChooserDialog` instead of `AssetEditorDialog`. All other categories keep their existing flow.
4. Add a small piece of state: `const [chooserOpen, setChooserOpen] = useState(false);`

### B. New component: `src/components/vault/PropertyMapperChooserDialog.tsx`
A small wrapper that:
- Renders a `<Dialog>` with `WizardHub` inside (rich/non-compact mode so the flip-cards & explainers appear — this is where the "Smart AI Blueprint" card now carries the educational copy that was in the removed intro card).
- Header copy adapted from the deleted intro: *"Property Mapper for AI Chat — Build a reusable map of facts your clients' AI Chat will pull from uploaded property documents. Pick how you want to start."*
- On `onPick(path)`:
  - Closes the chooser.
  - Opens the existing `WizardModal` directly on the same page, by lifting `draft`/`saving` state up (mirroring `_authenticated.dashboard.vault.templates.tsx`).
  - Wires `handleSave` to call `useVaultTemplates().create/update` (same hook as the templates route uses) so the result is persisted as a vault template, identical to what happens on the templates route.

This means MSPs no longer need to navigate to `/dashboard/vault/templates` to create a mapper — it all happens in-modal from the Vault tab. The `/dashboard/vault/templates` route remains accessible (unchanged) for the management list, but it's no longer surfaced as a separate primary entry from the Vault page.

### C. Smart AI Blueprint card copy enrichment
In `src/components/vault/wizard/WizardHub.tsx`, extend the `ai` card's `blurb` / `howItWorks` text to absorb the educational framing from the removed intro card ("Easily build a mapping template for each type or category of property — Offices, Hotels, Apartments, Galleries, Luxury Rentals — that your clients use to help the AI scan and convert their uploaded property data into real-world answers in the 'Ask AI' chat.").

### D. Cleanup
- Verify no other references to the removed `PropertyDocArchitectCallout` remain.
- The "Vault → Property Mapper" link inside `AssetEditorDialog` (lines 727-740) becomes dead code for property_doc since that dialog will no longer open for that category — leave the conditional in place (harmless) or remove the `category.value === "property_doc"` branch for tidiness.

## Out of scope
- The `/dashboard/vault/templates` route stays as-is for now (it remains the place to *manage* / edit / delete existing maps). If you'd later like to fully consolidate it into the Vault tab list (showing existing maps as asset cards under Property Mapper), that's a follow-up.
- No DB / RLS changes. `vault_templates` table and category enum unchanged.

## Files touched
- `src/routes/_authenticated.dashboard.vault.tsx` (remove intro card, intercept Add Asset for property_doc, mount chooser + wizard)
- `src/components/vault/PropertyMapperChooserDialog.tsx` (new)
- `src/components/vault/wizard/WizardHub.tsx` (enrich AI card copy)
