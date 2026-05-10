# Portal Header Polish

The screenshot is the public Studio portal header (rendered at `/p/$slug` and previewed inside the MSP `/dashboard/branding` page). Two issues:

1. Header CTAs ("View Demo", "Sign In") wrap because they use fixed padding and the brand pill on the left consumes too much horizontal space at mid widths.
2. The MSP brand on the left sits inside a translucent pill/border. The pill treatment should be reserved for the **signed-in client** profile chip (top-right) only.

## Changes

### 1. `src/routes/p.$slug.index.tsx` — `PortalHeader` (≈ lines 793–997)

Brand block (left):
- Remove the pill wrapper styling (`h-11`, `rounded-full`, `border border-white/25`, `bg-white/15`, `px-3 pr-4`, `shadow-sm`, `backdrop-blur-md`).
- Keep just the logo + brand name in a flex row with `gap-2`/`gap-3`.
- Add `whitespace-nowrap` to the brand text so it never wraps.

Responsive sizing for CTAs and nav:
- "View Demo" pill: switch padding to `px-3 py-1.5 md:px-4 md:py-2`, text to `text-xs md:text-sm`, add `whitespace-nowrap`. Hide arrow glyph on small.
- "Sign In" button: same scale-down (`h-8 md:h-9`, `px-3 md:px-4`, `text-xs md:text-sm`, `whitespace-nowrap`).
- Nav links + Builder link: `text-xs md:text-sm`, container `gap-3 md:gap-6`, add `whitespace-nowrap`.
- Raise the desktop nav breakpoint from `sm:` to `md:` (mobile sheet from `sm:hidden` to `md:hidden`) so the cramped 640–768 px range uses the hamburger menu instead of a wrapped row.
- Tighten outer container gap: `gap-2 md:gap-4`.

Profile chip (signed-in viewer) — unchanged. This is the pill the user wants to keep.

### 2. `src/components/portal/HudBuilderSandbox.tsx` (≈ lines 1595–1616)

Remove the same pill treatment from the MSP brand block in the builder header (`rounded-full border border-border bg-muted/40 px-2 pr-4 shadow-sm` → just a flex row with `gap-2`). Brand name keeps `whitespace-nowrap`.

### 3. Verification

After edits, screenshot `/p/{slug}` at viewport widths 1392, 1024, and 768 to confirm: no text wrap inside buttons, brand logo/name floats freely with no border, signed-in client profile chip on the right still uses its pill style.

No business-logic, data, or routing changes — purely presentational.
