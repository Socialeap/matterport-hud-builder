## Problem
The polygon editor captures geometry but gives no visible confirmation that (1) the area was registered, (2) it's been saved, or (3) it's what will appear in the MSP Directory. The Finish button exists only during drawing mode, so once a user finishes there's no signal anything happened.

## Changes

**`src/components/dashboard/ServiceAreaMap.tsx`**
- Add a live status badge next to the controls:
  - Idle: "No service area set"
  - Drawing: "Drawing… N points"
  - Editing: "Service area captured · N points · ~X sq mi"
- Fire `toast.success(...)` on finish, `toast(...)` on clear.
- Compute approximate area (spherical polygon, sq mi) for the badge so users can sanity-check the size.
- Rename idle button to "Draw service area" for clarity. Keep Finish / Cancel / Clear behavior unchanged.

**`src/routes/_authenticated.dashboard.branding.tsx`**
- Add a confirmation block below the map:
  - "Service area is live in the MSP Directory" when current polygon matches the last-saved value
  - "Service area ready to save" when polygon is set but form is dirty
  - "No service area defined yet" otherwise
- After a successful Save Branding submit, toast "Service area updated in MSP Directory."
- Update helper text: "Click **Finish** (or double-click the map / click your first point) to capture the area, then click **Save Branding** to publish it to the Directory."

## Out of scope
- Matcher, geocoder, and DB schema unchanged.
- No redesign of map controls beyond the additions above.

## Technical notes
- Area: spherical-excess formula on the polygon ring, rounded to whole sq mi.
- Live-in-directory check: shallow GeoJSON compare against the value loaded at form mount; flips to "ready to save" on any edit.
- Toasts use the existing `sonner` Toaster already mounted in the root layout.
