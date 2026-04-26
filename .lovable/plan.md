I understand the disconnect. The process currently looks like it selected a rich 42-field starter, but the final saved map can still use the default 2-field schema. That is unacceptable because the UI promises a complete template.

Root cause to fix:

```text
User clicks Industry Standard card
  -> LibraryPath calls onChange({ full 42-field schema })
  -> then immediately calls onAdvance()
  -> WizardModal currently advances using an older draft snapshot
  -> the step changes, but the schema update can be overwritten
  -> final save uses the original default 2-field schema
```

So the starter data is rich, but the wizard state handoff is fragile. We need to make the selection and step advancement atomic and add safeguards so this cannot regress.

Plan:

1. Make wizard state updates transactional
   - Update `WizardModal.tsx` so every draft update uses functional state updates instead of stale draft snapshots.
   - Fix `onAdvance` handlers for Library, PDF, and AI paths so step changes compose with schema changes instead of overwriting them.
   - This directly resolves the “42 fields shown, 2 fields saved” bug.

2. Add a hard save-time safety net for starter templates
   - When saving a map created from an Industry Standard starter, re-check `draft.source.kind === "starter"` and `draft.source.ref`.
   - Look up the matching starter in `STARTER_TEMPLATES` and verify the outgoing schema has the same field count.
   - If the draft schema is missing or unexpectedly smaller, save the full starter schema instead of the default 2-field schema.
   - This guarantees the database receives all promised fields even if another UI state issue appears later.

3. Make the UI impossible to misread
   - In the final review step, display the selected starter name and exact field count, e.g. `Coworking / Flex Workspace template loaded: 42 fields ready to save`.
   - Change the final button copy for starter templates from `Create Map` to something clearer like `Save 42-Field Template`.
   - Keep the field list expanded by default so the MSP user can see the actual 42 fields before saving.

4. Reduce confusion between Industry Standards and saved user templates
   - Visually separate the “Pre-Built Templates” cards from “Your Saved Templates” more strongly.
   - Add a clear warning/label on saved templates with low field counts, e.g. `Saved map: 2 fields`, so users understand that selecting their own old saved map will copy only those 2 fields.
   - Rename “Use Proven Template” to `Use a Pre-Built Template` consistently in the modal title so it matches the action.

5. Validate the fix
   - Add a small test or verification path that simulates selecting each of the five starter templates and confirms the save payload contains the promised field count:
     - Residential: 46
     - Hospitality: 42
     - Commercial Office: 40
     - Multi-Family: 45
     - Coworking: 42
   - Run TypeScript validation to ensure the wizard changes compile cleanly.

Files to update:
- `src/components/vault/wizard/WizardModal.tsx`
- `src/components/vault/wizard/paths/LibraryPath.tsx`
- `src/components/vault/wizard/steps/ReviewStep.tsx`
- Possibly `src/components/vault/wizard/types.ts` if we add richer starter provenance labels
- Possibly a small validation/test script or test file for starter field counts

Expected result:

```text
Click Coworking / Flex Workspace card showing 42 fields
  -> final review says 42 fields loaded
  -> save button says Save 42-Field Template
  -> saved map card says Coworking / Flex Workspace • 42 fields
  -> reopening the map still shows all 42 fields
```

No backend schema changes are needed. This is a wizard-state and UX correctness fix.