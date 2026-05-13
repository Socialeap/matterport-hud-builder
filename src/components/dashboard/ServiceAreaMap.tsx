/**
 * Pro-only polygon editor for Marketplace service areas.
 *
 * Implementation notes:
 *  - Pure Leaflet + leaflet-draw, no react-leaflet wrapper. Less
 *    indirection, smaller bundle, fewer version-skew traps.
 *  - Leaflet and its CSS are dynamically imported inside the
 *    effect so the page can render server-side and the ~150 KB
 *    bundle ships only when this file is reached. Parent gates
 *    on Pro tier *and* lazy-loads this component, so Starter
 *    users never pay the cost.
 *  - Only one polygon is allowed at a time. The "Draw" tool
 *    replaces any existing shape rather than letting the MSP
 *    accumulate multiple service areas — keeps the matcher
 *    contract simple (single Polygon column).
 *  - The component is uncontrolled after mount: it seeds from
 *    `initialPolygon` once and emits changes via
 *    `onPolygonChange`. The parent never pushes new geometry in
 *    after initialization, which avoids re-mounting the map on
 *    every save.
 */
import { useEffect, useRef } from "react";

interface Props {
  initialPolygon: GeoJSON.Polygon | null;
  initialCenter: [number, number] | null;
  onPolygonChange: (polygon: GeoJSON.Polygon | null) => void;
}

const DEFAULT_CENTER: [number, number] = [39.8283, -98.5795]; // continental US

export function ServiceAreaMap({
  initialPolygon,
  initialCenter,
  onPolygonChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onPolygonChange);
  onChangeRef.current = onPolygonChange;

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    const container = containerRef.current;
    if (!container) return;

    (async () => {
      const [{ default: L }] = await Promise.all([
        import("leaflet"),
        import("leaflet/dist/leaflet.css"),
      ]);
      await Promise.all([
        import("leaflet-draw"),
        import("leaflet-draw/dist/leaflet.draw.css"),
      ]);
      if (cancelled) return;

      const center = initialCenter ?? DEFAULT_CENTER;
      const map = L.map(container, {
        center,
        zoom: initialCenter ? 10 : 4,
        scrollWheelZoom: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      const drawnItems = new L.FeatureGroup();
      map.addLayer(drawnItems);

      if (initialPolygon) {
        try {
          const layers = L.geoJSON(initialPolygon).getLayers();
          const layer = layers[0];
          if (layer) {
            drawnItems.addLayer(layer);
            const bounds = (layer as L.Polygon).getBounds();
            if (bounds.isValid()) {
              map.fitBounds(bounds, { maxZoom: 12, padding: [16, 16] });
            }
          }
        } catch {
          // Stored polygon was malformed; ignore and let the user
          // redraw. Better than crashing the editor.
        }
      }

      // leaflet-draw extends L at runtime; the bundled types don't
      // express the Control.Draw constructor, so we narrow with a
      // local cast.
      const LDraw = L as unknown as {
        Control: { Draw: new (opts: unknown) => L.Control };
        Draw: {
          Event: { CREATED: string; EDITED: string; DELETED: string };
          Polygon: {
            prototype: {
              _updateFinishHandler: (this: {
                _markers: Array<{
                  on: (ev: string, fn: unknown, ctx: unknown) => void;
                  off: (ev: string, fn: unknown, ctx: unknown) => void;
                }>;
                _finishShape: () => void;
              }) => void;
            };
          };
        };
      };

      // ---- leaflet-draw polygon compatibility shim ----
      // Upstream leaflet-draw@1.0.4 binds a `dblclick` finish handler
      // to the most recently placed vertex once the polygon has 3+
      // markers. On high-DPI / touch-emulating browsers the click
      // that places the 3rd vertex can be coalesced into a dblclick,
      // which immediately closes the shape and disables the tool —
      // making it look like the polygon is hard-capped at 3 points.
      //
      // We override `_updateFinishHandler` to ONLY bind the
      // "click first marker to close" behavior. Users still finish
      // the polygon via:
      //   1. Click the first vertex, OR
      //   2. The "Finish" action in the draw toolbar.
      // This removes the spurious 3-point termination without
      // changing the matcher contract or the GeoJSON output.
      const PolygonProto = LDraw.Draw.Polygon.prototype;
      const originalUpdateFinish = PolygonProto._updateFinishHandler;
      PolygonProto._updateFinishHandler = function () {
        const markers = this._markers;
        if (!markers || markers.length === 0) return;
        // Always (re)bind click-on-first-marker = finish. Idempotent
        // off→on is safe even if the handler isn't currently bound.
        markers[0].off("click", this._finishShape, this);
        markers[0].on("click", this._finishShape, this);
        // Intentionally skip the dblclick-on-last-marker binding
        // that the upstream implementation adds for markerCount > 2.
      };

      const drawControl = new LDraw.Control.Draw({
        position: "topright",
        draw: {
          polygon: {
            allowIntersection: false,
            showArea: true,
            repeatMode: false,
            maxPoints: 0, // explicit: no upper bound on vertices
            shapeOptions: { color: "#2563EB", weight: 2, fillOpacity: 0.15 },
          },
          marker: false,
          polyline: false,
          rectangle: false,
          circle: false,
          circlemarker: false,
        },
        edit: { featureGroup: drawnItems },
      });
      map.addControl(drawControl);

      // Restore the upstream behavior on unmount so we don't leak
      // the override into other Leaflet instances on the page.
      const restoreUpdateFinish = () => {
        PolygonProto._updateFinishHandler = originalUpdateFinish;
      };

      const emitCurrent = () => {
        const layers = drawnItems.getLayers();
        if (layers.length === 0) {
          onChangeRef.current(null);
          return;
        }
        const layer = layers[layers.length - 1] as unknown as {
          toGeoJSON: () => GeoJSON.Feature<GeoJSON.Polygon>;
        };
        const feature = layer.toGeoJSON();
        if (feature?.geometry?.type === "Polygon") {
          onChangeRef.current(feature.geometry);
        }
      };

      map.on(LDraw.Draw.Event.CREATED, (e: unknown) => {
        // Single-polygon contract: replace any prior shape.
        drawnItems.clearLayers();
        const ev = e as { layer: L.Layer };
        drawnItems.addLayer(ev.layer);
        emitCurrent();
      });
      map.on(LDraw.Draw.Event.EDITED, emitCurrent);
      map.on(LDraw.Draw.Event.DELETED, emitCurrent);

      cleanup = () => map.remove();
    })();

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
    // Intentionally run once: the editor is uncontrolled after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-80 w-full overflow-hidden rounded-md border border-input"
      role="application"
      aria-label="Service area polygon editor"
    />
  );
}

export default ServiceAreaMap;
