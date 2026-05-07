## Goal

Replace the single static hero screenshot on `/` and `/agents` with a synchronized 4-image fading slideshow, each slide superimposed with its own caption (white text + dark shadow, centered).

## Assets

Copy the four uploaded images into `src/assets/`:
- `user-uploads://Hero_Image_1.png` → `src/assets/hero-slide-1.png`
- `user-uploads://Hero_Image_2.png` → `src/assets/hero-slide-2.png`
- `user-uploads://Hero_Image_3.png` → `src/assets/hero-slide-3.png`
- `user-uploads://Hero_Image_4.png` → `src/assets/hero-slide-4.png`

The existing `hero-hud-showcase.png` import will be removed from both routes (no other consumers — verified via search).

## New shared component

Create `src/components/HeroSlideshow.tsx` — a self-contained client component:

- Props: none (slides are hardcoded so both pages stay perfectly in sync visually).
- Internal `slides` array of `{ src, caption }` pairs with the four captions:
  1. "From your studio, clients easily customize their 3D tour presentations 😉"
  2. "Each presentation is a multi-property showcase ready to download, host & distribute 😃"
  3. "Visitors can chat for automated answers based on property info uploaded by client 😇"
  4. "Visitor interest can be direct or auto-detected to capture high quality leads 🤩"
- Uses `useState` + `useEffect` with `setInterval` (≈4s per slide) to advance `activeIndex`. Cleanup on unmount.
- Renders all 4 `<img>`s absolutely stacked inside a `relative` container with `aspect-[1250/690]` (matches the source image ratio so layout doesn't jump). Active slide has `opacity-100`, others `opacity-0`, with `transition-opacity duration-500 ease-in-out` for the quick fade.
- Caption overlay: absolute centered `<p>` keyed off `activeIndex` (or rendered per-slide alongside the image so each fades together), reusing the existing style from index.tsx line 603 — `text-white/90`, `text-lg lg:text-2xl sm:text-xl`, `textShadow: '0 2px 12px rgba(0,0,0,0.7)'`, `text-center`, `max-w-lg`, `mx-4`.
- First image uses `loading="eager"`; rest `loading="lazy"`.
- Respects `prefers-reduced-motion`: if set, disable auto-advance and just show slide 1 (graceful degrade).

## Wiring

**`src/routes/index.tsx`**
- Remove `import heroHudBanner from "@/assets/hero-hud-showcase.png"`.
- Add `import { HeroSlideshow } from "@/components/HeroSlideshow"`.
- Replace lines 594–607 (the `<div className="relative">` containing the `<img>` and overlay `<p>`) with `<HeroSlideshow />`. The browser-chrome frame around it (lines 580–592, 608) stays intact.

**`src/routes/agents.tsx`**
- Remove `import heroHudBanner from "@/assets/hero-hud-showcase.png"`.
- Add `import { HeroSlideshow } from "@/components/HeroSlideshow"`.
- Replace line 383 (the bare `<img>`) with `<HeroSlideshow />`. Browser-chrome frame above it stays intact. Note this page currently has no caption overlay — adding one via the slideshow is consistent with the user's request ("same slide-show hero").

## Ripple Check

- `heroHudBanner` import: `rg` confirmed only `index.tsx` and `agents.tsx` reference it. Safe to drop from both.
- The slideshow lives inside the existing browser-chrome frame on both pages — no surrounding layout, padding, or CTA changes.
- `aspect-[1250/690]` keeps the frame the same height as the current static image (source is 1250×690-ish), so no CLS or hero-section reflow.
- Component is client-side only; safe under SSR because effects run after hydration. Initial server render shows slide 1 statically.
- No new dependencies, no route, server-fn, or DB changes.
