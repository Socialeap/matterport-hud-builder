
# Property Features panel tweaks

The Mattertag side panel exists in **two mirrored places** — every change must land in both or the downloaded `.html` will drift from the preview.

| Surface | File | Where |
|---|---|---|
| Builder preview (React) | `src/components/portal/HudPreview.tsx` | mattertag drawer ~L954–1036 + `LinkifiedText` ~L1090–1119 |
| Generated `.html` runtime (string-templated JS/HTML/CSS) | `src/lib/portal.functions.ts` | CSS ~L1669–1701, HTML ~L2141–2153, `linkifyMattertagHtml` ~L2699–2713, `renderMattertags` ~L2718–2809 |

No backend / edge-function changes — the `fetch-mattertags` function already returns `media` (image URL) per tag, and the data the description holds is already passed through. All four tweaks are presentation-only.

---

## 1. Replace inline URL strings with a link-icon hyperlink

Current behavior: `linkifyMattertagHtml` (runtime) and `LinkifiedText` (preview) wrap any `https?://…` substring in an `<a>` whose **text is the full URL**, producing the long blue strings shown in the screenshot.

New behavior: detect URLs in the description, **strip the URL text out of the visible description**, and render a small "external link" icon button after the remaining text. Each unique URL becomes one icon. Icon opens in a new tab (`target="_blank" rel="noopener noreferrer"`).

- Markdown-style `[label](url)` (which the screenshot shows is what's actually in some descriptions) → render `label` as plain text, plus a trailing link icon for the URL.
- Bare `https://…` in the text → remove the URL substring, leave a trailing icon.
- Multiple URLs → multiple icons, separated by a small gap.
- HTML-escape everything; never inject raw description into innerHTML except via the existing escape path.

Apply to:
- **Runtime**: rewrite `linkifyMattertagHtml(s)` to return `{ html, links: string[] }`, then in `renderMattertags` append a `.mt-card-links` row of `<a>` icon buttons after the description.
- **Preview**: rewrite `LinkifiedText` to produce the same shape with a Lucide `ExternalLink` icon button row.
- Add matching CSS class `.mt-card-links` in the runtime CSS block and matching Tailwind classes in the preview.

## 2. Numbered badge in top-right of each card

Add a small circular badge (e.g. `1`, `2`, `3` …) absolutely positioned top-right of each `.mt-card` / preview card. Number = tag index + 1 in the **currently-rendered** sorted list (same sort the panel already uses: highest `anchorPosition.y` first), so numbering is stable per-render.

- **Runtime**: new `.mt-card-number` CSS rule; `renderMattertags` injects `<span class="mt-card-number">N</span>`.
- **Preview**: same with Tailwind absolute positioning.
- Must not collide with the existing `.mt-card-spinner` (top-right at 8px). Place the spinner inline with the number, or move the spinner to top-left when a number is present.

## 3. Image thumbnails from any extractable image URL

Today the thumbnail only renders when `tag.media` itself is an image extension (`/\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i`). The user's sample URL `https://cdn-2.matterport.com/attachments/.../IMG_2956.jpg?t=…` already matches this regex (the `?` boundary works), so any tag whose GraphQL `media` field is an image will already render — confirmed by reading the Edge Function output sanitizer.

What's missing: tags whose **image URL is embedded inside the description** (not in `media`). New extraction order:

1. If `tag.media` matches the image-extension regex → use it.
2. Else scan the description for the first `https?://…\.(jpe?g|png|gif|webp|avif)(\?|#|$)` URL → use it as the thumbnail source. (Same regex as #1, no Matterport-host restriction so non-CDN images also work.)
3. Else no thumbnail.

Clicking the thumbnail must open the existing media player (same surface as the current "Open Media" CTA):
- **Preview**: thumbnail `<img>` is wrapped in a `<button>` that calls `openMattertagMedia(resolvedImageUrl, tag.label, tag.id)`. That helper already builds a synthetic `MediaAsset` and feeds it to `MediaCarouselModal`. Pass the resolved (possibly description-scraped) URL, not `tag.media`.
- **Runtime**: thumbnail `<img>` gets `cursor:pointer` + click handler that calls `window.__openMattertagMedia(idx)`. The existing handler reads `tag.media`, so refactor it to accept an explicit URL override (or stash the resolved URL on the tag at render time and have `__openMattertagMedia` prefer the resolved URL).
- Image extraction must happen once per render and the resolved URL must drive **both** the thumbnail src and the click target so they stay in sync.

Edge cases:
- Description-scraped URL should still be hidden from the visible description text per tweak #1 (it'll be one of the link-icon entries; that's fine — the icon and the thumbnail both lead to the same asset).
- If the thumbnail `<img>` fails to load (`onerror`), it's removed (existing behavior) — keep that.

## 4. "(beta)" tag next to "Property Features"

- **Runtime** `<h2 id="mattertag-title">`: append `<span class="mt-beta">(beta)</span>` after the "Property Features" text. Add a `.mt-beta` CSS rule — small, lower-contrast, e.g. `font-size:10px; font-weight:500; color:rgba(255,255,255,0.55); margin-left:6px; letter-spacing:0.04em`.
- **Preview** `<h3>`: add the same tag as a Tailwind `<span className="text-[10px] font-medium text-white/55 tracking-wider">(beta)</span>`.

---

## Verification

After implementing both surfaces:

1. In the Builder preview, switch to a property with imported mattertags; confirm:
   - "(beta)" appears in the panel header
   - Each card shows a number top-right (1, 2, 3…)
   - Description has no inline URL text; an external-link icon appears for each URL
   - Cards with image media or a description-embedded image URL show a thumbnail
   - Clicking the thumbnail opens the existing MediaCarouselModal
2. Generate / download a `.html` for the same property and repeat the same 5 checks in the static file.
3. Verify a tag with no media and no URLs still renders cleanly (no empty icon row, no broken thumbnail box, no badge collision).
4. Confirm no regression to the existing card click → deep-link "Jump to view" behavior (clicks on the thumbnail button and link icons must `stopPropagation`).

No DB/schema/auth changes. No edge-function changes. No other components touched.
