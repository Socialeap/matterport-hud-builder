## Problem

Importing a `.3dps-draft.json` file fails with `NotReadableError` thrown from `await file.text()` inside `importDraftFile`. The caller swallows the specific error and shows a generic "Could not read draft file" toast, so the user has no clue why.

Root cause is in `src/components/portal/HudBuilderSandbox.tsx` around line 1895:

```ts
onChange={(e) => {
  const f = e.target.files?.[0];
  if (f) handleImportDraft(f);   // async, not awaited
  e.target.value = "";           // runs synchronously before file.text() resolves
}}
```

`handleImportDraft` is async. The next statement immediately resets `e.target.value = ""`, which clears the `<input type=file>`'s FileList. In Chromium this can invalidate the underlying file handle while `Blob.text()` is still streaming, producing `NotReadableError: The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.` The same class of error also fires if the user replaces/moves the file, but resetting the input is the reproducible trigger here.

A secondary issue: `importDraftFile` catches everything and returns `null`, so the UI cannot distinguish "file unreadable" from "invalid JSON" from "wrong version".

## Fix

Three small, surgical changes — no behavior changes elsewhere.

### 1. `src/components/portal/HudBuilderSandbox.tsx` (~line 1890–1900)

Read the file (or at least kick off the read) **before** clearing the input, and only reset the input after the async work resolves. Also guard against double-fires.

```tsx
onChange={async (e) => {
  const input = e.currentTarget;
  const f = input.files?.[0];
  if (!f) return;
  try {
    await handleImportDraft(f);
  } finally {
    // Reset only after the read completes so the File handle stays valid.
    input.value = "";
  }
}}
```

### 2. `src/lib/portal/draft-storage.ts` — `importDraftFile`

- Switch from `await file.text()` to a `FileReader`-based read wrapped in a Promise. `FileReader.readAsText` is more tolerant of transient handle issues than `Blob.text()` in Chromium and gives us a typed error.
- Re-throw a tagged `Error` instead of returning `null` so the caller can show a precise message. Keep the function signature returning `DraftState` (no nullable) and let the caller `try/catch`.

```ts
export async function importDraftFile(file: File): Promise<DraftState> {
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(new Error(`Could not read file (${reader.error?.name ?? "unknown"}). Re-select the file and try again.`));
    reader.readAsText(file);
  });

  let envelope: DraftEnvelope;
  try {
    envelope = JSON.parse(text) as DraftEnvelope;
  } catch {
    throw new Error("Draft file is not valid JSON.");
  }
  if (envelope.version !== DRAFT_VERSION) {
    throw new Error(`Unsupported draft version: ${envelope.version}`);
  }
  if (!envelope.data) throw new Error("Draft file is missing data.");
  return envelope.data;
}
```

### 3. `handleImportDraft` in `HudBuilderSandbox.tsx` (~line 589)

Wrap in try/catch and surface the real reason:

```tsx
const handleImportDraft = useCallback(async (file: File) => {
  try {
    const draft = await importDraftFile(file);
    applyDraft(draft);
    draftHydratedRef.current = true;
    setDraftBannerOpen(false);
    setPendingDraft(null);
    toast.success("Draft imported");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not read draft file";
    toast.error(msg);
    console.error("[draft-import] failed:", err);
  }
}, [applyDraft]);
```

## Why this is safe

- Only the import code path is touched — export, autosave, and the ZIP packaging pipeline are untouched.
- `importDraftFile`'s only caller is `handleImportDraft`, so changing its return type from `DraftState | null` to `DraftState` (throwing on failure) has no other ripple effects. A quick `rg "importDraftFile"` confirms a single import site.
- `FileReader` is universally supported and does not depend on the input element remaining mounted with a populated FileList.
- Resetting `input.value` in `finally` preserves the existing UX of allowing the user to re-select the same file after a failed import.

## Verification

1. Export a draft from the builder, then re-import it — should succeed with "Draft imported".
2. Import an invalid JSON file — should show "Draft file is not valid JSON."
3. Import a `.3dps-draft.json` saved by an older version — should show the version mismatch message.
4. Re-import the same file twice in a row — should still work (input gets reset in `finally`).
