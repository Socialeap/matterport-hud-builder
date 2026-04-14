

## Plan: Dark Mode Landing Page with Grid + Organic Orb Background

### Design Direction
Force the landing page into dark mode with a deep navy base, a subtle CSS notebook grid overlay, and several large translucent radial-gradient "orbs" scattered across the page for an organic, atmospheric feel — inspired by the reference image.

### Changes

**1. Force dark theme on landing page (`src/routes/index.tsx`)**
- Wrap the entire page in a `div` with the `dark` class so all semantic color tokens (bg-background, text-foreground, etc.) automatically flip to their dark values
- Set the outermost container background to a deep navy (`bg-[#0a0e27]` or similar) as the base layer

**2. Add notebook grid overlay (CSS in `src/routes/index.tsx`)**
- Add a full-page `position: fixed` or `absolute` div with a repeating CSS linear-gradient grid pattern
- Grid lines: very faint (`opacity-[0.06]` to `opacity-[0.08]`), thin (1px), in a lighter blue tone
- Grid cell size: ~60-80px for the major grid, optionally a finer 20px sub-grid at even lower opacity

**3. Add dispersed translucent orbs**
- 4-6 absolutely positioned divs with large radial gradients in blues/indigos/teals
- Heavily blurred (`blur-[120px]` to `blur-[200px]`) and very low opacity (`opacity-[0.15]` to `opacity-[0.25]`)
- Scattered at different positions across the page (top-left, center-right, bottom-left, etc.)
- These replace or supplement the existing single gradient accent blob at the top

**4. Adjust section backgrounds for dark context**
- Problem section: change `bg-destructive/5` to a slightly lighter dark surface (e.g., `bg-white/[0.02]`)
- Features section: change `bg-muted/30` and `border-t` to dark-appropriate variants
- Cards: ensure `bg-card/80 backdrop-blur` renders well on dark — may tweak to `bg-white/5`
- Pricing cards, footer — all inherit dark tokens naturally from the `.dark` wrapper

**5. No changes to `src/styles.css`**
- The `.dark` color tokens are already defined — we just force the dark class on the landing page container

### Technical Notes
- Only the landing page (`/`) gets forced dark mode; the dashboard and auth pages remain unchanged
- The grid and orbs are purely decorative CSS — no images, no dependencies
- All existing semantic color classes (`text-foreground`, `bg-card`, etc.) will automatically use their dark values inside the `.dark` wrapper

