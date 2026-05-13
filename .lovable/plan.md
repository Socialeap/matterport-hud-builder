## Diagnosis

The polygon tool is not intentionally limited to three points.

Current findings:
- The app uses `leaflet@1.9.4` and `leaflet-draw@1.0.4`.
- `leaflet-draw@1.0.4` is still the latest official npm release.
- The library default for polylines/polygons is `maxPoints: 0`, meaning no point limit.
- Our `ServiceAreaMap` config does not set `maxPoints`, so we are not deliberately capping the polygon.
- The docs confirm polygons inherit `addVertex()` and `completeShape()` from `L.Draw.Polyline`, and a polygon is only considered valid once it has at least 3 markers.

The likely cause is a known `leaflet-draw` touch/pointer compatibility issue: on touch-capable browsers or high-DPI environments, the library can treat the same click/tap that creates the third valid vertex as a finish/close event. After that, drawing mode ends, so no additional vertices can be added. This matches the reported behavior exactly.

## Safest fix

Patch only `src/components/dashboard/ServiceAreaMap.tsx` with a small compatibility shim after `leaflet-draw` loads and before the draw control is created.

1. Keep the existing library versions.
   - No dependency churn.
   - `leaflet-draw` has no newer official npm release to upgrade to.

2. Explicitly set polygon drawing options for our use case:
   - `maxPoints: 0` to make the unlimited-point intent explicit.
   - `repeatMode: false` to keep the existing single-polygon workflow.
   - Preserve `allowIntersection: false`, `showArea: true`, and existing visual styling.

3. Add a local compatibility override for polygon finish behavior:
   - Require finishing by clicking/tapping the first vertex or using the toolbar Finish action.
   - Prevent the third point from being treated as an automatic finish.
   - Keep double-click finish available only when it does not interfere with normal vertex placement.

4. Improve the helper copy under the map:
   - Clarify that users can keep clicking to add more boundary points.
   - Clarify how to finish: click the first point or use Finish.

## Validation path

After implementation:
- Inspect the patched component for JSX/import/type correctness.
- Verify no backend, matcher, RPC, RLS, save semantics, tier logic, or database schema is changed.
- Confirm the map still emits one GeoJSON Polygon through `onPolygonChange` and still replaces the previous polygon when a new one is completed.

## Files to change

- `src/components/dashboard/ServiceAreaMap.tsx`
- `src/routes/_authenticated.dashboard.branding.tsx` only for the map instruction text, if needed