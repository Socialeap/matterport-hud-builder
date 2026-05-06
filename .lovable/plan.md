# Fix Neighborhood Map rendering

## Root cause

The map silently fails for two reasons:

1. **Thin query** — `buildNeighborhoodMapUrl()` only forwards the `location` field (e.g. `"Vail, CO 81658"`). The street address (`700 Red Sandstone`) and the property name (`Piney River Ranch`) are dropped, so Google often resolves to a generic centroid or returns no usable place.
2. **Wrong embed host** — both the builder preview (`types.ts`) and the runtime portal (`portal.functions.ts:2417`) use the legacy `maps.google.com/maps?...&output=embed` path. Google increasingly serves it with `X-Frame-Options: SAMEORIGIN`, so the iframe renders blank. The supported keyless embed path is `https://www.google.com/maps?q=…&output=embed`.

Both the builder modal and the exported standalone `.html` have the same bug — they must be fixed in lockstep.

## Fix

### 1. `src/components/portal/types.ts` — generalize the URL builder

```ts
export function buildNeighborhoodMapUrl(parts: {
  propertyName?: string;
  address?: string;   // street, e.g. "700 Red Sandstone"
  location?: string;  // city/state/zip, e.g. "Vail, CO 81658"
}): string {
  const clean = (s?: string) => (s ?? "").replace(/[\r\n\t]+/g, " ").trim();
  const segs = [clean(parts.propertyName), clean(parts.address), clean(parts.location)]
    .filter(Boolean);
  if (segs.length === 0) return "";
  // Drop propertyName if it's already inside address/location
  const tail = segs.slice(1).join(", ").toLowerCase();
  if (segs[0] && tail.includes(segs[0].toLowerCase())) segs.shift();
  const q = encodeURIComponent(segs.join(", "));
  return `https://www.google.com/maps?q=${q}&t=&z=15&ie=UTF8&iwloc=&output=embed`;
}
```

Why this is safe and effective:
- Strips control chars (a stray newline is the silent killer that yields "no results").
- Filters empties — a missing field never produces `q=,,,`.
- Dedupes name/address overlap.
- Single `encodeURIComponent` — safe for commas, ampersands, accents.
- Keyless host — no API key shipped in the exported `.html` (which would leak to every visitor).

### 2. `src/components/portal/NeighborhoodMapModal.tsx`

Add an optional `address` prop and call `buildNeighborhoodMapUrl({ propertyName, address, location })`.

### 3. `src/components/portal/HudPreview.tsx` (~line 813)

Pass `address={currentModel.name}` and `propertyName={currentModel.propertyName}` to `<NeighborhoodMapModal>` (the model's `name` field stores the street; `propertyName` stores the friendly name).

### 4. `src/lib/portal.functions.ts` — runtime parity for exported `.html`

Replace the inline `mapFrame.src=…` near line 2417 with ES5-safe composition:

```js
var segs=[p.propertyName,p.name,p.location]
  .map(function(s){return (s||"").replace(/[\r\n\t]+/g," ").trim();})
  .filter(Boolean);
var tail=segs.slice(1).join(", ").toLowerCase();
if(segs[0] && tail.indexOf(segs[0].toLowerCase())!==-1) segs.shift();
mapFrame.src="https://www.google.com/maps?q="+encodeURIComponent(segs.join(", "))+"&t=&z=15&ie=UTF8&iwloc=&output=embed";
```

Verify the model serializer (around line 944) includes `propertyName` and `name`; add them if missing.

## Files touched

- `src/components/portal/types.ts`
- `src/components/portal/NeighborhoodMapModal.tsx`
- `src/components/portal/HudPreview.tsx`
- `src/lib/portal.functions.ts`

## Out of scope

No Google Maps API key is introduced — the keyless embed host stays free and avoids leaking a key in the standalone exported portal. If you later want richer pins (custom markers, Street View), that would be a separate decision to adopt the paid Embed API with a domain-restricted key.
