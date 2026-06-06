# Atlas deep-link sharing

Make every "share this destination" surface emit the canonical Atlas URL
`https://www.frontiers3d.com/atlas?spot=<entry-id>` (honoring `getPublicBaseUrl`)
instead of the standalone netlify presentation URL.

## 1. Deep-link state on `/atlas` (`src/routes/atlas.tsx`)

- Add a typed search schema to the route:
  ```ts
  validateSearch: (s) => ({ spot: typeof s.spot === "string" ? s.spot : undefined })
  ```
- In the page component, read `spot` via `Route.useSearch()`.
- After `listActiveAtlasEntries` resolves, if `spot` matches an entry id and
  that entry has a `presentation_url`, call `setActive(entry)` and
  `setSelectedId(entry.id)` once (guard with a ref so re-renders don't re-open
  after the user closes it).
- When the modal opens via card click, push `?spot=<id>` using
  `router.navigate({ search: { spot: id }, replace: false })`.
- When the modal closes (`setActive(null)`), clear it with
  `router.navigate({ search: {}, replace: true })`.
- Entries with no coordinates / no presentation_url are ignored (fallback: no
  auto-open, page still renders normally).

## 2. New helper: Atlas canonical URL

Add to `src/lib/public-url.ts`:
```ts
export function buildAtlasSpotUrl(entryId: string): string {
  return `${getPublicBaseUrl({ scope: "platform" })}/atlas?spot=${encodeURIComponent(entryId)}`;
}
```
Platform scope ensures we always use `www.frontiers3d.com` (never the
netlify showcase domain), even when viewed from a preview build.

## 3. Modal controls (`PresentationModal` in `src/routes/atlas.tsx`)

- Change the existing `↗` "Open in new tab" anchor's `href` from
  `entry.presentation_url` to `buildAtlasSpotUrl(entry.id)`. Title/aria
  updated to "Open Atlas link in new tab".
- Add a new `Share` control (lucide `Share2` icon) next to it:
  - Click handler tries `navigator.share({ url, title })` when available
    (mobile), else falls back to `navigator.clipboard.writeText(url)` and
    shows a brief "Link copied" toast via the existing `sonner` toast (already
    used elsewhere in the app — verify import path during implementation).
  - URL = `buildAtlasSpotUrl(entry.id)`.

## 4. In-iframe Share button bridge

The showcase's `.f3d-bar` Share button lives in the
`frontiers3d-atlas-showcases` repo, not here. To make it emit the Atlas URL
without duplicating logic, add a lightweight postMessage protocol:

**Atlas side (parent — this repo, `PresentationModal`):**
- On mount, register a `message` listener (scoped to the modal lifetime,
  removed on unmount).
- Accept only messages where `event.source === iframeRef.current?.contentWindow`
  AND `event.data?.type === "f3d:request-share-url"`.
- Reply with `iframe.contentWindow.postMessage({ type: "f3d:share-url", url: buildAtlasSpotUrl(entry.id) }, "*")`.
  (Target origin `*` is acceptable here: the payload is a public URL, contains
  no secrets, and the showcase origin is allowed to vary by deployment.)
- Add an `iframeRef` to the existing `<iframe>`.

**Showcase side (separate repo — documented, NOT implemented here):**
- Add a `BACKEND_ACTIVATION.md` note? No — this is a sibling-repo code change,
  not a Supabase activation. Instead, add a short note to the bottom of the
  plan output for the user explaining the showcase-repo change needed:
  > In the showcase template, the Share button handler should
  > `window.parent.postMessage({type:"f3d:request-share-url"}, "*")` and
  > listen for `f3d:share-url` to receive the canonical URL; if no reply
  > arrives within ~200ms (standalone open, not embedded), fall back to
  > `window.location.href` as today.

The Atlas-side bridge is harmless until the showcase ships its half — no
regression for currently-deployed showcases.

## 5. Out of scope

- No changes to `atlas_entries` schema, RLS, or server functions.
- No changes to the `ExpandedSpaceCard`, listing cards, map markers, admin UI,
  or curation flow.
- No new routes, no slug column, no SSR OG-tag work for `?spot=` (can be a
  follow-up; current head() copy stays generic).

## Files touched

- `src/routes/atlas.tsx` — search schema, auto-open effect, navigate on
  open/close, modal `iframeRef`, postMessage listener, updated `↗` href, new
  Share button.
- `src/lib/public-url.ts` — `buildAtlasSpotUrl` helper.

## Verification

1. Click any card → URL becomes `/atlas?spot=<id>`; modal opens.
2. Close modal → `spot` removed from URL.
3. Paste `/atlas?spot=<id>` into a fresh tab → modal auto-opens for that entry.
4. Click the modal `↗` → new tab opens `https://www.frontiers3d.com/atlas?spot=<id>` (not netlify).
5. Click the new Share button → URL copied; toast shows "Link copied".
6. Unknown / inactive / coords-less spot id → page renders normally, no modal.
7. Existing card hover, map markers, lazy backgrounds, expanded card, admin
   flows: unchanged.

Backend Activation Required: NO
Reason: Frontend-only change. No migrations, edge functions, RLS, secrets,
or storage involved.
