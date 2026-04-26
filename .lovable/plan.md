## What's actually happening (and why it looks broken)

I dug into the wizard wiring and the issue is **not** that the cloning is incomplete — `LibraryPath.pickStarter()` already copies the entire starter schema into the draft and jumps straight to the Review step. The user does **zero manual schema work**. They just confirm the name and click "Create Map".

The problem is **perception**, in three layers:

1. **The 2-field map in your screenshot is an old user template** (pre-existing under "My Templates"), not a starter clone. So it's a legacy data issue, not a wizard bug.
2. **The Review step hides the fields by default** (`fieldsOpen = false`), so even when 14 fields ARE pre-loaded, the user sees an empty-looking panel and assumes nothing happened.
3. **Today's starters carry only 14–16 fields**, which feels thin compared to what a real residential listing or hotel fact sheet contains.
4. **The copy "clone one of your own saved maps"** is jargon — both you and the end user have no idea what it means.

This plan fixes all four.

## The fix

### 1. Massively expand the 5 starter schemas (`src/lib/vault/starter-templates.ts`)

Each starter rewritten to be **30–40 fields**, exhaustively covering its document genre. Field types stay within the allowed `string | number | boolean | date` union; every field gets an extraction-grade `description`; `required[]` stays lean (3–5 truly mission-critical fields per template).

| Template | Today | Target |
|---|---|---|
| Residential Real Estate | 14 | ~36 |
| Hospitality / Boutique Hotel | 15 | ~38 |
| Commercial Office | 15 | ~36 |
| Multi-Family Housing | 16 | ~38 |
| Coworking / Flex Workspace | 14 | ~34 |

Field expansion hits things like: half-baths, basement type, roof age, HVAC, flood zone, listing agent, last sold date (residential); brand affiliation, ADR, occupancy rate, ballroom sqft, loyalty program, distance-to-airport (hospitality); building class, ceiling height, slab-to-slab, NNN charges, EV charging, transit score (office); unit-mix breakdown by bedroom, cap rate, price per unit, expense ratio (multi-family); workstation counts, day-pass price, podcast studio, member-app, transit-distance (coworking).

The card field-count badges will auto-update because they read `Object.keys(s.schema.properties).length` directly — no UI changes needed for that.

### 2. Make "ready to use" visually obvious in the Review step (`src/components/vault/wizard/steps/ReviewStep.tsx`)

Two small UX changes that remove all ambiguity:

- **Show the field list expanded by default** when the user arrived via the **library** or **pdf** paths (where fields are pre-detected). For `manual` and `ai` paths, keep it collapsed.
- **Add a green "Ready to save" callout** above the name input when the schema is valid and pre-populated, like:
  ```text
  ✓ 36 fields detected and ready to use. Just give your map a name below.
  ```
  This single line eliminates the "is anything happening?" feeling.

### 3. Replace confusing copy in the library picker (`src/components/vault/wizard/paths/LibraryPath.tsx`)

| Before | After |
|---|---|
| "Pick an industry standard or **clone one of your own saved maps**" | "Start from a pre-built industry template below — or copy and tweak one you've already saved." |
| Section: "Industry Standards" | "**Pre-Built Templates** *(recommended)*" |
| Section: "My Templates" | "**Your Saved Templates** — copy and rename" |
| Empty state: "You don't have any saved maps yet. Pick an Industry Standard above to get started." | "You haven't saved any templates yet. Pick a pre-built one above — it's the fastest way to start." |

Plus a small hint chip on each Industry Standard card: "Auto-fills [N] fields" so the user knows clicking the card does the work for them.

### 4. Reword the wizard hub card for the library path (`src/components/vault/wizard/WizardHub.tsx`)

Audit and make sure the card label and tagline say something like "Use a Pre-Built Template — Pick a ready-made map for your industry. Auto-fills 30+ fields. Recommended for most users." (Exact copy verified after I view the hub file in implementation.)

### 5. Final-step button copy stays "Create Map" but only the name field is required

The schema is already valid because it came from the starter. The user literally only types a name (or accepts the default like "Residential Property Map") and hits Create. That IS the wizard — fully automated, one-click after the picker.

## Files touched

- `src/lib/vault/starter-templates.ts` — full rewrite of all 5 schemas
- `src/components/vault/wizard/steps/ReviewStep.tsx` — auto-expand field list for library/pdf paths, add "Ready to save" callout
- `src/components/vault/wizard/paths/LibraryPath.tsx` — copy rewrite, section relabels, "Auto-fills N fields" hint
- `src/components/vault/wizard/WizardHub.tsx` — copy audit on the library card

## Files NOT touched

- Wizard navigation, modal shell, draft state, save handler, AdvancedSettings — all already work correctly.
- The user's pre-existing 2-field "Coworking Space" template stays untouched (their data, their choice). They can delete it manually and re-clone from the new richer starter if they want.

## Verification after the change

1. `tsc --noEmit` — every field uses an allowed type; `required[]` only references existing keys.
2. Open wizard → "Use a Pre-Built Template" → pick "Residential Real Estate" → land on Review step → see "✓ 36 fields ready to use" with the field list already expanded → type nothing (default name pre-filled) → click Create Map → done.
3. Reopen the saved map via Edit → confirm all 36 fields round-trip intact.

## Optional follow-up (not in this PR)

If you want a one-click "Reset to Pre-Built Template" action on existing user templates (so the legacy 2-field "Coworking Space" can be auto-upgraded), that's a small follow-up. Just say the word.