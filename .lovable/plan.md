

## Plan: Glassmorphism Header for `/p/$slug` Portal

Replace the current top "View Demo" banner with a sticky, glassmorphism header that holds the MSP brand pill (left), section nav (right), and View Demo CTA (center).

---

### Layout

```text
┌────────────────────────────────────────────────────────────────────┐
│ [logo + Brand Studio]    [✨ View Demo →]    Steps · Compare · Build│
└────────────────────────────────────────────────────────────────────┘
   ← left                    ← center                ← right
```

- **Position**: `sticky top-0 z-50` so it stays in view as the user scrolls past the hero.
- **Glass**: `backdrop-blur-xl bg-white/40 dark:bg-slate-950/40 border-b border-white/30 shadow-sm`.
- **Container**: `mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4`.

### Three regions

1. **Left — MSP brand pill (enlarged)**  
   Re-uses the chip pattern from the hero but bigger: `h-11 rounded-full px-4`, logo `h-8 w-8`, brand name in `text-base font-semibold`. Wrapped in a subtle border to read as a pill on the glass bar.

2. **Center — View Demo CTA (only when `demoPublished === true`)**  
   Pill button: `inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-md`, background = `accent`, text white, with a sparkle/arrow icon. Routes via `<Link to="/p/$slug/demo" params={{ slug }}>`. Hidden on mobile (`hidden sm:inline-flex`); falls into the mobile menu instead.  
   When demo is not published, center stays empty (no element rendered).

3. **Right — section nav**  
   Three anchor links to in-page sections:
   - `Steps` → `#steps` (add id to the 3-step section)
   - `Compare` → `#compare` (add id to the comparison section)
   - `Builder` → `#builder-start` (already exists)  
   Styled as subtle text buttons: `text-sm font-medium text-slate-700 dark:text-slate-200 hover:text-[accent]` with smooth scroll handler reusing the existing `handleScrollToBuilder` pattern (generalized to take a target id).

### Mobile behavior (≤ `sm`)

- Brand pill stays left (logo + shortened name).
- Center "View Demo" hidden.
- Right nav collapses into a `Menu` icon button → opens an existing `Sheet` (already in `components/ui/sheet.tsx`) listing: View Demo (if published), Steps, Compare, Builder.

### Removals / changes

- Delete the current full-width accent-colored banner block at the top of `PortalPage` (the one wrapped in `{demoPublished && (...)}`). Its CTA migrates into the header center slot.
- Hero section keeps its own brand chip — it still reads as a hero element distinct from the persistent header. (No duplication concern; header is sticky, hero chip is one-time.)
- Add `id="steps"` to the 3-step section wrapper and `id="compare"` to the comparison section wrapper.

### Files touched

| File | Change |
|---|---|
| `src/routes/p.$slug.index.tsx` | Add `<PortalHeader />` inline component above hero; remove old demo banner; add ids to Steps & Compare sections; generalize smooth-scroll helper. |

No new dependencies, no DB changes, no other files touched.

### Acceptance check

1. Header is visible on first paint, stays pinned while scrolling.
2. MSP logo + name appear in a noticeably larger pill on the left.
3. When demo is published, the centered "View Demo →" button routes to `/p/{slug}/demo`.
4. Right-side links smooth-scroll to Steps / Compare / Builder.
5. Glass effect: header is translucent with blur over both the hero image and the white sections below.
6. Mobile (375px): brand pill left, hamburger right opens a sheet with all links + demo.

