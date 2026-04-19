

## Plan: Fix MP Media Sync — quoted-printable decoding

### Root cause (confirmed via file inspection)
The Matterport-saved MHTML uses `Content-Transfer-Encoding: quoted-printable`. In the file body:
- Every `=` becomes `=3D`, so our regex `data-testid="thumbnail-card-..."` never matches what is actually written as `data-testid=3D"thumbnail-card-..."`.
- Lines wrap at ~76 chars with a trailing `=` + newline (soft break), which can split asset IDs and image filenames mid-token.
- The Model ID just happened to match because that pattern occurs in cleanly-written places (URL header / `?m=` query).

That's why the modal showed "Detected Model ID: rMhcQXMdUmc" but "0 videos, 0 photos, 0 GIFs" — assets were there (e.g. `thumbnail-card-6DEGRapXhjY`, `thumbnail-card-wPVZdS6HkVq`, etc., all clearly visible in the file), the parser just couldn't see them.

### Fix (single small change, surgical, safe)

**Decode quoted-printable before parsing.** Add one helper in `src/lib/matterport-mhtml.ts` and call it as the first step of `parseMatterportMhtml(text)`.

```ts
function decodeQuotedPrintable(input: string): string {
  // 1) Remove soft line breaks: "=" immediately followed by CRLF or LF
  // 2) Replace "=HH" hex escapes with the literal byte (UTF-8 safe)
  const noSoftBreaks = input.replace(/=\r?\n/g, "");
  // Convert the resulting bytes back to a JS string. We treat =HH as a single
  // byte and decode the full byte sequence as UTF-8 so multibyte chars
  // (e.g. "=E2=80=93" → en-dash) are preserved.
  const bytes: number[] = [];
  for (let i = 0; i < noSoftBreaks.length; i++) {
    const c = noSoftBreaks.charCodeAt(i);
    if (c === 0x3d /* "=" */ && i + 2 < noSoftBreaks.length) {
      const hex = noSoftBreaks.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(c & 0xff);
  }
  try {
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  } catch {
    return noSoftBreaks; // fallback
  }
}
```

Then in `parseMatterportMhtml`:
```ts
export function parseMatterportMhtml(rawText: string): ParsedMhtml {
  // Detect QP either by header or by structural fingerprint, then decode.
  const isQP =
    /Content-Transfer-Encoding:\s*quoted-printable/i.test(rawText) ||
    /=3D"/.test(rawText);
  const text = isQP ? decodeQuotedPrintable(rawText) : rawText;
  // ...existing logic unchanged
}
```

After decoding, every existing regex (`thumbnail-card-`, `models/{id}/images/...`, `?m=`, `Photo_NN.jpg|gif`) works without modification because the decoded text is the same HTML the browser would render.

### Why this is safe
- **Pure & local**: still no network, no DOM, no I/O. The function ships in the same module.
- **Idempotent guard**: we only decode when QP is detected. Plain HTML files (or anything we wrote ourselves) pass through untouched.
- **Multibyte-correct**: soft breaks removed first, then bytes assembled and passed through `TextDecoder("utf-8")` so titles like "Marriott Marquis – Broadway Ballroom" (`=E2=80=93` → `–`) decode correctly.
- **Backward-compatible**: any previously-saved data is unaffected (this only changes parsing behavior at upload time).
- **Defensive ceiling**: the existing 60 MB file size cap remains.

### Bonus (free win, included)
Once decoded, `findExplicitPhotoFilename` will now match the per-asset `…/{assetId}-Photo_03.jpg` strings in the file — so each photo gets its **correct** filename (Photo_03, Photo_04, …) instead of always defaulting to `Photo_01.jpg`. This means previously-broken photo URLs after sync will now resolve to real images.

### Files touched
- `src/lib/matterport-mhtml.ts` — add `decodeQuotedPrintable`, call it as first step of `parseMatterportMhtml`. No other file needs changes.

### Out of scope
- No DB/migration changes.
- No UI changes (existing modal, list, and carousel just start receiving real data).
- No change to the `Downloads`-vs-`Media` tab guidance — the file the user uploaded does contain the assets, so the existing Quick Guide is already correct.

