## Goal

Add concise tooltips to each service in the MSP Directory left-side filter panel on `/agents`, rename "Same-Day Turnaround" → "Two-Day Turnaround", and drop "(Production Vault)" from the Studio Presentation section title.

## Files to change

**1. `src/routes/agents.tsx`**

- Add a `tooltip: string` field to the `FilterOption` type (lines 144–149).
- Populate `tooltip` for each entry in `SCANNING_FILTERS` (lines 152–160) and `STUDIO_FILTERS` (lines 163–170) using the copy below (all under 120 chars).
- Rename the Same-Day entry's `label` to `"Two-Day Turnaround"` (line 159). The enum value `scan-same-day-turnaround` stays — it's an internal identifier, not user-visible, and renaming it would require a destructive enum migration touching `marketplace_specialty`, RLS, existing rows, and the regenerated types file. I recommend leaving it; flag if you want the enum renamed too.
- Update the FilterGroup title on line 708 from `"Studio Presentation (Production Vault)"` → `"Studio Presentation"`.
- Update `FilterGroup` (lines 813–861) to wrap each option label in a shadcn `Tooltip` (already available at `@/components/ui/tooltip`). Mount one `TooltipProvider` at the top of `FilterGroup`. Trigger = the existing `<label>` row; content = `f.tooltip`. Keep checkbox click behavior intact (the tooltip wraps, doesn't replace, the row).
- Add an `Info` icon from lucide-react to the right of each label (before the optional `note`) as a visual affordance that hovering reveals more info, so touch users also get a hint.

**2. Other "Same-Day" surfaces (label-only updates, no enum change)**

- `src/routes/_authenticated.dashboard.branding.tsx` line 43 → `label: "Two-Day Turnaround"`.
- `src/lib/email-templates/marketplace-outreach.tsx` line 107 — the phrase "same-day Matterport scan" is sample marketing copy, not a service label. Leave it alone unless you want it rewritten.
- `supabase/migrations/...` and `src/integrations/supabase/types.ts` — these are the enum source/derived types. No change (see note above).

## Tooltip copy (≤120 chars each)

**On-Site Scanning**
- Matterport Pro3 — High-quality LiDAR scanning for indoor/outdoor 3D tours and high-accuracy spatial data.
- Drone / Aerial — Stunning bird's-eye views to highlight the property's scale, plot, and neighborhood context.
- Twilight Photography — High-end "Golden Hour" hero shots designed to make your listing stop the scroll.
- Walk-through Video Clips — Cinematic, ready-to-post video clips for maximum social media engagement and reach.
- Floor Plans — Professional 2D layouts to help buyers visualize flow, room sizes, and furniture placement.
- Dimensional Measurements — More accurate measurements when precise sizing and dimensions matter.
- Two-Day Turnaround — Get your finalized 3D tour delivered within 48 hrs, not next week.

**Studio Presentation**
- Sound Library — Set the mood with curated background music or upload a voice-over intro over an ambient track.
- Visual Portal Filters — Professional color grading & style filters that enhance the property's "vibe."
- Interactive Widgets — Interactive overlays for info, comparisons, menus, bookmarks, and more. (Coming Soon)
- Custom Iconography — Branded navigation icons for your agency's unique look & feel. (Coming Soon)
- Property Mapper — Upload a detailed PDF with property specs used to train the "Ask About This Property" chat.
- AI Lead Generation — An automated 24/7 assistant to identify and capture buyer leads while you sleep.

## Verification

- Reload `/agents`, hover each filter row in both groups, confirm tooltip appears with correct copy and stays under the trigger.
- Confirm checkbox toggling still works (clicking the row toggles selection; tooltip doesn't block clicks).
- Confirm "Same-Day" no longer appears in the agents page or the dashboard branding page.
- Confirm group title reads "Studio Presentation".

## Open question

Do you want the underlying enum value `scan-same-day-turnaround` also renamed to `scan-two-day-turnaround`? It requires a database migration that rewrites the enum, updates every row that references it, and triggers a regenerated types file. Default in this plan: **no** — labels are user-facing, enum is internal.
