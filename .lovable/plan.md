# Restructure "How It Works" Section

## 1. Move section above Pricing

In `src/routes/index.tsx`, cut the `{/* ---- How it works ---- */}` block (lines 859–900) and paste it directly **before** the `{/* ---- Pricing comparison ---- */}` block (currently line 740). The pricing section then immediately follows it.

## 2. Update copy

Replace the four step objects with the new copy:

1. **Claim Your Studio** — "Choose your tier and launch your branded dashboard in seconds."
2. **Brand & Set Pricing** — "Upload your logo and connect your Stripe account. You define the profit margins for every presentation sold."
3. **Invite Your Clients** — "Share your studio link. Clients and agents build, customize, and preview their tour presentations in real-time."
4. **Automated Sales & Delivery** — "Clients pay via Stripe to unlock their downloads. Payments go directly to your Connect account, and the file is delivered instantly."

## 3. Layout: 4-column grid with connecting flow line

Replace the vertical `space-y-8` list with a responsive grid:

- Mobile: single column (stacked)
- `sm`: 2 columns
- `lg`: 4 columns (horizontal flow)

Widen the container from `max-w-3xl` to `max-w-6xl` to accommodate four cards.

Each step becomes a Card-styled tile (matching existing `bg-white/5 backdrop-blur border border-white/10 rounded-xl` aesthetic) with the numbered circle centered at the top, title, and description below.

## 4. Dashed connector line (desktop only)

Render a horizontal dashed line behind the row of number circles, only visible at `lg`. Implementation:

- Wrap the grid in a `relative` container.
- Add an absolutely-positioned dashed line element: `absolute top-[*] left-[12.5%] right-[12.5%] h-px border-t border-dashed border-white/15 hidden lg:block` aligned vertically with the center of the number circles.
- The line sits behind the cards (`-z-10` on the line, or higher z-index on circles via solid background to mask).

## 5. Progressive hover-glow effect

Track `hoveredStep` state (0 = none, 1–4) using `useState<number>(0)`.

- On each card: `onMouseEnter={() => setHoveredStep(item.step)}` and `onMouseLeave={() => setHoveredStep(0)}`.
- Each card receives conditional classes: when `item.step <= hoveredStep`, apply a glowing border + shadow (e.g. `border-amber-300/70 shadow-lg shadow-amber-300/20`); otherwise the default subtle border. Wrap with `transition-all duration-300`.
- The number circle gets a brighter ring when active (`ring-2 ring-amber-300/60`).
- The dashed connector segments between glowing cards also light up: split the single line into 3 segments (between cards 1–2, 2–3, 3–4), each rendered as its own absolutely-positioned div. Segment N glows (e.g. `border-amber-300/60`) when `hoveredStep > N`. Use `transition-colors duration-300`.

## 6. Card hover polish

Beyond the progressive glow, add a base hover lift on every card: `hover:-translate-y-1 transition-transform duration-300` so individual interaction feels responsive.

## 7. Highlight Step 4's "hands-off" nature

Give the Step 4 card a subtle distinguishing accent to underscore automation:

- Add a small badge above the title: `<Badge>Fully Automated</Badge>` (using existing shadcn Badge) with primary/amber styling.
- Optionally swap a small icon (e.g. `Zap` from lucide-react, already likely imported elsewhere) into the number circle area, or keep "4" but add a faint pulsing ring (`animate-pulse` on a ring overlay) to suggest activity.

## Technical notes

- All state, hover handlers, and the connector line live inside the existing route component — no new files needed.
- Use existing Tailwind theme tokens (`amber-300`, `white/10`, `white/60`) for visual consistency with the rest of the page.
- The 4 step objects move from inline array to a `const steps = [...]` declared just above the JSX for readability.
- No new dependencies required.

## Files changed

- `src/routes/index.tsx` (single file edit)
