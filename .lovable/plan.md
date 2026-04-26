## Goal

Replace today's developer-facing flow ("Upload Doc / From vault / Run Extraction / Templates") with a single guided 4-step wizard called **"Train Your Property's AI Chat"**. One entry point per property; no more forking between Vault and Upload before the user understands the destination.

## End-User Journey (the new wizard)

A single button per property — **"Set Up AI Chat Assistant"** (replaces today's "Upload Doc" + "From vault…" pair) — opens a Shadcn `Dialog` with a 4-step `Stepper` header.

```text
[1 Profile] ─► [2 Source] ─► [3 Training] ─► [4 Verify]
```

1. **Step 1 — Property Profile.** Visual card grid of property categories (Co-working, Residential, Commercial Office, Hospitality, Multi-Family). Each card maps internally to the matching `vault_template` (provider's curated template if present, otherwise the matching `STARTER_TEMPLATES` entry — auto-cloned into the provider's vault on first use). Heading: *"What kind of space should the AI learn about?"*
2. **Step 2 — Knowledge Source.** A single drop-zone (PDF / DOCX / TXT / RTF, plus URL paste). Below: collapsed "Use a document already in your library" link that expands a list of existing `property_doc` vault assets. Auto-naming: `{PropertyName} — {YYYY-MM-DD}` (no Label field shown).
3. **Step 3 — Training.** Single primary button **"Activate AI Learning"**. After click, three sequential phase chips animate with a pulsing progress bar:
   - *Reading document…* (upload + storage registration)
   - *Extracting key facts…* (extract-property-doc invocation)
   - *Optimizing chat responses…* (waiting on `IndexingProvider` `phase === "ready"`)

   Friendly errors map raw failures: PDF parse → *"The AI had trouble reading this page. Try a clearer copy?"*, network → *"Couldn't reach our training service — try again."*, low-content URL → *"This page didn't have much text. A PDF datasheet works best."*
4. **Step 4 — Verify (Payoff).** Green confirmation card: *"Your AI is now familiar with {PropertyName}. It learned X facts and Y context chunks."* Lists 3 auto-suggested questions (derived from the highest-confidence extracted fields, e.g. *"What's the list price?"*, *"How many bedrooms?"*). Two buttons:
   - **Done** (closes wizard, returns to Enhancements panel with the new doc visible).
   - **Test now** — expands an inline mini chat in the same modal that calls the existing Ask runtime against this property.

Footer always shows **Back** + the step's primary action — never a Cancel button (closing happens via the modal's X to reduce "I'm failing" feel).

## Terminology Translation (applied across all wizard copy)

| Current term | New user-facing term |
|---|---|
| Extraction | AI Training / Learning |
| Run / Run Extraction | Activate AI Learning |
| Template | Property Profile |
| Vault Doc | Source Material |
| Property Intelligence | AI Chat Assistant |
| Indexed | Ready |
| Frozen | Paused |

Internal code keeps its current names — translation happens at the component/UI string layer only.

## Technical Plan

### Files to add

```text
src/components/portal/ai-training-wizard/
├── AiTrainingWizard.tsx          # Modal shell + stepper + state machine
├── steps/
│   ├── ProfileStep.tsx           # Card grid (categories)
│   ├── SourceStep.tsx            # Drop-zone + library expander
│   ├── TrainingStep.tsx          # 3-phase progress + error mapper
│   └── VerifyStep.tsx            # Success card + suggested Qs + inline chat
├── friendly-errors.ts            # Maps ExtractionError → user copy
└── profiles.ts                   # Maps category → template id (curated or starter clone)
```

### Files to modify

- **`src/components/portal/PropertyIntelligenceSection.tsx`** — strip both legacy dialogs (Upload + From-vault picker), strip the `ensureAutoTemplate` / `induceSchema` helpers (logic moves into the wizard's training step), strip the `templateId` / `vaultPickerOpen` / `pickedVaultAssetId` state. Keep: per-model row, status pills, asset list, delete/reindex actions, LUS gate. Replace the two header buttons with one **"Set Up AI Chat Assistant"** button that opens `<AiTrainingWizard model={...} savedModelId={...} onComplete={onExtractionSuccess} />`.
- **`src/components/portal/EnhancementsSection.tsx`** — rename the "Ask AI" tab label to **"AI Chat Assistant"**; keep its mounting of `PropertyIntelligenceSection` unchanged.

### Files to delete

- **`src/components/portal/PropertyDocsPanel.tsx`** — already orphaned (no React import in tree). The unrelated `buildPropertyDocsPanel` server HTML helper in `src/lib/portal.functions.ts` stays untouched.

### Wizard state machine (single source of truth)

```ts
type WizardState = {
  step: 1 | 2 | 3 | 4;
  profileId: string | null;          // resolved vault_template.id
  profileCategory: CategoryKey | null;
  source:
    | { kind: "file"; file: File }
    | { kind: "vault"; assetId: string }
    | { kind: "url"; url: string }
    | null;
  vaultAssetId: string | null;       // populated after upload/registration
  trainingPhase: "idle" | "reading" | "extracting" | "optimizing" | "ready" | "error";
  errorCopy: string | null;
  result: { fields: Record<string, unknown>; chunkCount: number } | null;
};
```

### Step 3 control flow (the heart of the refactor)

```text
onActivate():
  ├── resolve profile → templateId
  │     - if provider has vault_template matching profileCategory → use it
  │     - else: clone STARTER_TEMPLATES[profileCategory] into vault_templates,
  │             flagged is_active=true, then use the new id
  ├── set phase = "reading"
  │     - file path:  uploadVaultAsset → insert vault_assets row
  │     - vault path: reuse existing assetId (skip upload)
  │     - url path:   insert text/uri-list vault_assets row
  ├── set phase = "extracting"
  │     - PDFs: induceSchema → merge new properties into a per-extraction
  │             schema overlay (selected profile's required[] preserved)
  │     - call extract / extractFromUrl with resolved templateId
  ├── set phase = "optimizing"
  │     - subscribe to indexing.statusFor(propertyUuid); resolve when "ready"
  │     - timeout fallback: 25s → still advance, show "Indexing continues in background"
  └── set phase = "ready", advance to step 4
```

Auto-fill mode is **"Selected Profile + induce extra fields from the doc"** (per Q2). Implementation: in step 3, when the doc is a PDF, call `induceSchema` and merge any properties not already present in the profile schema into a *per-extraction* schema before sending to `extract-property-doc`. The provider's saved profile template is **not** mutated — the merge is local to this run, so the profile stays predictable across uses while individual extractions still capture doc-specific extras.

### Verification step (Q1: card + optional Test-now chat)

- Default view: success card showing field count, suggested questions (`Object.keys(result.fields).slice(0, 3).map(humanize)`), and two CTAs.
- **Test now** mounts a minimal `<AskMiniChat propertyUuid={model.id} />` directly inside the dialog body. Reuse the existing Ask runtime path used by the published portal — call it via the same RPC the live `Ask` button uses (no new server function). If the Ask runtime needs a saved-model context that doesn't yet exist in the builder, the chat instead surfaces a one-line preview using the extracted facts (graceful fallback) so the wizard always closes on a positive note.

### Data-flow safety audit (no regressions)

- **`useAvailableTemplates` / `useAvailablePropertyDocs`** — unchanged. Wizard reads them; refresh on success.
- **`usePropertyExtractions.extract / extractFromUrl`** — unchanged signatures; wizard calls these with the resolved template id (curated, cloned starter, or auto-induced).
- **`IndexingProvider`** — already shared between PIS and the deleted PDP. Wizard subscribes via the same `useIndexing()` hook for phase-3 progress; no new context needed.
- **LUS gate (`useLusLicense`) and per-property freeze (`useLusFreeze`)** — wizard's "Set Up AI Chat Assistant" button respects both, identical to today's Upload button gating. The wizard never opens when frozen or LUS-inactive; existing extractions still render read-only.
- **Server functions (`extract-property-doc`, `extract-url-content`, `induce-schema`)** — no signature or behavior changes. Wizard is a pure UI/state refactor on top of the existing extraction pipeline.
- **`portal.functions.ts > buildPropertyDocsPanel`** — server-side runtime tour HTML. Untouched.
- **Saved-model id propagation** — wizard receives `savedModelId` from `EnhancementsSection` and forwards it into `extract({ saved_model_id })` exactly as PIS does today, so canonical-Q&A enrichment continues to fire.

### Friendly error map

```ts
// friendly-errors.ts
export function friendly(err: ExtractionError): string {
  switch (err.stage) {
    case "fetch_pdf":        return "Couldn't open this PDF. Try a different copy.";
    case "parse_pdf":        return "The AI had trouble reading this page. A clearer scan or text-based PDF works best.";
    case "fetch_url":        return "Couldn't reach that page. Check the URL and try again.";
    case "low_content":      return "This document had very little text. Try a more detailed datasheet.";
    case "embed":            return "Indexing is still finishing in the background — you can close this and check status on the property card.";
    default:                 return "Something interrupted the AI training. Try again, or use a different document.";
  }
}
```

### Step-by-step rollout (single message)

1. Create `ai-training-wizard/` folder with the 5 new files above.
2. Update `PropertyIntelligenceSection.tsx` — strip dead state/dialogs, mount the wizard, keep status list.
3. Rename Enhancements tab label to "AI Chat Assistant".
4. Delete `PropertyDocsPanel.tsx`.
5. Type-check (`tsc --noEmit`) — confirm no other importers broke.

## Open architectural notes

- The starter template auto-clone in step 3 means a provider who has never authored a Co-working profile will silently get one in their vault the first time a client trains on a Co-working property. Visible in `/dashboard/vault/templates` afterwards. This matches today's `ensureAutoTemplate` behavior (which also writes hidden templates), just better-named.
- The wizard never asks for a Label or a Doc Kind. Auto-naming is `{PropertyName} — {ISO date}` for assets and `{Profile} for {PropertyName}` for cloned templates.
- "Test now" inline chat reuses the published Ask runtime path; if the property has not yet been saved into a `saved_models` row (rare in builder context), the wizard falls back to a static "Here's what I learned" preview so the wizard always closes positively.
