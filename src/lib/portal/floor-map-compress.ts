/**
 * Browser-side floor-plan image compressor.
 *
 * The `vectorize-floorplan` Edge Function used to decode + resize
 * the raster server-side via `imagescript`, but Matterport dollhouse
 * screenshots (3000–5000 px on the long edge, 4–10 MB) routinely
 * blew through the Worker's 400 ms CPU budget and the function
 * returned a non-2xx error. Doing the heavy lifting in the browser
 * is reliable, free of CPU caps, and produces an already-small JPEG
 * for the Edge Function to simply forward.
 *
 * Output: longest edge ≤ MAX_DIMENSION, JPEG @ JPEG_QUALITY,
 * aspect ratio preserved (so percentage-based pin coords stay stable).
 */

export const MAX_DIMENSION = 1600;
export const JPEG_QUALITY = 0.85;

export interface CompressedFloorPlan {
  /** JPEG Blob ready to upload to storage. */
  blob: Blob;
  /** MIME — always "image/jpeg" for now. */
  mime: "image/jpeg";
  /** Output width in px (after downsize). */
  width: number;
  /** Output height in px. */
  height: number;
  /** Original file size in bytes (for diagnostics + toast copy). */
  originalBytes: number;
  /** Compressed JPEG size in bytes. */
  compressedBytes: number;
}

/**
 * Compress a user-uploaded floor-plan image to a JPEG suitable for
 * embedding as a data URI in the exported standalone HTML.
 */
export async function compressFloorPlan(
  file: File,
): Promise<CompressedFloorPlan> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only PNG or JPG images are supported.");
  }

  // createImageBitmap handles PNG/JPEG/WebP and decodes off the main
  // thread when the browser supports it.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    throw new Error(
      `Couldn't read that image (${err instanceof Error ? err.message : "decode failed"}). Try exporting it again as PNG or JPG.`,
    );
  }

  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
  const outW = Math.max(1, Math.round(bitmap.width * scale));
  const outH = Math.max(1, Math.round(bitmap.height * scale));

  // Prefer OffscreenCanvas where available — keeps the main thread
  // free during the encode. Fall back to a regular canvas otherwise.
  let blob: Blob;
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable.");
    ctx.drawImage(bitmap, 0, 0, outW, outH);
    bitmap.close();
    blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: JPEG_QUALITY,
    });
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable.");
    ctx.drawImage(bitmap, 0, 0, outW, outH);
    bitmap.close?.();
    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error("Canvas JPEG encode failed.")),
        "image/jpeg",
        JPEG_QUALITY,
      );
    });
  }

  return {
    blob,
    mime: "image/jpeg",
    width: outW,
    height: outH,
    originalBytes: file.size,
    compressedBytes: blob.size,
  };
}

/** Helper: read a Blob as a base64 string (no data: prefix). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(bin);
}
