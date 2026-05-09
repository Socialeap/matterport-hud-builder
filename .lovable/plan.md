# Fixes for the new MSP Directory matching layer

## 1. Remove the redundant "Create MSP Service Match" button

In `src/routes/agents.tsx` (the toolbar above the results grid currently has two CTAs side-by-side):

- Delete the second `<Dialog open={matchOpen}>…</Dialog>` block, including the `Sparkles` "Create MSP Service Match" trigger button and its inner `ServiceMatchForm`.
- Remove now-unused state: `matchOpen` / `setMatchOpen`, the `ServiceMatchForm` import, and the `Sparkles` import if not used elsewhere on the page.
- Keep all the 3-state Essential / Preferable / Not-Needed filter UI as-is — it still drives the on-page card filtering preview. Only the dialog/CTA goes away.
- Keep the existing "Notify Me When Matches Are Available" `BeaconForm` dialog untouched. That becomes the single, unambiguous CTA.

Backend artifacts (`capture-service-match` edge function, `service-match-ready` template, `get_service_match_*` RPCs, `/agents/match/$matchToken` route) are left in place — they're not referenced from the UI after this change, but they don't break anything either, and removing them is a separate cleanup if/when desired.

## 2. Fix the broken submission

The "Could not submit. Please try again shortly." toast surfaces whenever the edge function returns an error. Two causes are in play and both get addressed:

### a. Bug in `supabase/functions/capture-service-match/index.ts`

The validation regexes were written with **double-escaped** backslashes, so they reject every real email and every real ZIP:

```ts
const EMAIL_RE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;   // matches literal "\s", not whitespace
const ZIP_RE   = /^\\d{5}(-\\d{4})?$/;                // matches literal "\d", not digits
const normalizeCity = (s) => s.trim().replace(/\\s+/g, " ");
```

Replace with the same patterns already used (correctly) by `capture-beacon`:

```ts
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_RE   = /^\d{5}(-\d{4})?$/;
const normalizeCity = (s: string) => s.trim().replace(/\s+/g, " ");
```

This is the actual root cause of the 400 "Invalid email" response from the Service Match dialog. Even though the dialog is being removed in step 1, we fix the function so any future caller (or the public `/agents/match` route) doesn't silently break.

### b. Confirm `capture-beacon` (the Notify Me path) is healthy

`capture-beacon`'s regexes are already correct, and a direct call returns `{ success: true }`. After step 1 the only popup is the BeaconForm → `capture-beacon` flow, which is verified working. No code change required here.

## 3. Broaden sample MSP specialties so every filter has ≥2 matching cards

In `src/routes/agents.tsx`, update `MOCK_MSPS` so each of the 13 filterable specialties appears on at least 2 sample cards. Current gaps and additions:

| Specialty | Current | Add to |
|---|---|---|
| `scan-walkthrough-video-clips` | 0 | Coastal Tour Co., Lone Star Spaces |
| `scan-dimensional-measurements` | 1 | + Coastal Tour Co. |
| `scan-same-day-turnaround` | 1 | + Lone Star Spaces |
| `vault-interactive-widgets` | 1 | + Mile High Matterworks |
| `vault-custom-icons` | 1 | + Beacon Hill Tours |

Resulting per-card specialty lists:

- **Skyline 3D Studios** (pro): pro3, drone, twilight, sound-library, portal-filters, ai-lead-generation *(unchanged)*
- **Coastal Tour Co.** (starter): pro3, floor-plans, same-day, **walkthrough-video-clips, dimensional-measurements**
- **Lakeshore Immersive** (pro): pro3, dimensional-measurements, interactive-widgets, property-mapper *(unchanged)*
- **Lone Star Spaces** (starter): pro3, drone, custom-icons, **walkthrough-video-clips, same-day**
- **Mile High Matterworks** (pro): pro3, twilight, sound-library, property-mapper, ai-lead-generation, **interactive-widgets**
- **Beacon Hill Tours** (starter): pro3, floor-plans, portal-filters, **custom-icons**

Final coverage per service ≥ 2, so toggling any filter to Essential/Preferable still leaves a meaningful subset of the demo grid populated.

## Files touched

- `src/routes/agents.tsx` — remove second CTA + dialog + unused state/imports; expand `MOCK_MSPS` specialties.
- `supabase/functions/capture-service-match/index.ts` — fix double-escaped regex literals.

No DB migrations, no new components, no auth/RLS changes.
