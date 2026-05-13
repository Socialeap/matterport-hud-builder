/**
 * Pro-only polygon editor for Marketplace service areas.
 *
 * Custom Leaflet implementation (no leaflet-draw). The upstream
 * leaflet-draw plugin proved unreliable in our embedded context —
 * its pointer/dblclick coalescing terminated polygons at three
 * vertices in multiple browsers regardless of compatibility shims.
 *
 * This editor uses pure Leaflet primitives and a small custom UI:
 *   - "Draw" puts the map in vertex-add mode. Each map click adds
 *     a vertex. There is no upper bound; the polygon is only ever
 *     finalized by an explicit user action.
 *   - "Finish" closes the working polyline into a polygon and
 *     switches to edit mode (vertices become draggable).
 *   - "Clear" removes the current polygon entirely.
 *   - In edit mode, dragging any vertex updates the geometry
 *     and emits the new GeoJSON Polygon.
 *
 * Only one polygon is allowed at a time — drawing a new one
 * replaces the previous one, preserving the matcher contract
 * (single Polygon column / RPC payload).
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, MapPin, Pencil } from "lucide-react";

/**
 * Approximate area of a lat/lng polygon ring in square miles using the
 * spherical excess formula. Ring should be an array of [lng, lat] or
 * Leaflet LatLngs; we pass LatLngs from the editor below.
 */
function polygonAreaSqMi(latlngs: { lat: number; lng: number }[]): number {
  if (latlngs.length < 3) return 0;
  const R = 6378137; // earth radius (m)
  const toRad = (d: number) => (d * Math.PI) / 180;
  let area = 0;
  for (let i = 0; i < latlngs.length; i++) {
    const p1 = latlngs[i];
    const p2 = latlngs[(i + 1) % latlngs.length];
    area +=
      toRad(p2.lng - p1.lng) *
      (2 + Math.sin(toRad(p1.lat)) + Math.sin(toRad(p2.lat)));
  }
  area = Math.abs((area * R * R) / 2); // m²
  const sqMi = area / 2_589_988.11;
  return Math.round(sqMi);
}

interface Props {
  initialPolygon: GeoJSON.Polygon | null;
  initialCenter: [number, number] | null;
  onPolygonChange: (polygon: GeoJSON.Polygon | null) => void;
}

const DEFAULT_CENTER: [number, number] = [39.8283, -98.5795]; // continental US
const POLY_STYLE = { color: "#2563EB", weight: 2, fillOpacity: 0.15 };

type LeafletNS = typeof import("leaflet");
type Mode = "idle" | "drawing" | "editing";

export function ServiceAreaMap({
  initialPolygon,
  initialCenter,
  onPolygonChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onPolygonChange);
  onChangeRef.current = onPolygonChange;

  const LRef = useRef<LeafletNS | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  // Working polyline (drawing mode) + its vertex markers.
  const drawLineRef = useRef<import("leaflet").Polyline | null>(null);
  const drawMarkersRef = useRef<import("leaflet").Marker[]>([]);
  const drawLatLngsRef = useRef<import("leaflet").LatLng[]>([]);
  // Finalized polygon (editing mode) + its draggable vertex markers.
  const polygonRef = useRef<import("leaflet").Polygon | null>(null);
  const editMarkersRef = useRef<import("leaflet").Marker[]>([]);

  const [mode, setMode] = useState<Mode>("idle");
  const [vertexCount, setVertexCount] = useState(0);
  const [hasPolygon, setHasPolygon] = useState(false);
  const [areaSqMi, setAreaSqMi] = useState(0);
  const [polyVertexCount, setPolyVertexCount] = useState(0);

  const recomputeStats = () => {
    const poly = polygonRef.current;
    if (!poly) {
      setAreaSqMi(0);
      setPolyVertexCount(0);
      return;
    }
    const ring = (poly.getLatLngs()[0] as { lat: number; lng: number }[]) ?? [];
    setPolyVertexCount(ring.length);
    setAreaSqMi(polygonAreaSqMi(ring));
  };

  // ---- helpers (defined inside effect closure via refs) ----
  const helpersRef = useRef<{
    startDrawing: () => void;
    finishDrawing: () => void;
    clearAll: () => void;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    (async () => {
      const [{ default: L }] = await Promise.all([
        import("leaflet"),
        import("leaflet/dist/leaflet.css"),
      ]);
      if (cancelled) return;

      LRef.current = L;
      const center = initialCenter ?? DEFAULT_CENTER;
      const map = L.map(container, {
        center,
        zoom: initialCenter ? 10 : 4,
        scrollWheelZoom: true,
        doubleClickZoom: false, // we use dblclick to finish drawing
      });
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      // Small numbered/round vertex marker. divIcon avoids the
      // default marker image asset that Leaflet otherwise tries
      // to resolve from a relative URL.
      const vertexIcon = (color: string) =>
        L.divIcon({
          className: "service-area-vertex",
          html: `<span style="display:block;width:12px;height:12px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.3);"></span>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        });

      const emitPolygon = () => {
        const poly = polygonRef.current;
        if (!poly) {
          onChangeRef.current(null);
          return;
        }
        const feature = poly.toGeoJSON() as GeoJSON.Feature<GeoJSON.Polygon>;
        if (feature?.geometry?.type === "Polygon") {
          onChangeRef.current(feature.geometry);
        }
      };

      const removeDrawing = () => {
        if (drawLineRef.current) {
          map.removeLayer(drawLineRef.current);
          drawLineRef.current = null;
        }
        for (const m of drawMarkersRef.current) map.removeLayer(m);
        drawMarkersRef.current = [];
        drawLatLngsRef.current = [];
      };

      const removePolygon = () => {
        if (polygonRef.current) {
          map.removeLayer(polygonRef.current);
          polygonRef.current = null;
        }
        for (const m of editMarkersRef.current) map.removeLayer(m);
        editMarkersRef.current = [];
      };

      const refreshDrawLine = () => {
        const latlngs = drawLatLngsRef.current;
        if (!drawLineRef.current) {
          drawLineRef.current = L.polyline(latlngs, {
            ...POLY_STYLE,
            dashArray: "4 4",
          }).addTo(map);
        } else {
          drawLineRef.current.setLatLngs(latlngs);
        }
        setVertexCount(latlngs.length);
      };

      const onMapClick = (e: import("leaflet").LeafletMouseEvent) => {
        // Only react in drawing mode.
        if (mapRef.current?.getContainer().dataset.mode !== "drawing") return;
        const latlng = e.latlng;
        drawLatLngsRef.current.push(latlng);
        const idx = drawLatLngsRef.current.length - 1;
        const marker = L.marker(latlng, {
          icon: vertexIcon("#2563EB"),
          draggable: false,
          keyboard: false,
        }).addTo(map);
        // Click on first marker = finish.
        if (idx === 0) {
          marker.on("click", (ev) => {
            // Stop the click from bubbling and adding a duplicate vertex.
            (ev.originalEvent as MouseEvent | undefined)?.stopPropagation?.();
            helpersRef.current?.finishDrawing();
          });
        }
        drawMarkersRef.current.push(marker);
        refreshDrawLine();
      };

      const onMapDblClick = () => {
        if (mapRef.current?.getContainer().dataset.mode !== "drawing") return;
        helpersRef.current?.finishDrawing();
      };

      map.on("click", onMapClick);
      map.on("dblclick", onMapDblClick);

      const buildEditMarkers = () => {
        const poly = polygonRef.current;
        if (!poly) return;
        for (const m of editMarkersRef.current) map.removeLayer(m);
        editMarkersRef.current = [];
        const ring = (poly.getLatLngs()[0] as import("leaflet").LatLng[]) ?? [];
        ring.forEach((latlng, i) => {
          const marker = L.marker(latlng, {
            icon: vertexIcon("#1d4ed8"),
            draggable: true,
            keyboard: false,
          }).addTo(map);
          marker.on("drag", () => {
            const updated = editMarkersRef.current.map((mm) => mm.getLatLng());
            poly.setLatLngs([updated]);
          });
          marker.on("dragend", () => {
            const updated = editMarkersRef.current.map((mm) => mm.getLatLng());
            poly.setLatLngs([updated]);
            emitPolygon();
          });
          // Right-click a vertex to delete it (min 3 retained).
          marker.on("contextmenu", (ev) => {
            (ev.originalEvent as MouseEvent | undefined)?.preventDefault?.();
            if (editMarkersRef.current.length <= 3) return;
            map.removeLayer(marker);
            editMarkersRef.current.splice(i, 1);
            const updated = editMarkersRef.current.map((mm) => mm.getLatLng());
            poly.setLatLngs([updated]);
            // Rebuild so indices stay correct.
            buildEditMarkers();
            emitPolygon();
          });
          editMarkersRef.current.push(marker);
        });
      };

      const finalizeFromLatLngs = (latlngs: import("leaflet").LatLng[]) => {
        if (latlngs.length < 3) return false;
        removePolygon();
        polygonRef.current = L.polygon(latlngs, POLY_STYLE).addTo(map);
        buildEditMarkers();
        setHasPolygon(true);
        emitPolygon();
        return true;
      };

      helpersRef.current = {
        startDrawing: () => {
          removePolygon();
          removeDrawing();
          setHasPolygon(false);
          map.getContainer().dataset.mode = "drawing";
          map.getContainer().style.cursor = "crosshair";
          setMode("drawing");
        },
        finishDrawing: () => {
          const ok = finalizeFromLatLngs([...drawLatLngsRef.current]);
          removeDrawing();
          map.getContainer().dataset.mode = ok ? "editing" : "idle";
          map.getContainer().style.cursor = "";
          setMode(ok ? "editing" : "idle");
        },
        clearAll: () => {
          removeDrawing();
          removePolygon();
          setHasPolygon(false);
          map.getContainer().dataset.mode = "idle";
          map.getContainer().style.cursor = "";
          setMode("idle");
          onChangeRef.current(null);
        },
      };

      // Seed from saved polygon, if any.
      if (initialPolygon) {
        try {
          const ring = initialPolygon.coordinates?.[0];
          if (Array.isArray(ring) && ring.length >= 3) {
            const latlngs = ring
              .filter((c) => Array.isArray(c) && c.length >= 2)
              .map((c) => L.latLng(c[1] as number, c[0] as number));
            // Drop trailing closing point if present.
            if (
              latlngs.length > 1 &&
              latlngs[0].lat === latlngs[latlngs.length - 1].lat &&
              latlngs[0].lng === latlngs[latlngs.length - 1].lng
            ) {
              latlngs.pop();
            }
            if (latlngs.length >= 3) {
              polygonRef.current = L.polygon(latlngs, POLY_STYLE).addTo(map);
              buildEditMarkers();
              setHasPolygon(true);
              setMode("editing");
              map.getContainer().dataset.mode = "editing";
              const bounds = polygonRef.current.getBounds();
              if (bounds.isValid()) {
                map.fitBounds(bounds, { maxZoom: 12, padding: [16, 16] });
              }
            }
          }
        } catch {
          // Malformed stored polygon — ignore and let the user redraw.
        }
      }
    })();

    return () => {
      cancelled = true;
      const map = mapRef.current;
      if (map) {
        map.off();
        map.remove();
      }
      mapRef.current = null;
      LRef.current = null;
      drawLineRef.current = null;
      drawMarkersRef.current = [];
      drawLatLngsRef.current = [];
      polygonRef.current = null;
      editMarkersRef.current = [];
      helpersRef.current = null;
    };
    // Intentionally run once: editor is uncontrolled after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {mode !== "drawing" ? (
          <Button
            type="button"
            size="sm"
            variant="default"
            onClick={() => helpersRef.current?.startDrawing()}
          >
            {hasPolygon ? "Redraw polygon" : "Draw polygon"}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={vertexCount < 3}
              onClick={() => helpersRef.current?.finishDrawing()}
            >
              Finish ({vertexCount} {vertexCount === 1 ? "point" : "points"})
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => helpersRef.current?.clearAll()}
            >
              Cancel
            </Button>
          </>
        )}
        {hasPolygon && mode !== "drawing" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => helpersRef.current?.clearAll()}
          >
            Clear
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          {mode === "drawing"
            ? "Click the map to add boundary points. Click the first point or double-click to finish."
            : hasPolygon
            ? "Drag any vertex to adjust. Right-click a vertex to remove it."
            : "Click \u201CDraw polygon\u201D, then click on the map to outline your service area."}
        </span>
      </div>
      <div
        ref={containerRef}
        className="h-80 w-full overflow-hidden rounded-md border border-input"
        role="application"
        aria-label="Service area polygon editor"
      />
    </div>
  );
}

export default ServiceAreaMap;
