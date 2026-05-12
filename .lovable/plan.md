## Fix: Service Area tab is dead when Marketplace Listing is off

### Root cause
In `src/routes/_authenticated.dashboard.branding.tsx`, the `TabsTrigger` for `value="area"` is hard-disabled whenever `branding.is_directory_public` is `false`. The tab content also short-circuits with `branding.is_directory_public ? (...editor...) : null`. Result: a permanently grayed-out tab with no actionable path, and users can't pre-configure their service radius / polygon before going live.

### Tab purpose (for context)
Controls how the marketplace matcher assigns inbound agent leads to your studio:
- **Service Radius (miles)** — fallback radius (Starter + Pro)
- **Custom Polygon** — exact-shape match, Pro-only, drawn with the lazy-loaded Leaflet editor (`ServiceAreaMap`)

These values are only *consumed* by the matcher when `is_directory_public = true`, so gating them was an attempt to avoid "knobs with no effect" — but it backfired UX-wise.

### Changes (UI/presentation only — no business logic, no schema, no matcher changes)

**File:** `src/routes/_authenticated.dashboard.branding.tsx`

1. **Un-disable the tab trigger** (line ~552–559)
   - Remove `disabled={!branding.is_directory_public}` and the conditional `title`.
   - Keep label "Service Area" with same `text-xs sm:text-sm` styling so the 6-col grid stays balanced.

2. **Replace the `branding.is_directory_public ? (...) : null` gate** in the `TabsContent value="area"` block (line ~1019–1020) with an always-rendered `<Card>`. Inside the `CardContent`, prepend a conditional banner shown only when `!branding.is_directory_public`:
   ```
   ┌──────────────────────────────────────────────┐
   │ ⓘ Marketplace Listing is off                 │
   │ These settings only take effect once your    │
   │ studio is listed. You can configure them now │
   │ and publish later.                           │
   │            [ Go to Marketplace tab ]         │
   └──────────────────────────────────────────────┘
   ```
   - Use the existing dashed-primary banner pattern already used at line ~1010 for visual consistency.
   - The button uses local React state to switch the active tab. To support that, lift `Tabs` from uncontrolled (`defaultValue`) to controlled (`value` + `onValueChange`) with a `useState<string>("identity")`. This is a minimal, contained refactor.

3. **Leave the rest of the area-tab body unchanged**: Service Radius input, Pro polygon editor (with its existing `Lock` icon and Starter upgrade CTA) all render exactly as today. The matcher still ignores the values until `is_directory_public` flips on, so there is zero behavioral risk.

### Out of scope
- No changes to `is_directory_public` save semantics, geocoding, polygon RPC, marketplace matcher edge function, RLS, or schema.
- No changes to `CallingCard.tsx`, `CallingCardSection.tsx`, `ServiceAreaMap.tsx`.
- No tab reordering, label changes, or container-width changes.

### Verification
- Open `/dashboard/branding` with Marketplace Listing **off** → Service Area tab is clickable, shows the banner + radius input + (Pro) polygon editor or (Starter) upgrade CTA.
- Click "Go to Marketplace tab" → switches to Marketplace tab; toggling on Marketplace Listing and returning to Service Area hides the banner.
- Open with Marketplace Listing **on** → identical to today (no banner, full editor).
- Confirm 6-tab grid layout still fits at 922px viewport.
