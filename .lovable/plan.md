# Atlas listing cards: image backgrounds with lazy loading

## Goal
Make each left-column card on `/atlas` visually richer by rendering the entry's hero image (or category fallback) as a tinted background behind existing text, while keeping perf tight: only the first 10 cards request images immediately; the rest load as they scroll into view.

## Scope
Frontend only. `src/routes/atlas.tsx` + `src/styles.css`. No data, route, or backend changes.

## Changes

### 1. `ListingCard` (src/routes/atlas.tsx)
- Resolve image URL with the same two-step fallback already used in tooltips/expanded cards:
  `entry.hero_image_url || getCategoryImageUrl(entry.category)`.
- Add a `shouldLoad: boolean` prop driven by the parent (see #2). When `false`, render the card with the dark fallback background only — no `background-image` set, no network request.
- When `shouldLoad` is `true`, set `style={{ backgroundImage: \`url("\${url}")\` }}` on a new `.atlas-card-bg` layer inside the card.
- Use a hidden `<img loading="lazy" decoding="async" onError>` probe to detect broken hero URLs and silently fall through to the category image (mirrors `ExpandedSpaceCard` pattern). Two-state: `heroFailed`, `catFailed`.
- Preserve all existing markup, classes, click/hover handlers; just wrap inner content in a relative container above the background + tint layers.

### 2. Lazy load batching (parent list, around the `.atlas-list` render)
- Track `visibleCount` state, initialized to `10`.
- Use a single `IntersectionObserver` attached to a sentinel `<div>` rendered at the bottom of the list. When the sentinel intersects the scroll viewport, bump `visibleCount` by `10` (capped at `entries.length`).
- Pass `shouldLoad={index < visibleCount}` to each `ListingCard`.
- Reset `visibleCount` to 10 whenever the filtered entry list identity changes (search/category filter), so a new filter doesn't immediately request 100 images.
- Cleanup observer on unmount.

Rationale: IntersectionObserver on a sentinel is simpler and more reliable than per-card observers, and naturally limits in-flight image requests to the first batch on initial render.

### 3. CSS (src/styles.css, atlas components layer)
- Add `.atlas-card` rules: `position:relative; overflow:hidden; isolation:isolate;` keep existing `background:#0f172a` as the fallback color.
- Add `.atlas-card-bg`: absolutely positioned, `inset:0; z-index:0; background-size:cover; background-position:center; background-repeat:no-repeat;`.
- Add `.atlas-card-tint`: absolutely positioned, `inset:0; z-index:1; background:linear-gradient(180deg, rgba(15,23,42,0.82) 0%, rgba(15,23,42,0.92) 100%);` — enough opacity to keep current text colors (`#fff` title, `#94a3b8` body) fully legible per WCAG AA on any image.
- Ensure all existing inner content sits at `z-index:2` via a `.atlas-card-inner` wrapper (or `& > *:not(.atlas-card-bg):not(.atlas-card-tint) { position:relative; z-index:2; }`).
- On `:hover` and `.is-selected`, slightly drop the tint top-stop opacity (e.g. `0.72 → 0.92`) so the image breathes a little — keeps interactivity feedback without sacrificing contrast.

### 4. Non-goals
- No change to map pins, tooltips, expanded card, admin curation form, or `CATEGORY_IMAGES` mapping.
- No virtualization library — IntersectionObserver batching is sufficient at expected list sizes (<200).
- No new dependencies.

## Verification
- Load `/atlas`: first 10 cards show category/hero backgrounds with dark tint; Network panel shows ≤10 image requests initially.
- Scroll the left column: next batches of 10 load progressively; total requests = number of cards seen.
- Title, category chip, location, summary, footer all remain readable on every image.
- Apply a category filter or search: visible count resets, images load in batches again for the new list.
- Card with a broken `hero_image_url` silently falls back to its category image; card with broken category image falls back to the dark gradient — no console errors.
- Existing hover / selected / click-to-open behavior unchanged.
