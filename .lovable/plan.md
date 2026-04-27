# Copyright CYA — Vault Upload Gate + ToS Indemnification

## 1. Trace (confirmed by code inspection)

**Production Vault upload surface — single chokepoint:**
- `src/routes/_authenticated.dashboard.vault.tsx` → `AssetEditorDialog` is the **only** UI in the app that calls `handleSave()` → `uploadVaultAsset()` / `INSERT vault_assets`. Every Vault category (Sound Library, Visual Filters, Interactive Widgets, Custom Iconography, Property Docs, External Links) flows through this one dialog regardless of upload-vs-URL mode.
- The pickers `SoundLibraryPicker.tsx` and `VaultCatalogList.tsx` are **read-only browsers** of already-published vault assets — they do not upload, so no gate is required there.

**Existing guards on the save path (must not be weakened):**
1. `if (!form.label.trim())` — label required
2. `if (isUrlMode && !form.asset_url.trim())` — URL required in URL mode
3. `if (!isUrlMode && !form.file && !editingId)` — file required for new uploads
4. `setSaving(true)` lockout during async upload
5. Tier gate (`isStarter` disables `Add Asset` button at the row level)

**Confirmation:** Adding the copyright checkbox as a new precondition in `handleSave()` and as a `disabled` contributor on the footer Save button is **additive**. It does not bypass, weaken, or orphan any existing guard. The `editingId` branch is unaffected because edits don't introduce new media authorship — but we still require re-affirmation when an edit replaces the file (treated like a new upload).

**Out-of-scope upload surfaces** (intentionally excluded — not Vault, not republished media): Branding logo/favicon, Agent avatar, Matterport `.mhtml` (parsed locally, not stored), AI training docs (private to provider), PDF schema sample (discarded after detection), JSON draft import (config only).

## 2. Blueprint

### A. Vault editor checkbox (`src/routes/_authenticated.dashboard.vault.tsx`)

**Component-level state in `VaultPage`:**
```ts
const [copyrightAck, setCopyrightAck] = useState(false);
```

**Reset on dialog open/close:**
- `openCreate()` → `setCopyrightAck(false)`
- `openEdit()` → `setCopyrightAck(false)` (re-affirm on every edit session)
- After successful save → `setCopyrightAck(false)`

**Pass to `AssetEditorDialog` via two new props:** `copyrightAck`, `setCopyrightAck`.

**UI insertion** — inside the dialog body, immediately above the `DialogFooter` (after the "Available to Clients" switch, before the Cancel/Save row):
```tsx
<div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
  <Checkbox
    id="vault-copyright-ack"
    checked={copyrightAck}
    onCheckedChange={(v) => setCopyrightAck(v === true)}
    className="mt-0.5"
  />
  <Label htmlFor="vault-copyright-ack" className="cursor-pointer text-xs leading-snug text-foreground/90">
    I confirm I own or have the licensed rights to use this media, and it does
    not violate any copyrights, trademarks, or third-party rights. I accept full
    liability per the{" "}
    <Link to="/terms" target="_blank" rel="noopener noreferrer"
      className="font-medium text-primary underline-offset-2 hover:underline">
      Terms of Service
    </Link>.
  </Label>
</div>
```

**Save-button gate (additive):**
```tsx
<Button onClick={onSave} disabled={saving || !copyrightAck}>
```

**Server-side guard (defensive, in `handleSave()` before upload):**
```ts
if (!copyrightAck) {
  toast.error("Please confirm copyright ownership before uploading");
  return;
}
```
This belt-and-suspenders prevents bypass if a user toggles the disabled attribute via devtools.

**External Link category:** Still gated. Embedding a copyrighted YouTube/Vimeo URL in a client presentation carries the same liability profile as uploading a file. The same checkbox text covers "media… you upload or link."

### B. Terms of Service update (`src/routes/terms.tsx`)

Insert a **new Section 6** titled "User-Uploaded Content & Media Indemnification" (renumber sections 6–14 → 7–15). Placing it adjacent to the existing IP/Acceptable Use language strengthens the legal posture vs. burying it at the end.

**New Section 6 copy (verbatim, ready to drop in):**

> **6. User-Uploaded Content & Media Indemnification**
>
> The Service includes a "Production Vault" and related upload tools that let you (the MSP) ingest media — including audio tracks, images, video, icons, scripts, embed snippets, documents, and external links — for inclusion in presentations you generate and distribute to your own clients. Each time you upload or link such media, you must affirmatively confirm via an in-product checkbox that you own or hold a valid license to use that media for its intended commercial purpose.
>
> **You assume sole and 100% liability** for any and all claims arising from media you upload, link, embed, or otherwise transmit through the Service, including but not limited to: copyright infringement, trademark infringement, right-of-publicity violations, DMCA takedown notices, royalty disputes, performance-rights claims (ASCAP, BMI, SESAC, SoundExchange, PRS, or any equivalent body), stock-media license violations (including watermarked or unlicensed Getty, Shutterstock, Adobe Stock, or similar imagery), and any related damages, fines, settlements, or attorneys' fees.
>
> You agree to **defend, indemnify, and hold harmless** Transcendence Media, its officers, directors, employees, contractors, partners, affiliates, end-clients receiving generated HTML deliverables, and downstream viewers of those deliverables, from and against any and all such claims, regardless of whether the infringement is alleged, threatened, or proven, and regardless of whether the media remains hosted on Service infrastructure, has been embedded in an exported HTML deliverable, or has been further redistributed by your clients.
>
> Transcendence Media does not pre-screen, license-clear, or audit user-uploaded media. We reserve the right (but assume no obligation) to remove any uploaded media at any time, suspend Vault uploads, or terminate accounts upon receipt of a credible infringement notice, without liability to you. Your in-product checkbox confirmation, together with these Terms, constitutes a binding representation that you have the necessary rights, and is admissible as evidence in any subsequent dispute.
>
> Counter-notices and DMCA inquiries should be sent to legal@transcendencemedia.com.

Section 11 (Indemnification) remains as a general clause; this new Section 6 is the media-specific super-set.

## 3. Verification Artifact (Section 28 enforcement)

After applying, run and report:

**Grep checks:**
```bash
rg -n "copyrightAck" src/routes/_authenticated.dashboard.vault.tsx
rg -n "User-Uploaded Content" src/routes/terms.tsx
rg -n "uploadVaultAsset|vault_assets.*insert" src --type ts --type tsx
```
- The first must show: state declaration, both reset sites, prop pass, dialog render, save-button `disabled` clause, and `handleSave` guard (≥6 hits).
- The second must show the new section heading.
- The third must show **only** the existing call sites in `_authenticated.dashboard.vault.tsx` (no new bypass paths introduced).

**TypeScript check:**
```bash
bunx tsc --noEmit -p tsconfig.json 2>&1 | rg "vault|terms" | head
```
Must be empty (no new type errors introduced).

**Console-trace dry run** (manual, documented in the apply step's reply):
1. Open `/dashboard/vault` as a Pro user → click **Add Asset** → confirm Save button is **disabled** with the checkbox unchecked.
2. Tick the checkbox → Save button becomes **enabled**.
3. Untick → Save returns to **disabled**.
4. Close and reopen the dialog → checkbox **resets to unchecked** (no sticky state across sessions).
5. Edit an existing asset → checkbox is again **unchecked** and Save is gated until re-confirmed.

## 4. Files Touched

| File | Change |
|---|---|
| `src/routes/_authenticated.dashboard.vault.tsx` | Add `copyrightAck` state, reset hooks, pass through to `AssetEditorDialog`, render checkbox UI, gate Save button + `handleSave` guard, import `Checkbox` and `Link` |
| `src/routes/terms.tsx` | Insert new Section 6 ("User-Uploaded Content & Media Indemnification") and renumber subsequent sections 7–15 |

No other files. No backend schema changes. No new migrations. No changes to `SoundLibraryPicker.tsx` or `VaultCatalogList.tsx` (read-only).

## 5. Risk & Ripple Assessment

- **No regressions to existing Vault flows:** The checkbox is purely additive to a single save path. Existing label/url/file validation and the `setSaving` lockout remain untouched and execute in their current order.
- **No regressions to other upload surfaces:** Branding, Agent avatar, Matterport sync, AI training, PDF detection, and JSON import are not modified.
- **No drift between client gate and ToS:** Both reference the same affirmative representation; the ToS explicitly cites "in-product checkbox" as the binding act, locking the legal narrative to the UI.
- **Edit-mode coverage:** Re-affirmation is required on every edit session, even if the file isn't being replaced — protects against silently re-publishing previously infringing material after a label/description change.
- **Devtools bypass:** Defended by the server-side-style guard inside `handleSave` (toast + early return) in addition to the disabled attribute.
- **Section renumbering in ToS:** No internal cross-references in the existing ToS use section numbers (verified by reading the full file), so renumbering 6→7 through 14→15 is safe with no broken anchors.
