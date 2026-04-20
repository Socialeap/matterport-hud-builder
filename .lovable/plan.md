

## Plan: Fix Portal Header — single pill, branded glass

Three targeted fixes to the sticky header in `src/routes/p.$slug.index.tsx`:

### 1. One brand pill, not two
- **Remove** the smaller header brand pill currently rendered in the left slot of `<PortalHeader />`.
- **Move** the larger hero brand pill (logo + "{brand} Studio") from the hero section into the header's left slot, preserving its existing styling (size, rounded-full, border, logo dimensions).
- Hero section keeps its headline + sub + CTA but no longer renders a brand chip — eliminates duplication.

### 2. Glassmorphism header tinted by HUD background color
Replace the current `bg-white/40` with a translucent layer driven by `branding.hud_bg_color`:

```tsx
<header
  className="sticky top-0 z-50 w-full border-b border-white/20 shadow-sm backdrop-blur-xl"
  style={{
    backgroundColor: `${branding.hud_bg_color}cc`, // ~80% opacity hex alpha
  }}
>
```

- Uses 8-digit hex alpha (`cc` ≈ 80%) so the MSP's chosen HUD background tints the bar while blur preserves the glass effect over the hero image and lower sections.
- Border softened to `border-white/20` so it reads on dark or light tints.
- Right-side nav links switch to a neutral text color that works on either tint (`text-white/90 hover:text-white` with a subtle text-shadow), since `hud_bg_color` is typically dark.
- Brand pill inside the header gets a slightly translucent inner background (`bg-white/15`) so the logo + name remain legible against the tinted bar.

### 3. View Demo CTA uses accent color
The center "View Demo →" pill background switches to `branding.accent_color`:

```tsx
<Link
  to="/p/$slug/demo"
  params={{ slug }}
  style={{ backgroundColor: branding.accent_color, color: "#fff" }}
  className="hidden sm:inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg"
>
  <Sparkles className="h-4 w-4" /> View Demo <ArrowRight className="h-4 w-4" />
</Link>
```

Same treatment applied to the View Demo entry inside the mobile `Sheet` menu.

### Files touched

| File | Change |
|---|---|
| `src/routes/p.$slug.index.tsx` | Header: swap small pill for the hero pill, tint with `hud_bg_color`+alpha, set Demo CTA bg to `accent_color`. Hero: remove brand chip block. |

No DB, no new components, no other files.

### Acceptance check
1. Only one brand pill visible at any scroll position.
2. Header background takes on the MSP's HUD color (e.g., dark navy) with visible blur over the hero image.
3. View Demo button is filled with the MSP's accent color.
4. Header text/icons remain legible on dark HUD colors.
5. Mobile sheet still works; demo entry uses accent color.

