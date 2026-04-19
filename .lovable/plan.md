

## Why thumbnails/photos broke on the demo page

The demo's saved data in the database (visible in the network response) stores **stale, expiring `cdn-2.matterport.com` URLs** as `proxyUrl`:

```
https://cdn-2.matterport.com/apifs/models/rMhcQXMdUmc/images/Kf4W95cWko1/...?t=2-edabb99b...-1776558857-1
```

That trailing `1776558857` is a unix timestamp embedded in Matterport's signed token — these URLs expire after a few hours. They were valid when first scraped/synced, but are now dead. Browser fetches return 401/403, so `<img>` renders blank.

But the **current** parser in `src/lib/matterport-mhtml.ts` (lines 240–298) only emits the stable, token-free permalink:

```
https://my.matterport.com/resources/model/{modelId}/image/{assetId}
```

That format never expires. So **freshly synced** properties work, but the **already-stored** demo data still contains the old expiring URLs from a previous version of the parser/sync flow.

Why this looks like a regression: the demo row was last saved when the codebase was emitting `cdn-2.matterport.com` URLs directly. Subsequent parser improvements switched to permalinks, but the existing `sandbox_demos.properties` JSON was never re-saved, so it retained the expired URLs. The carousel reads `a.proxyUrl` verbatim — no normalization layer.

## Fix: normalize `proxyUrl` at render time

Add a tiny pure helper that, given a `MediaAsset` with a `matterportId` context, rewrites any legacy `cdn-2.matterport.com` URL into the stable `/resources/model/{modelId}/image/{assetId}` permalink. Apply it everywhere a `proxyUrl` is rendered.

This:
- Fixes the live demo immediately on next page load (no DB migration needed).
- Is idempotent — already-canonical URLs pass through unchanged.
- Costs zero network/server work — pure string transform on the client.

### Changes (3 files)

**1. `src/lib/matterport-mhtml.ts`** — export a new helper:

```ts
export function canonicalProxyUrl(asset: { id: string; proxyUrl?: string }, modelId: string): string | undefined {
  // Already canonical or no URL: pass through
  if (!asset.proxyUrl || asset.proxyUrl.includes("/resources/model/")) {
    return asset.proxyUrl;
  }
  // Legacy stale cdn-2 URL — rebuild from stable permalink
  if (modelId && /^[A-Za-z0-9]{11}$/.test(asset.id)) {
    return `https://my.matterport.com/resources/model/${modelId}/image/${asset.id}`;
  }
  return asset.proxyUrl;
}
```

**2. `src/components/portal/MediaCarouselModal.tsx`** — accept `modelId` prop and normalize on read:

- Add `modelId: string` to `MediaCarouselModalProps`.
- Replace `current.proxyUrl` (line 110) with `canonicalProxyUrl(current, modelId)`.
- Replace `a.proxyUrl` (line 141) with `canonicalProxyUrl(a, modelId)`.

**3. `src/components/portal/HudPreview.tsx`** — pass `modelId` through:

- In the `<MediaCarouselModal>` JSX (line 352–358), add `modelId={currentModel.matterportId}`.

**4. `src/components/portal/PropertyModelsSection.tsx`** — same normalization for the dashboard list (line 306–308). The component already has access to the parent property's `matterportId` through context; pass it where the asset list is rendered and call `canonicalProxyUrl(a, parent.matterportId)`.

### Optional follow-up (not in this turn)

Add a one-time backfill: a small server function that loads each `sandbox_demos` row, walks `properties[].multimedia[]`, rewrites any legacy `cdn-2.matterport.com` URL to the canonical `/resources/...` permalink, and saves. This permanently cleans the data and removes the need for the runtime normalizer. We can do that after confirming the runtime fix works.

### Ripple safety trace

| Touched | Used by | Risk | Mitigation |
|---|---|---|---|
| `canonicalProxyUrl` (new) | Pure helper | None | Idempotent — passes canonical URLs through unchanged |
| `MediaCarouselModal` | `HudPreview` (only caller) | None | New required prop is added at the only call site |
| `HudPreview` | `HudBuilderSandbox`, demo page | None | Passes existing `currentModel.matterportId` |
| `PropertyModelsSection` thumbs | Dashboard builder only | None | Same helper applied to the list rendering |
| Stored DB data | `sandbox_demos.properties` | Untouched | Renderer normalizes — no migration required |

### Out of scope

- Re-scraping Matterport (not needed — permalink is stable).
- Changing the MHTML parser (already correct).
- Changes to video/`embedUrl` paths (those already use stable `/clip/` permalinks and work — only `proxyUrl` is affected).

### Verify after deploy

1. Reload `/p/transcendencemedia/demo`.
2. Open the Media Gallery (Images icon in HUD header).
3. Thumbnail strip shows poster frames; main viewer shows photos.
4. The video already worked and continues to work.
5. Builder thumbnails on `/dashboard/demo` and `/p/transcendencemedia` also display correctly.

