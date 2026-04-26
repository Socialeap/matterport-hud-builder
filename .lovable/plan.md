# Plan: Multi-Path Wizard for Property Maps

## Goal
Replace the redundant Templates dashboard buttons and the monolithic "New Property Map" modal with a 4-path entry hub feeding a step-based wizard. No backend, API, or extraction-logic changes.

---

## Diagnostic — Current State Audit

| File | Status | Role in refactor |
|---|---|---|
| `src/routes/_authenticated.dashboard.vault.templates.tsx` (964 lines) | Stable but bloated. Top-right `New with AI` + `Blank map` buttons duplicate the empty-state cards. The `EditorDialog` mounts Architect, raw JSON, PDF induction, and Dry Run all at once. | Heavy rewrite of `EditorDialog` + `EmptyState` + header. |
| `src/components/vault/TemplateArchitect.tsx` (470 lines) | Stable. Self-contained 3-phase flow (Describe → Refine → Finalized). Calls `architectDraft` / `architectRefine`. | Reused as-is inside the Smart AI path. No internal changes. |
| `src/lib/extraction/induce.ts` | Stable. `induceSchema(pdf)` powers the PDF path. | Reused as-is. |
| `src/lib/extraction/dryrun.ts` | Stable. Powers Dry Run. | Reused, but moved to optional last-step action (not collapsible always-on). |
| `src/hooks/useVaultTemplates.ts` | Stable. `create/update/remove`. | Untouched. |
| `src/lib/vault/starter-templates.ts` | **New** — static seeded library. | New file. |

No latent inconsistencies found in the chain. `forceArchitect` URL param + `?architect=1` deep link still need to work and will be preserved (deep-links straight into Smart AI path).

---

## Trigger Trace (4 paths)

```text
Dashboard
  ├─ Card click  → setEditor(EMPTY_DRAFT) + setWizardPath('ai'|'pdf'|'library'|'manual')
  │                                              │
  │                                              ▼
  │                                       WizardModal (open)
  │                                              │
  │                                  ┌───────────┼───────────┬───────────┐
  │                                  ▼           ▼           ▼           ▼
  │                              SmartAI       PDF        Library     Manual
  │                              (3 steps)   (3 steps)   (2 steps)   (2 steps)
  │                                  │           │           │           │
  │                                  └───────────┴─────┬─────┴───────────┘
  │                                                    ▼
  │                                            draft mutated
  │                                                    ▼
  │                                       Final step → Save (create/update)
  │                                                    ▼
  │                                            close + refresh list
  ▼
Edit existing card  → setEditor(populated) + setWizardPath('manual') → jumps straight to final step
```

Existing `?architect=1` deep link → opens hub with Smart AI preselected (preserves current behavior from the portal).

---

## Sub-component Split

New folder: `src/components/vault/wizard/`

```text
wizard/
  WizardModal.tsx              ← shell: progress bar, Next/Back footer, step routing
  WizardHub.tsx                ← (used in dashboard, not modal) the 4 cards
  paths/
    SmartAIPath.tsx            ← wraps existing TemplateArchitect
    PdfPath.tsx                ← wraps existing SchemaInductionSection
    LibraryPath.tsx            ← lists starter library + user's own templates to clone
    ManualPath.tsx             ← raw JSON editor + Dry Run
  steps/
    NameStep.tsx               ← shared: Label input (final-step gate)
    AdvancedSettings.tsx       ← collapsible: Doc Kind + Extractor + Raw JSON peek
    ReviewStep.tsx             ← shared: schema preview + field count + Save button
```

`TemplateArchitect.tsx`, `SchemaInductionSection`, `DryRunSection` are **kept intact** and imported by the new path components — zero risk of breaking the working AI/PDF flows.

---

## Draft State Strategy

Single `WizardDraft` object owned by `VaultTemplatesPage`, threaded down. Same shape as today's `EditorState` plus path metadata.

```ts
type WizardPath = 'ai' | 'pdf' | 'library' | 'manual';

interface WizardDraft {
  id: string | null;            // null = create, set = edit existing
  path: WizardPath;
  step: number;                 // 0-indexed; per-path max
  label: string;
  doc_kind: string;
  extractor: ExtractorId;
  schema_text: string;          // canonical source of truth, JSON-stringified
  source: { kind: 'starter'|'cloned'|'pdf'|'ai'|'manual'; ref?: string } | null;
}
```

Rules:
- Each path mutates only `schema_text` (and optionally `doc_kind` / `label`) via callbacks. Mutations are **non-destructive** until the user clicks `Save`.
- Path can be switched only by closing the modal (cards on hub). Once inside a path, only Next/Back are exposed → no accidental cross-path state leakage.
- Edit-existing flow auto-selects `manual` path and jumps to final step (preserves current "edit JSON directly" capability).

---

## Per-Path Step Flow

### Smart AI Blueprint (3 steps)
1. **Describe property class** — Textarea (current Phase 1 of `TemplateArchitect`).
2. **Pick the facts** — Checklist (current Phase 2). On Finalize → schema written to draft.
3. **Name & Save** — Label input + collapsible Advanced (Doc Kind, Extractor, Raw JSON peek) + optional Dry Run button.

### Auto-Extract from PDF (3 steps)
1. **Upload sample document** — File input.
2. **Generate & review fields** — Calls `induceSchema`; shows detected fields list.
3. **Name & Save** — Same final step as above.

### Use Proven Template (2 steps)
1. **Pick a starting point** — Two sections:
   - **Industry Standards** (from `src/lib/vault/starter-templates.ts` — Residential, Hospitality, Commercial Office, Multi-Family, Coworking).
   - **My Templates** (clones from `useVaultTemplates`).
   Selecting one populates draft (`label` gets " (Copy)" suffix when cloning user's own).
2. **Name & Save** — Same final step.

### Pro Developer Setup (2 steps)
1. **Author JSON Schema** — Raw JSON textarea, large; live syntax check; current `EMPTY_EDITOR` schema as default.
2. **Name & Save** — Same final step (Advanced is *expanded by default* here — power users want it).

---

## Final Step — "Name & Save" (shared)

Layout from top to bottom:
- **Label** (required, only visible field by default).
- **Schema preview pill** — read-only "12 fields detected" + "Show fields" disclosure.
- **Advanced Settings** (`<Collapsible>`, default closed except Pro path):
  - Doc Kind input.
  - Extractor select (`pdfjs_heuristic` / `donut` disabled).
  - Raw JSON textarea (mono-font, last-resort edit).
- **Optional: Dry Run** button → opens current `DryRunSection` inline.

Footer: `[← Back]  [Cancel]  [Create Template]`.

---

## Progress Indicator

Top of modal, full-width pill bar:

```text
●━━━━○━━━━○        Step 1 of 3 · Describe property
```

- Circles fill in primary color as user advances.
- Current-step label shown to the right.
- Click on a previous filled circle = jump back (cheap, draft is preserved).

---

## Copy Update Map

| Old (technical) | New (result-oriented) |
|---|---|
| Schema | Intelligence Structure |
| JSON Schema | Field Blueprint |
| Extractor | Data Extractor |
| Heuristic | Pattern Reader |
| Induce | Teach AI / Auto-Detect |
| Dry Run | Test on Sample |
| Doc Kind | Document Type |
| Property Mapper | Property Intelligence Map |

Path card titles stay short and result-focused:
- **Smart AI Blueprint** — "Describe what you sell — AI builds the map."
- **Auto-Extract from PDF** — "Drop a sample doc — we'll detect every field."
- **Use Proven Template** — "Start from a battle-tested industry baseline."
- **Pro Developer Setup** — "Hand-author the field blueprint."

---

## Dashboard Changes (`vault.templates.tsx`)

1. **Header**: Remove the right-side `[New with AI] [Blank map]` cluster entirely. Title + subtitle stay.
2. **EmptyState**: Replace 2-card layout with the new 4-card `WizardHub` (also rendered when templates exist, in a compact horizontal strip above the grid as the primary entry point).
3. **EditorDialog**: Replaced by `<WizardModal />`. Open/close logic identical.
4. **Deep link** (`?architect=1`): Opens `WizardModal` with `path='ai'` preselected (preserves portal flow).
5. **Edit click on existing card**: Opens `WizardModal` with `path='manual'`, `step=last`, fully populated.

---

## Phased Implementation (validated before next phase begins)

**Phase 1 — Static foundations (no behavior change yet)**
- Create `src/lib/vault/starter-templates.ts` (5 rich starter blueprints).
- Create `src/components/vault/wizard/` skeleton + types. No imports yet from the route.
- `tsc --noEmit` must pass.

**Phase 2 — WizardModal shell + Manual path**
- Build `WizardModal`, progress bar, Next/Back, `ManualPath` (simplest), shared `NameStep`, `AdvancedSettings`.
- Wire into route as a *parallel* dialog behind a feature flag (or temporary alt button). Old EditorDialog still works.
- Verify create + edit through manual path.

**Phase 3 — Smart AI + PDF paths**
- Wrap existing `TemplateArchitect` in `SmartAIPath` (no internal changes).
- Wrap existing `SchemaInductionSection` in `PdfPath` (no internal changes).
- Verify both flows still produce the same final draft.

**Phase 4 — Library path**
- Build `LibraryPath` consuming `starter-templates.ts` + existing user templates.
- Verify clone produces editable draft.

**Phase 5 — Dashboard cutover**
- Remove top-right buttons.
- Replace `EmptyState` cards with `WizardHub` (4 cards).
- Swap `EditorDialog` → `WizardModal` everywhere; preserve `?architect=1` and edit-existing entry points.
- Delete now-unused `EmptyState` component and inline JSON/Induce/DryRun collapsible blocks from the route file (the underlying `SchemaInductionSection` / `DryRunSection` move into wizard step files).
- `tsc --noEmit` + manual click-through every path including edit-existing.

---

## Safety / Regression Guards

- `TemplateArchitect.tsx` is **not modified** — eliminates risk to the working AI flow.
- `induceSchema` / `dryRunTemplate` / `useVaultTemplates` APIs are **not touched**.
- `?architect=1` deep link behavior is preserved (covered in Phase 5 acceptance).
- Edit-existing-template path is preserved (auto-routes to manual/final step).
- Old `EditorDialog` is removed only in Phase 5 after the new shell is verified — single atomic swap.
- Each phase ends with `tsc --noEmit` and a smoke check before the next begins.

---

## Files Touched

**New:**
- `src/lib/vault/starter-templates.ts`
- `src/components/vault/wizard/WizardModal.tsx`
- `src/components/vault/wizard/WizardHub.tsx`
- `src/components/vault/wizard/paths/SmartAIPath.tsx`
- `src/components/vault/wizard/paths/PdfPath.tsx`
- `src/components/vault/wizard/paths/LibraryPath.tsx`
- `src/components/vault/wizard/paths/ManualPath.tsx`
- `src/components/vault/wizard/steps/NameStep.tsx`
- `src/components/vault/wizard/steps/AdvancedSettings.tsx`
- `src/components/vault/wizard/steps/ReviewStep.tsx`
- `src/components/vault/wizard/types.ts`

**Modified:**
- `src/routes/_authenticated.dashboard.vault.templates.tsx` (header trim, hub swap, dialog swap, removal of inline collapsibles)

**Untouched (verified safe):**
- `src/components/vault/TemplateArchitect.tsx`
- `src/lib/extraction/*`
- `src/hooks/useVaultTemplates.ts`
