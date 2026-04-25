## Why you can't find it

The Guided Refinement Template Architect was built and wired in, but it lives **3 clicks deep** with no signposting:

1. Property Docs tab → click **Manage Templates** (small text link)
2. Click **+ New Template** (or **Edit** on an existing one)
3. Scroll **past** the JSON Schema textarea — only then does the Architect appear, looking like a small sibling helper next to the older "Auto-Generate from Document" block.

That's why you see the JSON editor but no obvious AI workflow. Two fixes are needed: **surface it** from the Vault Property Docs tab, and **promote it** to the primary action inside the Templates editor.

## What we'll change

### 1. Promote Architect on the Property Docs vault tab
File: `src/routes/_authenticated.dashboard.vault.tsx`

Replace the small one-line "Manage Templates" strip (lines 460–478) with a richer **Template Architect callout card** that explains the AI workflow and is the primary entry point. Keep "Manage Templates" available as a secondary link.

Card content (Pro members):
- Sparkles/Wand icon + heading: **"AI Template Architect"**
- One-sentence pitch: *"Describe the property class and our AI drafts the extraction schema your clients' Property Docs are scored against — no JSON required."*
- Primary button: **"Launch Template Architect"** → routes to `/dashboard/vault/templates?architect=1`
- Secondary link: "Manage existing templates"

Starter tier: locked variant with the same explanation and an "Unlock with Pro" CTA, matching the existing Starter pattern.

### 2. Make the Architect the headline of the Templates editor
File: `src/routes/_authenticated.dashboard.vault.templates.tsx`

Restructure the EditorDialog body so MSPs encounter the AI workflow **first**, not buried below the JSON textarea:

```text
┌─ Editor Dialog ──────────────────────────────┐
│ Label · Doc Kind · Extractor                 │
│                                              │
│ ★ Guided Refinement Template Architect ★    │ ← promoted, expanded by default
│   (Describe → Refine → Apply)                │
│                                              │
│ ─ Or use a different starting point ─        │
│                                              │
│ ▸ Auto-Generate from PDF (collapsed)         │
│ ▸ Edit JSON Schema directly (collapsed)      │
│ ▸ Dry Run against sample PDF (collapsed)     │
└──────────────────────────────────────────────┘
```

Concretely:
- Move `<TemplateArchitect>` to the top of the form, immediately after Label/Doc Kind/Extractor.
- Add a short header strip above it: *"Start here — describe your property and let the AI build the schema."*
- Wrap the existing **JSON textarea**, **SchemaInductionSection** (PDF auto-generate), and **DryRunSection** in collapsible accordions, all collapsed by default. Power users can expand to see/edit JSON or dry-run.
- When the Architect's "Apply to Editor" finishes, auto-expand the JSON accordion so the user can see what was applied (a single visual confirmation).

### 3. Add an empty-state nudge on the Templates index
File: `src/routes/_authenticated.dashboard.vault.templates.tsx` (the `EmptyState` component, lines 233–246)

When the MSP has zero templates, replace the generic "No templates yet" with two side-by-side options:
- **"Build with AI Architect"** (primary, recommended badge) → opens the editor with Architect pre-focused
- **"Start from blank JSON"** (secondary) → current behavior

### 4. Auto-open Architect via query param
File: `src/routes/_authenticated.dashboard.vault.templates.tsx`

Read `?architect=1` from the URL on mount; when present, auto-open the New Template dialog with the Architect's Describe phase focused. Lets the vault tab's "Launch Template Architect" button drop the user straight into the workflow.

### 5. Add a one-line label inside the Add Property Doc dialog (Client-side hint)
File: `src/routes/_authenticated.dashboard.vault.tsx` (the asset editor dialog used for adding Property Docs)

Add a small italicized note under "Add Property Docs": *"This document will be parsed against your active Template. Manage your AI Template in Vault → Property Docs → Template Architect."* This closes the loop so MSPs uploading a doc understand the linkage.

## Files touched

- `src/routes/_authenticated.dashboard.vault.tsx` — promoted Architect callout card on Property Docs tab; hint inside Add Property Doc dialog
- `src/routes/_authenticated.dashboard.vault.templates.tsx` — reorder editor sections, add accordions, query-param auto-open, redesigned empty state
- *(no changes to)* `src/components/vault/TemplateArchitect.tsx`, `supabase/functions/induce-schema/index.ts`, or `src/lib/extraction/canonical-keys.ts` — backend already works; this is pure UX surfacing.

## Verification

- Visit `/dashboard/vault` → Property Docs tab → confirm Architect callout card is visible above the asset list.
- Click "Launch Template Architect" → editor opens with Architect at the top, in Describe phase.
- Empty templates page shows the two-option chooser.
- Existing JSON editing flow still works (accordions expand cleanly).
- No regressions: run `npm run verify:html` and `scripts/test-ask-runtime.mjs`.