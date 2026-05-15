## Fix floor-plan upload + add upload guidance

### Problem

The `vectorize-floorplan` Edge Function is hitting the Worker CPU limit (`EarlyDrop` at 400ms) because it decodes and resizes images server-side with `imagescript`. Every upload returns "Edge Function returned a non-2xx status code".

Separately, users don't know that **two** kinds of Matterport image work here, and that the dollhouse screenshot needs a specific capture flow to look good.

### Fix

**1. Move image processing to the browser**

New helper `src/lib/portal/floor-map-compress.ts`:
- Read the `File` into an `Image` via `createImageBitmap`.
- Downscale so the longest edge ≤ 1600 px (preserves aspect ratio; no upscaling).
- Draw to an `OffscreenCanvas` and encode JPEG @ quality 0.85.
- Return `{ blob, base64, mime: "image/jpeg", width, height }`.

**2. Slim the Edge Function** (`supabase/functions/vectorize-floorplan/index.ts`):
- Bump `PIPELINE_VERSION = "raster-v2"`.
- Drop `imagescript` import + all decode/resize logic.
- Keep: auth check, ownership check against `ephemeral_assets`, size guard, mime allowlist.
- Download the (already-small) object from the bucket, base64-encode, return `{ ok, raster: { mime, data }, width, height, viewBox, pipeline: "raster-v2" }`. `width`/`height` come from the request body.

**3. Update `InteractiveFloorMap.tsx`**:
- Before upload, run the compressor; upload the resulting JPEG (not the original).
- Pass `width` + `height` in the function-invoke body.
- Update the `"Compressing image…"` stage label to fire around the canvas pass.
- Leave pin logic, ephemeral cleanup, and SVG fallback render path untouched.

**4. Add upload guidance UI** (the new piece you just asked for)

In the empty-state card of `InteractiveFloorMap.tsx`, add an **info button** (Lucide `Info` icon) next to the "Upload floor plan" button. Clicking it opens a `Popover` (already in the design system) with two short sections:

- **Option A — Matterport Schematic Floor Plan** (recommended): "If you've purchased Matterport's Schematic Floor Plan add-on, upload that PDF/PNG export. It's already a clean, top-down floor plan."
- **Option B — Dollhouse screenshot**: numbered steps from your message:
  1. Open the Matterport editor and click **View Floor Plan** (bottom-left).
  2. Resize the floor map to fill the screen.
  3. Click **Photos** on the right-side panel.
  4. Click the **camera** button (bottom-center) to screenshot.
  5. Click **View** (bottom-right).
  6. Open the **⋯ menu** and choose **Download**.

Also add a one-line caption below the upload button: *"Works with both Matterport Schematic Floor Plans and dollhouse screenshots — see the info button for capture tips."*

### Out of scope

- No source-level vector tracing, OpenCV.js, or model calls. Browser-side cosmetic transforms were evaluated and rejected — they don't produce honest floor plans (see prior message).
- No DB schema changes (`ephemeral_assets` already exists).
- No changes to pin model, export pipeline, or saved-draft shape — `FloorMapData.raster` already supports the JPEG path; old SVG-mode drafts keep rendering.

### Verification

After deploy:
1. Upload a 4 MB dollhouse PNG → expect <1s response, ~150–400 KB JPEG embedded, no CPU error in `vectorize-floorplan` logs.
2. Re-open a previously saved SVG-mode floor map → still renders via the SVG branch.
3. Click the info button → popover shows both options with the 6-step capture flow.
