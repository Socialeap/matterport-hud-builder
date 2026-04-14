## Plan: Add "The 'Service Trap' of Traditional 3D Presentations" Section After Hero

Insert a new section between the hero (ends line 343) and the features grid (starts line 345) with problem-focused cards. Use a slightly darker or contrasting background color for this section to make it feel like a "problem/solution" bridge before moving into the features.

### Cards Breakdown

The copy will be split into 4 cards:

1. **"You Do the Work, They Get Paid"** — Monthly subscriptions to keep assets online; you're doing manual labor on their servers.
2. **"Every Change Goes Through You"** — MLS-compliant versions, music changes — you have to log in and do the work every time.
3. **"A Bottleneck You Don't Own"** — You're an unpaid administrator for a company you don't own; it drains your time and limits your growth.
4. **"Paying for Tools You Never Use" -** Including complex 'bloatware' like IoT data and rarely used features like graphical overlays and sectional audio.   


### Visual Design

- Section with a subtle background differentiation (no border-t, use a slightly tinted bg)
- Section heading: something like "The 'Service Trap' of Traditional 3D Presentation Platforms"
- 4 cards in a responsive grid (for desktop and mobile)
- Each card gets a red/destructive-tinted icon (e.g., Lock, Clock, DollarSign from lucide) to reinforce the "pain point" theme
- Cards use the existing `Card`/`CardContent` components for consistency

### Technical Details

- **File**: `src/routes/index.tsx`
- Insert ~40 lines of JSX between lines 343 and 345
- Add `Lock`, `Clock`, `DollarSign` to the existing lucide-react import
- No new dependencies or files needed