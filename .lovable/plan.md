## Goal
Let you visually drag the circular logo placeholder on the Calling Card front to its perfect spot, read out the exact coordinates, then bake those numbers into the component as the new permanent values.

## Approach

### Step 1 — Add a temporary "Position Logo" mode (dev-only UI)
In `CallingCardSection.tsx` (the branding dashboard preview), add a small toggle button labeled **"Adjust logo position"** that appears only above the live card preview. When enabled:

- The logo overlay on `CallingCard` becomes draggable via mouse/touch.
- A small floating readout in the corner of the card shows the live values:
  - `left: XX.XX%`
  - `top: XX.XX%`
  - `width: XX.XX%` (with `+ / –` buttons to nudge size in 0.5% steps)
- Arrow keys nudge position in 0.1% steps for fine alignment.
- A **"Copy coordinates"** button copies the three numbers to your clipboard.

This mode is purely a positioning aid — it does NOT persist to the database. It only updates the local preview so you can see the result immediately.

### Step 2 — Wire the override into `CallingCard`
Extend `CallingCard` with an optional `logoPlacement?: { left: number; top: number; width: number }` prop. When provided, it overrides the current hardcoded `71% / 63% / 28%` constants. When omitted (the published `card.$slug` route, embeds, etc.), the component falls back to whatever the hardcoded defaults are at that moment.

This means the public card never changes behavior during the tuning session — only your dashboard preview reflects the live drag.

### Step 3 — You drag, I hardcode
Once you've positioned it, paste the three numbers back to me (or just tell me "lock it in"). I'll then:

1. Replace the hardcoded `left: "71%"`, `top: "63%"`, `width: "28%"` in `CardFront` inside `CallingCard.tsx` with your final values.
2. Remove the `logoPlacement` prop, the "Adjust logo position" toggle, the drag handlers, the readout overlay, and the keyboard nudging code.
3. Leave the component back in its clean, production state — just with the new correct coordinates.

## Technical details

- Drag math uses the card's bounding rect; pointer position is converted to percentages of the card's width/height so it remains accurate regardless of preview size.
- Pointer events (`pointerdown` / `pointermove` / `pointerup` with `setPointerCapture`) handle mouse + touch in one path.
- Arrow-key nudging is gated on the overlay being focused, so it doesn't interfere with form inputs elsewhere on the page.
- The readout overlay uses `cqw`-based sizing so it's legible at any preview width.
- No DB migration, no schema change, no new dependencies.

## Files touched (Step 1+2, temporary)
- `src/components/branding/CallingCard.tsx` — accept optional `logoPlacement`, render draggable wrapper when in adjust mode.
- `src/components/branding/CallingCardSection.tsx` — add toggle, local state for live placement, readout + copy button.

## Files touched (Step 3, cleanup)
- `src/components/branding/CallingCard.tsx` — bake final numbers, remove adjust-mode code.
- `src/components/branding/CallingCardSection.tsx` — remove the toggle and readout UI.

## What I need from you after Step 1+2 ships
Just drag the circle into place in the dashboard preview, click **Copy coordinates**, and paste them back. I'll lock them in and tear out the scaffolding.
