# Reintroduce Mock MSP Cards + "Notify Me" Waitlist on `/agents`

The current `DirectorySection` in `src/routes/agents.tsx` shows an empty state until a visitor searches, then hits the live `search_msp_directory` RPC. Since most markets have zero live Pros today, the directory feels empty. This change adds (a) demo cards, (b) a "Live Directory coming soon" banner, and (c) an always-visible **Notify Me** waitlist form so agents and property managers can be alerted when MSPs activate in their area.

## Changes — `src/routes/agents.tsx` only

### 1. `MOCK_MSPS` constant
Add ~6 fictional MSPs covering both tiers and a mix of cities/states (Atlanta GA, San Diego CA, Chicago IL, Austin TX, Denver CO, Boston MA). Each entry matches the existing `DirectoryMSP` shape; `slug` is `null` so the existing card renders the disabled "Studio coming soon" CTA — no broken links.

Specialties span both groups (scanning + studio) so the filter rail is interactive.

### 2. "Live Directory coming soon" banner
A clearly-marked banner above the demo cards:

```text
┌─────────────────────────────────────────────────────────────┐
│  🛈  Live Directory launching soon                          │
│  The studios below are sample listings shown for           │
│  demonstration. Use the filters to preview how the         │
│  directory will work, then drop your email below to be     │
│  notified the moment Pro Partners activate near you.       │
└─────────────────────────────────────────────────────────────┘
```

Styled to match the dark theme (cyan-300/30 border, cyan-300/5 bg, lucide `Info` icon).

### 3. Always-visible "Notify Me" waitlist form
Reuse the existing `BeaconForm` component (`src/components/marketplace/BeaconForm.tsx`) — it already collects **email, name, brokerage, city, state, ZIP** with consent, posts to the `capture-beacon` Edge Function, and writes to `agent_beacons`. No backend changes needed.

Placement:
- **No search yet** → banner + sample cards grid + `BeaconForm` underneath (heading: *"Notify me when a Pro Partner is live in my area"*).
- **Searched, zero live results** → keep the existing amber "No Pro Partner in {city}" alert + `BeaconForm` (current behavior), and append the demo banner + sample cards below for visualization.
- **Searched, live results found** → real results only, no demo cards or waitlist form.

When the visitor has typed a city/state/ZIP into the search filters but not yet submitted, those values pre-fill `BeaconForm` via its existing `defaultCity` / `defaultRegion` / `defaultZip` props.

### 4. Mark each demo card as a sample
Add an optional `isSample?: boolean` prop to the existing `MSPCard`. When `true`, render a small slate-gray "Sample" pill next to the brand name so visitors can't mistake demo cards for real listings. The CTA stays disabled ("Studio coming soon").

### 5. Filters still work on demo cards
Extract a small `useMemo` so `MOCK_MSPS` is filtered by `selectedSpecialties` exactly the same way live results are — visitors get an immediate sense of how filtering behaves.

## What is NOT changing
- No DB / RPC / migration changes.
- No changes to `BeaconForm` or `capture-beacon` Edge Function — both already do exactly what's needed.
- Live `search_msp_directory` flow unchanged — when real Pros exist for the searched city, demo cards do not appear.
- `MSPCard` styling untouched aside from the optional "Sample" pill.

## Files touched
- `src/routes/agents.tsx` — add `MOCK_MSPS`, banner, render logic, optional `isSample` on `MSPCard`, integrate `BeaconForm` into the demo state.
