/**
 * Interactive SVG floor-map types and runtime constants.
 *
 * Shared between the Builder UI (where pins are placed) and the
 * standalone exported HTML (where pins are rendered as absolutely
 * positioned overlays on the embedded SVG).
 *
 * Pin coordinates are stored as percentages of the SVG's viewBox so
 * the map can stretch/shrink to fit any container without drifting
 * — provided `preserveAspectRatio="xMidYMid meet"` stays on the
 * SVG (the vectorize-floorplan Edge Function always emits it).
 */

export interface FloorMapPin {
  /** Stable client-side id (UUID); used as React key + DOM id. */
  id: string;
  /** Horizontal position as a percentage [0..100] of the SVG viewBox. */
  x: number;
  /** Vertical position as a percentage [0..100] of the SVG viewBox. */
  y: number;
  /** Short label shown on the pin and at the top of the popover. */
  label: string;
  /** Long-form description shown inside the popover body. */
  description: string;
}

export interface FloorMapData {
  /** Raw SVG XML string returned by the vectorize-floorplan Edge Function. */
  svg: string;
  /** SVG viewBox string, e.g. "0 0 1024 768". */
  viewBox: string;
  /** Source raster width (px) — kept for diagnostics + aspect-ratio sanity. */
  width: number;
  /** Source raster height (px). */
  height: number;
  /** Pins placed by the agent in the Builder. */
  pins: FloorMapPin[];
  /**
   * Tracking-table row id from `ephemeral_assets`. Kept so the
   * Builder can show "expires in N days" copy and let the user
   * re-vectorize without re-uploading.
   */
  ephemeralAssetId?: string | null;
  /** Storage path of the original raster (within `temporary-floorplans`). */
  storagePath?: string | null;
}

/**
 * Hard cap on the embedded SVG payload. Vector floorplans typically
 * land at 5-25 KB; anything above 200 KB suggests the tracer is
 * over-fitting noise. The Builder warns above this threshold but
 * still allows generation.
 */
export const FLOOR_MAP_SVG_WARN_BYTES = 200 * 1024;
/**
 * Maximum number of pins per property. Beyond ~25 the modal feels
 * cluttered and the popover stacking gets unwieldy.
 */
export const FLOOR_MAP_MAX_PINS = 25;
