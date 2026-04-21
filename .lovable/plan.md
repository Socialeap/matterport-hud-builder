

## Save & Resume Configuration Progress

### The question: client-side vs downloadable file?

Both work, but they solve different problems. My recommendation is **client-side autosave by default, with an optional "Export progress file" for portability**. Here's why and how each fits.

### Option A — Client-side autosave (recommended default)

Store the in-progress configuration in the browser's `localStorage` (or `IndexedDB` for files). Zero backend involvement, zero user effort.

**Pros**
- Invisible to the user — works automatically, like Google Docs.
- Survives tab close, browser close, and crashes.
- No "I forgot to save" failure mode.
- Honors your "nothing on our servers" constraint.

**Cons**
- Tied to one browser on one device. Clearing site data wipes it.
- Doesn't transfer to another machine.
- Storage cap (~5 MB for `localStorage`, ~hundreds of MB for `IndexedDB`).

### Option B — Downloadable progress file (`.3dps-draft.json`)

User clicks "Save Progress" → downloads a JSON file. To resume, they click "Load Progress" and pick the file.

**Pros**
- Portable across devices/browsers.
- User owns the file — true client-side sovereignty.
- Can be emailed, backed up, or attached to a project folder.

**Cons**
- Manual — user must remember to save before closing.
- Friction every session.
- Easy to lose the file or load the wrong version.

### Recommended approach — do both, layered

1. **Autosave to `localStorage`** every time a field changes (debounced ~500 ms). On mount, if a draft exists, show a small banner: *"Resume your saved draft? [Resume] [Start fresh]"*.
2. **Manual "Export draft / Import draft"** buttons in the sandbox header for cross-device portability.

This gives the safety net of autosave plus the portability of file export, with no backend storage.

### Scope of what gets saved

From `HudBuilderSandbox.tsx` state:
- Branding overrides: `brandName`, `accentColor`, `hudBgColor`, `gateLabel`
- `models[]` (PropertyModel array — names, locations, Matterport IDs, music/cinematic URLs, multimedia toggles)
- `behaviors` (per-model TourBehavior settings)
- `agent` (AgentContact fields)
- `reviewApproved` checkbox

### Handling files (logo, favicon, agent avatar)

`File` objects can't be `JSON.stringify`'d. Three honest options, ordered by simplicity:

1. **Skip files in the draft (simplest, recommended)** — Save everything *except* uploaded files. On resume, show a small "Re-upload your logo / favicon / avatar" hint next to those fields. Files are usually re-uploadable in seconds, and most users only upload once at the start.
2. **Base64-encode small files into the draft** — Works for `localStorage` (with a size guard, e.g. skip files > 1 MB) and the export file. Larger payloads, but full restore.
3. **IndexedDB for files + `localStorage` for the rest** — Most robust, more code. Only worth it if users frequently restart mid-session with large uploads.

Recommendation: **Option 1** for v1 — ship fast, see if anyone complains. Upgrade to Option 2 if needed.

### Technical implementation outline

- New file `src/lib/portal/draft-storage.ts` with `saveDraft(state)`, `loadDraft()`, `clearDraft()`, `exportDraftFile(state)`, `importDraftFile(file)`. Use a versioned schema (`{ version: 1, savedAt, data: {...} }`) so future field changes don't crash old drafts.
- In `HudBuilderSandbox.tsx`:
  - On mount: check for existing draft; if found, show a top banner with *Resume* / *Start fresh* actions.
  - `useEffect` watching `[brandName, accentColor, hudBgColor, gateLabel, models, behaviors, agent, reviewApproved]` → debounced `saveDraft()`.
  - On successful submission/payment: `clearDraft()`.
  - Add small "Export draft" / "Import draft" buttons near the existing action buttons.
- Storage key includes the provider slug (e.g. `3dps:draft:{providerSlug}`) so a client browsing two MSP studios doesn't get drafts crossed.
- Add a discreet "Clear saved draft" link inside the banner or in a footer area.

### What this does NOT change

- No database tables, no Supabase calls, no edge functions.
- No changes to the generated end-product `.html` file.
- Existing payment/generation flow is untouched.

