# Redesign Light Mode: Claude-Inspired Clean Layout

## What's Changing

Replace the current light mode (off-white with dark hero overlay) with a clean, modern SaaS aesthetic inspired by the reference screenshot. Keep dark mode as-is. The light mode will use a dark background (matching the reference's charcoal/dark gray) with subtle architectural gridlines and cloudy translucent orbs for organic contrast.

Looking at the reference screenshot more carefully: it's actually a **dark-themed** design (dark charcoal background, light text) — not a traditional "light mode." The user wants to replace the current broken light mode with this refined dark aesthetic that has cleaner typography hierarchy and a browser-framed product screenshot instead of the muddy hero image overlay.

## Key Design Changes

### 1. Hero Section — Complete Restructure

- **Remove** the full-bleed hero image with dark overlay approach
- **New layout**: Clean centered text on the page background (no image behind text)
  - Small pill badge: "No subscriptions. Ever."
  - Large headline: "Your own studio for clients to custom brand their 3D Tour presentations" 
  - Muted subheadline: "Give clients a space to build, customize, and download presentations they fully own."
  - CTA:  "Try our demo" Button navigates to pricing cards.
- **Below the CTA**: The hero HUD image placed inside a **browser chrome frame** (macOS-style with traffic light dots, URL bar showing "your-studio.com/tour/brickell-tower") — this is the "window into the product" pattern from the reference

### 2. "Light" Mode Theme Tokens

- Background: dark charcoal (`#1a1a1a` / `#1c1c1e`) instead of the broken `#f0ede6`
- Keep subtle gridlines (architectural floor-plan vibe) with lighter opacity
- Keep cloudy translucent orbs but with muted, warm tones for organic contrast
- Cards: slightly lighter dark (`bg-white/5` similar to current dark mode)
- Text: white/light gray hierarchy

### 3. Typography Hierarchy Fix

- Headline: ~44-52px, medium/bold weight, `tracking-tight`
- Subheadline: ~16px, muted secondary color
- Clear visual separation between levels

### 4. Browser Chrome Frame Component

- Create a reusable `BrowserFrame` wrapper with:
  - Dark rounded-rect container
  - Traffic light dots (red/yellow/green)
  - URL bar with placeholder text
  - The hero HUD image rendered inside

## Files Changed


| File                   | Change                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `src/routes/index.tsx` | Restructure hero section, update light mode tokens, add browser frame, update copy |


## Technical Details

- The `isDark` toggle remains but light mode now uses the Claude-inspired dark-charcoal aesthetic
- Hero section becomes: badge → headline → subheadline → CTA → browser-framed screenshot (sequential, no overlay)
- Grid overlay stays in both modes with adjusted opacity
- Orbs render in both modes (currently dark-only) with subtler colors in light mode
- All other sections (Problem, Features, Pricing, How It Works, Footer) adapt with the same token pattern