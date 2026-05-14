// vectorize-floorplan
// ───────────────────
// Given { storage_path } pointing to a raster floor-plan image
// previously uploaded to the `temporary-floorplans` bucket by the
// authenticated user:
//   1. Verify the caller's JWT and confirm they own the file
//      (path prefix === auth.uid()).
//   2. Verify a matching ephemeral_assets row exists for that user.
//   3. Download the raster from storage via the service-role client.
//   4. Decode → silhouette pipeline (BG detect → FG mask → morph
//      close → connected-components → per-component boundary trace
//      → Douglas-Peucker simplify → filled SVG paths). Falls back
//      to a legacy binarize+marching-squares path when the
//      silhouette pipeline finds nothing (e.g. a thin-line
//      blueprint upload).
//   5. Sanitize the resulting SVG (defense in depth — we generate
//      every byte ourselves, but strip script/event handlers
//      anyway so a future change can't accidentally introduce XSS).
//   6. Return { ok, svg, viewBox, width, height, path_count, bytes,
//      mode } to the client, which embeds it in the builder draft
//      and ultimately in the exported standalone HTML.
//
// The original raster is left in place — `pg_cron` will purge it
// 30 days after upload (see migration
// 20260514130000_ephemeral_floorplan_assets.sql).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { decode as decodeImage, Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

import {
  checkUploadSize,
  uploadKindForMime,
} from "../_shared/upload-limits.ts";
import { checkRateLimit, ipFromRequest } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  storage_path: string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Stage =
  | "auth"
  | "input"
  | "ownership"
  | "tracking"
  | "download"
  | "decode"
  | "size_limit"
  | "trace"
  | "rate_limit";

function fail(
  stage: Stage,
  detail: string,
  status: number,
  diagnostics: Record<string, unknown> = {},
) {
  return jsonResponse(
    { ok: false, stage, detail, error: detail, diagnostics },
    status,
  );
}

// ── Tunable constants ─────────────────────────────────────────────
//
// All thresholds live here (instead of inline) so future tuning is
// a one-line change and the defaults stay legible. Defaults are
// optimised for Matterport dollhouse top-down views (the canonical
// input) and degrade gracefully for high-contrast architectural
// blueprints via the legacy fallback path.

const MAX_DIMENSION = 2048;
/** Border thickness sampled when guessing the background colour. */
const BG_SAMPLE_RING_PX = 8;
/** RGB Euclidean distance above which a pixel is "foreground". */
const BG_DISTANCE_THRESHOLD = 55;
/** Square-kernel half-size for the dilate+erode close pass. */
const MORPH_CLOSE_RADIUS = 6;
/** Drop connected components smaller than this fraction of the image area. */
const MIN_COMPONENT_AREA_PCT = 0.004;
/** Cap on rendered components — extra ones become noise. */
const MAX_COMPONENTS = 8;
/** Douglas-Peucker tolerance for silhouette outlines (coarser → smaller SVG). */
const SIMPLIFY_EPSILON_SILHOUETTE = 1.0;
/** Douglas-Peucker tolerance for the legacy edge-trace fallback. */
const SIMPLIFY_EPSILON_LEGACY = 0.75;
/** Minimum vertices before a contour is worth emitting as a path. */
const MIN_CONTOUR_LENGTH = 8;
/** Light architectural tint for filled silhouette paths. */
const SILHOUETTE_FILL = "#dbeafe";
/** Outline stroke for filled silhouette paths. */
const SILHOUETTE_STROKE = "#1f2937";
/**
 * If the foreground mask covers more than this fraction of the image,
 * the BG detection almost certainly latched onto a foreground tone
 * (e.g. the building fills the frame and the corner ring overlapped
 * a carpet edge). Inverting the mask flips the FG/BG assignment and
 * usually rescues the silhouette.
 */
const INVERT_MASK_COVERAGE_THRESHOLD = 0.85;
/**
 * Discoverable build marker embedded in the emitted SVG and the JSON
 * response. Bump this when the pipeline changes so operators can
 * verify in DevTools (network response → JSON; or view-source the
 * SVG → data-pipeline attribute) which version of the function
 * actually produced the output they're looking at. This is the
 * single source of truth that proves "is my code deployed?".
 */
const PIPELINE_VERSION = "silhouette-v2";

interface Pt { x: number; y: number; }
interface RGB { r: number; g: number; b: number; }

interface TraceResult {
  mode: "silhouette" | "edge";
  width: number;
  height: number;
  /** Silhouette mode: one entry per connected component, each containing its outer + inner contours. */
  components: Pt[][][];
  /** Edge mode (legacy fallback): raw SVG path-data strings already in `M…L…Z` form. */
  paths: string[];
}

// ── Background detection ─────────────────────────────────────────
//
// Matterport dollhouse top-down renders use a uniform dark-gray
// background (~RGB 50,50,50). Sampling a thin ring around all four
// edges and taking the per-channel median gives us a robust BG
// estimate even when corners contain a sliver of building. The
// median (not the mean) is intentional — one outlier corner pixel
// can't shift the result.
function detectBackground(img: Image): RGB {
  const w = img.width;
  const h = img.height;
  const ring = Math.min(BG_SAMPLE_RING_PX, Math.max(1, Math.floor(Math.min(w, h) / 32)));
  const bm = img.bitmap;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  // Step rate keeps the sample count bounded (~200 pixels) regardless
  // of image size, so detection stays O(1) wrt resolution.
  const stepX = Math.max(1, Math.floor(w / 50));
  const stepY = Math.max(1, Math.floor(h / 50));
  function add(x: number, y: number) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const off = (y * w + x) * 4;
    if (bm[off + 3] < 128) return; // ignore transparent
    rs.push(bm[off]);
    gs.push(bm[off + 1]);
    bs.push(bm[off + 2]);
  }
  for (let x = 0; x < w; x += stepX) {
    for (let r = 0; r < ring; r++) {
      add(x, r);
      add(x, h - 1 - r);
    }
  }
  for (let y = 0; y < h; y += stepY) {
    for (let r = 0; r < ring; r++) {
      add(r, y);
      add(w - 1 - r, y);
    }
  }
  if (rs.length === 0) return { r: 0, g: 0, b: 0 };
  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const mid = rs.length >> 1;
  return { r: rs[mid], g: gs[mid], b: bs[mid] };
}

// ── Foreground mask ──────────────────────────────────────────────
//
// A pixel is "foreground" (mask = 1) if its RGB Euclidean distance
// from the detected background colour exceeds the threshold. Compares
// the squared distance directly to avoid a sqrt per pixel.
function buildForegroundMask(img: Image, bg: RGB, threshold: number): Uint8Array {
  const out = new Uint8Array(img.width * img.height);
  const bm = img.bitmap;
  const t2 = threshold * threshold;
  for (let i = 0; i < out.length; i++) {
    const off = i * 4;
    if (bm[off + 3] < 128) { out[i] = 0; continue; }
    const dr = bm[off] - bg.r;
    const dg = bm[off + 1] - bg.g;
    const db = bm[off + 2] - bg.b;
    out[i] = (dr * dr + dg * dg + db * db) > t2 ? 1 : 0;
  }
  return out;
}

// ── Morphological close (separable dilate then erode) ────────────
//
// Fills small interior gaps in the foreground mask caused by
// foreground regions that happen to land near the BG colour (e.g.
// dark wood floor that almost matches a dark BG). Dilate-then-
// erode preserves overall shape while plugging holes up to ~2r px
// across. Implemented as two 1D passes per direction (horizontal
// then vertical) for O(W·H·r) instead of the naïve O(W·H·r²).
//
// We use early-break optimisation in both directions: dilate stops
// as soon as it finds a 1; erode stops as soon as it finds a 0.
// Worst case (uniform mask) approaches the unoptimised cost, but
// real-world floor-plan masks finish in well under a second on a
// 2048x2048 image.
function morphCloseInPlace(mask: Uint8Array, w: number, h: number, r: number) {
  if (r <= 0) return;
  const tmp = new Uint8Array(w * h);
  // Horizontal dilate: tmp[y][x] = 1 if any mask[y][x±k] is 1
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = 0;
      const lo = Math.max(0, x - r);
      const hi = Math.min(w - 1, x + r);
      for (let k = lo; k <= hi; k++) {
        if (mask[row + k]) { v = 1; break; }
      }
      tmp[row + x] = v;
    }
  }
  // Vertical dilate (writes back to `mask`)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = 0;
      const lo = Math.max(0, y - r);
      const hi = Math.min(h - 1, y + r);
      for (let k = lo; k <= hi; k++) {
        if (tmp[k * w + x]) { v = 1; break; }
      }
      mask[y * w + x] = v;
    }
  }
  // Horizontal erode
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = 1;
      const lo = Math.max(0, x - r);
      const hi = Math.min(w - 1, x + r);
      for (let k = lo; k <= hi; k++) {
        if (!mask[row + k]) { v = 0; break; }
      }
      tmp[row + x] = v;
    }
  }
  // Vertical erode
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = 1;
      const lo = Math.max(0, y - r);
      const hi = Math.min(h - 1, y + r);
      for (let k = lo; k <= hi; k++) {
        if (!tmp[k * w + x]) { v = 0; break; }
      }
      mask[y * w + x] = v;
    }
  }
}

// ── Connected-components labelling (two-pass union-find) ─────────
//
// First pass assigns a provisional label to every foreground pixel
// based on its left and up neighbours, recording equivalences in a
// disjoint-set forest. Second pass replaces every label with its
// canonical root and tallies area per root. Returns the resolved
// label map plus a Map of root → pixel count.
function labelConnectedComponents(
  mask: Uint8Array,
  w: number,
  h: number,
): { labels: Int32Array; areas: Map<number, number> } {
  const labels = new Int32Array(w * h);
  // parent[i] === i means i is a root. Index 0 is sentinel for "no label".
  const parent: number[] = [0];
  function find(a: number): number {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  }
  function union(a: number, b: number) {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra;
    else parent[ra] = rb;
  }
  let nextLabel = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const left = x > 0 ? labels[i - 1] : 0;
      const up = y > 0 ? labels[i - w] : 0;
      if (left && up) {
        labels[i] = left < up ? left : up;
        union(left, up);
      } else if (left) {
        labels[i] = left;
      } else if (up) {
        labels[i] = up;
      } else {
        labels[i] = nextLabel;
        parent.push(nextLabel);
        nextLabel++;
      }
    }
  }
  const areas = new Map<number, number>();
  for (let i = 0; i < labels.length; i++) {
    if (!labels[i]) continue;
    const root = find(labels[i]);
    labels[i] = root;
    areas.set(root, (areas.get(root) ?? 0) + 1);
  }
  return { labels, areas };
}

// ── Marching-squares contour tracer ──────────────────────────────
//
// Walks 2×2 cells over a binary mask. For each cell it computes a
// 4-bit code describing which of the four surrounding pixels are
// foreground; the code drives a direction lookup that follows the
// boundary segment. Continues until the walk hits a visited cell
// or the image border. Used in two places:
//   1. Per-component when the silhouette pipeline produces real
//      components (most of the time).
//   2. Whole-image as the legacy fallback when no components
//      survive area filtering (e.g. thin-line blueprint uploads).
function traceContours(bin: Uint8Array, width: number, height: number): Pt[][] {
  const at = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    return bin[y * width + x];
  };
  const visited = new Uint8Array((width + 1) * (height + 1));
  const contours: Pt[][] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tl = at(x - 1, y - 1);
      const tr = at(x, y - 1);
      const bl = at(x - 1, y);
      const br = at(x, y);
      const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (code === 0 || code === 15) continue;
      if (visited[y * (width + 1) + x]) continue;

      const contour: Pt[] = [];
      let cx = x;
      let cy = y;
      let dir = 0; // 0=right, 1=down, 2=left, 3=up
      let safety = 0;
      const maxSteps = width * height * 4;
      while (safety++ < maxSteps) {
        const idx = cy * (width + 1) + cx;
        if (visited[idx]) break;
        visited[idx] = 1;
        contour.push({ x: cx, y: cy });

        const ttl = at(cx - 1, cy - 1);
        const ttr = at(cx, cy - 1);
        const tbl = at(cx - 1, cy);
        const tbr = at(cx, cy);
        const ccode = (ttl << 3) | (ttr << 2) | (tbr << 1) | tbl;

        switch (ccode) {
          case 1: dir = 2; break;
          case 2: dir = 1; break;
          case 3: dir = 2; break;
          case 4: dir = 3; break;
          case 5:
            dir = dir === 3 ? 2 : 0;
            break;
          case 6: dir = 1; break;
          case 7: dir = 2; break;
          case 8: dir = 0; break;
          case 9: dir = 3; break;
          case 10:
            dir = dir === 0 ? 3 : 1;
            break;
          case 11: dir = 3; break;
          case 12: dir = 0; break;
          case 13: dir = 0; break;
          case 14: dir = 1; break;
          default: safety = maxSteps; break;
        }
        if (dir === 0) cx++;
        else if (dir === 1) cy++;
        else if (dir === 2) cx--;
        else if (dir === 3) cy--;
        if (cx < 0 || cy < 0 || cx > width || cy > height) break;
      }
      if (contour.length >= MIN_CONTOUR_LENGTH) contours.push(contour);
    }
  }
  return contours;
}

// Build a binary mask containing only pixels that match the given
// label, then trace its outer + inner contours. Holes inside a
// component naturally produce additional inner contours, which the
// silhouette emitter combines under fill-rule="evenodd" so courtyards
// punch through the fill correctly.
function traceComponentBoundary(
  labels: Int32Array,
  targetLabel: number,
  w: number,
  h: number,
): Pt[][] {
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < bin.length; i++) {
    bin[i] = labels[i] === targetLabel ? 1 : 0;
  }
  return traceContours(bin, w, h);
}

// ── Douglas-Peucker line simplification ──────────────────────────
//
// Drops points that are within `epsilon` pixels of the line
// connecting their neighbours. Run iteratively (with an explicit
// stack) instead of recursively to avoid stack overflow on very
// long contours that span an entire building wall.
function simplify(points: Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    if (hi - lo < 2) continue;
    const a = points[lo];
    const b = points[hi];
    let maxDist = 0;
    let maxIdx = -1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = lo + 1; i < hi; i++) {
      const p = points[i];
      const dist = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }
    if (maxDist > epsilon && maxIdx !== -1) {
      keep[maxIdx] = 1;
      stack.push([lo, maxIdx]);
      stack.push([maxIdx, hi]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

function pointsToPathData(points: Pt[]): string {
  if (points.length === 0) return "";
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += `L${points[i].x} ${points[i].y}`;
  }
  return d + "Z";
}

// ── Legacy binarize for the edge-mode fallback ──────────────────
//
// Only invoked when the silhouette pipeline produces zero
// components (thin-line blueprints uploaded as the spec originally
// envisaged). Keeps the original behaviour byte-for-byte so users
// who relied on it before this change still get a result.
function binarize(img: Image, threshold: number): Uint8Array {
  const out = new Uint8Array(img.width * img.height);
  const bitmap = img.bitmap;
  for (let i = 0; i < out.length; i++) {
    const off = i * 4;
    const r = bitmap[off];
    const g = bitmap[off + 1];
    const b = bitmap[off + 2];
    const a = bitmap[off + 3];
    const lum = a < 128 ? 255 : (0.299 * r + 0.587 * g + 0.114 * b);
    out[i] = lum < threshold ? 1 : 0;
  }
  return out;
}

// ── Main pipeline ────────────────────────────────────────────────
function traceImage(img: Image): TraceResult {
  // Downscale very large images so the per-pixel passes stay
  // bounded regardless of upload resolution. Aspect ratio is
  // preserved so percentage-based pin coordinates remain stable.
  let working = img;
  const longest = Math.max(img.width, img.height);
  if (longest > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / longest;
    working = img.resize(
      Math.round(img.width * scale),
      Math.round(img.height * scale),
    );
  }
  const w = working.width;
  const h = working.height;

  // Silhouette pipeline (canonical path for Matterport dollhouse views)
  const bg = detectBackground(working);
  const mask = buildForegroundMask(working, bg, BG_DISTANCE_THRESHOLD);

  // Sanity check: if the border-detected "background" turned out to be
  // a foreground tone (e.g. the building extends right to the edge of
  // the frame and the corner ring overlapped its carpet), the mask is
  // inverted — most pixels will read as foreground. Flipping the mask
  // recovers the silhouette. Without this safeguard the silhouette
  // pipeline silently collapses on building-fills-frame uploads and
  // (pre-fix) fell through to the broken legacy edge tracer.
  let fgCoverage = countCoverage(mask);
  if (fgCoverage > INVERT_MASK_COVERAGE_THRESHOLD) {
    invertMaskInPlace(mask);
    fgCoverage = 1 - fgCoverage;
  }

  morphCloseInPlace(mask, w, h, MORPH_CLOSE_RADIUS);
  const { labels, areas } = labelConnectedComponents(mask, w, h);
  const minArea = Math.max(20, Math.floor(w * h * MIN_COMPONENT_AREA_PCT));
  const survivors = [...areas.entries()]
    .filter(([, area]) => area >= minArea)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_COMPONENTS)
    .map(([label]) => label);

  // Log to the function's stderr so operators have a per-call paper
  // trail in the Supabase Functions log viewer. Helps confirm at a
  // glance which BG colour we picked + how many components made it.
  console.log(
    `[vectorize-floorplan] pipeline=${PIPELINE_VERSION} bg=rgb(${bg.r},${bg.g},${bg.b}) ` +
    `fg_cov=${fgCoverage.toFixed(3)} components=${survivors.length} ` +
    `dims=${w}x${h}`,
  );

  if (survivors.length > 0) {
    const components: Pt[][][] = survivors.map((label) =>
      traceComponentBoundary(labels, label, w, h),
    );
    return { mode: "silhouette", components, paths: [], width: w, height: h };
  }

  // True empty silhouette → fall back to the legacy edge tracer so a
  // thin-line blueprint upload still produces SOMETHING. We log
  // `mode=edge` here so a stuck "looks like the old sketch" complaint
  // is debuggable from logs alone — without this marker, operators
  // can't tell whether the deployed function is the new code at all.
  const bin = binarize(working, 160);
  const contours = traceContours(bin, w, h);
  const paths: string[] = [];
  for (const c of contours) {
    const simplified = simplify(c, SIMPLIFY_EPSILON_LEGACY);
    if (simplified.length < 3) continue;
    paths.push(pointsToPathData(simplified));
  }
  return { mode: "edge", paths, components: [], width: w, height: h };
}

function countCoverage(mask: Uint8Array): number {
  let on = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) on++;
  return on / Math.max(1, mask.length);
}

function invertMaskInPlace(mask: Uint8Array): void {
  for (let i = 0; i < mask.length; i++) mask[i] = mask[i] ? 0 : 1;
}

// ── SVG assembly + sanitization ──────────────────────────────────
//
// We generate every byte of the SVG ourselves so there's no real
// XSS vector — but the sanitizer is here as a defense-in-depth
// measure called out by the spec. If a future refactor ever lets
// untrusted data into the path string this stays the last line of
// defense.
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, "");
}

function emitSilhouetteSvg(width: number, height: number, components: Pt[][][]): string {
  // Each component becomes one <path> with all its outer + inner
  // contours concatenated into a single `d` attribute. With
  // fill-rule="evenodd", stacked subpaths cleanly carve interior
  // courtyards/atriums out of the filled silhouette.
  const pathEls: string[] = [];
  for (const contours of components) {
    const dParts: string[] = [];
    for (const c of contours) {
      const simplified = simplify(c, SIMPLIFY_EPSILON_SILHOUETTE);
      if (simplified.length < 3) continue;
      dParts.push(pointsToPathData(simplified));
    }
    if (dParts.length === 0) continue;
    pathEls.push(`<path d="${dParts.join("")}" fill-rule="evenodd"/>`);
  }
  // `preserveAspectRatio="xMidYMid meet"` is mandatory: pin
  // coordinates are stored as percentages of the SVG viewBox, so
  // the runtime relies on the aspect ratio staying locked even as
  // the modal resizes. The `data-pipeline` attribute is a
  // discoverable marker — open DevTools → view-source on the
  // rendered SVG to confirm which pipeline version actually ran.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `preserveAspectRatio="xMidYMid meet" data-pipeline="${PIPELINE_VERSION}" ` +
    `data-mode="silhouette" fill="${SILHOUETTE_FILL}" ` +
    `stroke="${SILHOUETTE_STROKE}" stroke-width="1.5" stroke-linejoin="round" ` +
    `stroke-linecap="round">` +
    pathEls.join("") +
    `</svg>`
  );
}

function emitEdgeSvg(width: number, height: number, paths: string[]): string {
  const pathEls = paths.map((d) => `<path d="${d}"/>`).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `preserveAspectRatio="xMidYMid meet" data-pipeline="${PIPELINE_VERSION}" ` +
    `data-mode="edge" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linejoin="round" stroke-linecap="round">` +
    pathEls +
    `</svg>`
  );
}

function buildSvg(trace: TraceResult): string {
  const raw = trace.mode === "silhouette"
    ? emitSilhouetteSvg(trace.width, trace.height, trace.components)
    : emitEdgeSvg(trace.width, trace.height, trace.paths);
  return sanitizeSvg(raw);
}

// ── Entry point ──────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return fail("input", "method_not_allowed", 405);
  }

  const ip = ipFromRequest(req);
  const rl = checkRateLimit(ip, { perMinute: 6 });
  if (!rl.allowed) {
    return fail("rate_limit", "rate_limited", 429, {
      retry_after_seconds: rl.retryAfterSeconds,
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    return fail("auth", "supabase_env_missing", 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return fail("auth", "unauthorized_no_jwt", 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return fail("auth", "unauthorized_invalid_jwt", 401);
  }
  const userId = userData.user.id;

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return fail("input", "invalid_json", 400);
  }
  const storagePath = String(body.storage_path ?? "").trim();
  if (!storagePath) return fail("input", "missing_storage_path", 400);

  // Path must begin with the caller's user id so a leaked function
  // URL can never be coerced into vectorizing someone else's
  // upload. This mirrors the RLS check on storage.objects.
  const firstSegment = storagePath.split("/")[0] ?? "";
  if (firstSegment !== userId) {
    return fail("ownership", "path_owner_mismatch", 403, {
      expected_prefix: userId,
    });
  }

  // Confirm the upload was registered. The Builder always inserts
  // an `ephemeral_assets` row immediately after upload so the
  // 30-day purge can find it. A missing row means the upload was
  // tampered with or the row was already purged.
  const { data: tracking, error: trackingErr } = await serviceClient
    .from("ephemeral_assets")
    .select("id, expires_at, file_size_bytes, mime_type")
    .eq("user_id", userId)
    .eq("bucket_id", "temporary-floorplans")
    .eq("file_path", storagePath)
    .maybeSingle();
  if (trackingErr) {
    return fail("tracking", "tracking_lookup_failed", 500, {
      err: trackingErr.message,
    });
  }
  if (!tracking) {
    return fail("tracking", "no_tracking_row", 404);
  }

  // Download the raster via the service role so it works whether
  // or not the user client has fresh storage permissions.
  const { data: dl, error: dlErr } = await serviceClient.storage
    .from("temporary-floorplans")
    .download(storagePath);
  if (dlErr || !dl) {
    return fail("download", "storage_download_failed", 500, {
      err: dlErr?.message,
    });
  }

  // Belt-and-braces size cap. The Builder enforces the limit before
  // upload; we re-check here so a direct-to-storage upload can't
  // smuggle a giant image past us.
  const fileSize = dl.size ?? tracking.file_size_bytes ?? 0;
  const kind = uploadKindForMime(tracking.mime_type ?? dl.type) ?? "image_bytes";
  const sizeCheck = checkUploadSize(fileSize, kind);
  if (!sizeCheck.ok) {
    return fail("size_limit", sizeCheck.message, 413, { size: fileSize });
  }

  let image: Image;
  try {
    const buf = new Uint8Array(await dl.arrayBuffer());
    const decoded = await decodeImage(buf);
    if (!(decoded instanceof Image)) {
      return fail("decode", "unsupported_image_kind", 415);
    }
    image = decoded;
  } catch (err) {
    return fail("decode", "image_decode_failed", 415, {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  let trace: TraceResult;
  try {
    trace = traceImage(image);
  } catch (err) {
    return fail("trace", "contour_trace_failed", 500, {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const isEmpty = trace.mode === "silhouette"
    ? trace.components.length === 0
    : trace.paths.length === 0;
  if (isEmpty) {
    return fail("trace", "no_contours_detected", 422, {
      hint: "Image appears to be all one tone. Try a higher-contrast scan.",
    });
  }

  const svg = buildSvg(trace);
  const pathCount = trace.mode === "silhouette" ? trace.components.length : trace.paths.length;

  return jsonResponse({
    ok: true,
    svg,
    viewBox: `0 0 ${trace.width} ${trace.height}`,
    width: trace.width,
    height: trace.height,
    path_count: pathCount,
    bytes: svg.length,
    mode: trace.mode,
    pipeline: PIPELINE_VERSION,
  });
});
