/**
 * Client-side image optimizer for brand assets (logo / favicon).
 *
 * Strategy:
 *   - SVGs pass through unchanged (vector — already tiny + lossless).
 *   - Raster images (PNG/JPG/WebP/etc.) are downscaled to `maxWidth` and
 *     re-encoded as WebP, iterating quality levels until the result fits
 *     `targetBytes`. Throws a friendly error when even minimum quality
 *     can't fit the cap.
 *
 * Returns a real `File` (not a Blob) with a `.webp` extension so it slots
 * directly into the existing upload pipeline.
 */

export interface OptimizeOptions {
  /** Maximum output width in pixels. Aspect ratio preserved. */
  maxWidth: number;
  /** Soft target — we iterate quality until we fit. */
  targetBytes: number;
  /** Used only for friendlier error messages ("logo" / "favicon"). */
  kind: "logo" | "favicon";
}

export interface OptimizeResult {
  file: File;
  originalBytes: number;
  finalBytes: number;
  /** True when we actually converted/resized. False for SVG passthrough. */
  wasOptimized: boolean;
  /** Output MIME type (image/webp or original SVG type). */
  mimeType: string;
}

const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45];

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image — file may be corrupt."));
    img.src = dataUrl;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Encoding failed."))),
      type,
      quality,
    );
  });
}

function swapExtension(name: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${newExt}`;
}

function humanBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * Optimize a brand image. SVGs are passed through (only enforcing the hard
 * cap). Raster images are converted to WebP and resized as needed.
 */
export async function optimizeBrandImage(
  file: File,
  opts: OptimizeOptions,
): Promise<OptimizeResult> {
  const original = file.size;

  // SVG passthrough — vectors don't benefit from raster re-encoding.
  if (file.type === "image/svg+xml") {
    if (original > opts.targetBytes) {
      throw new Error(
        `${opts.kind === "logo" ? "Logo" : "Favicon"} SVG is ${humanBytes(original)} (max ${humanBytes(
          opts.targetBytes,
        )}). SVGs that large usually contain embedded raster images — re-export as a clean vector.`,
      );
    }
    return {
      file,
      originalBytes: original,
      finalBytes: original,
      wasOptimized: false,
      mimeType: "image/svg+xml",
    };
  }

  // Decode source.
  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);

  // Compute target dimensions (preserve aspect ratio, cap width).
  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;
  if (width > opts.maxWidth) {
    height = Math.round((opts.maxWidth / width) * height);
    width = opts.maxWidth;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser blocked image processing — try a different browser.");
  ctx.drawImage(img, 0, 0, width, height);

  // Iterate quality until we fit, or fail loudly.
  let lastBlob: Blob | null = null;
  for (const q of QUALITY_STEPS) {
    const blob = await canvasToBlob(canvas, "image/webp", q);
    lastBlob = blob;
    if (blob.size <= opts.targetBytes) {
      const outName = swapExtension(file.name || `${opts.kind}.webp`, "webp");
      return {
        file: new File([blob], outName, { type: "image/webp" }),
        originalBytes: original,
        finalBytes: blob.size,
        wasOptimized: true,
        mimeType: "image/webp",
      };
    }
  }

  // Even the smallest pass busted the cap — surface a clear error.
  const failedSize = lastBlob ? humanBytes(lastBlob.size) : "unknown";
  throw new Error(
    `Couldn't shrink ${opts.kind} below ${humanBytes(opts.targetBytes)} (got ${failedSize} after optimizing). Try a simpler graphic or smaller source image.`,
  );
}

export const BRAND_ASSET_LIMITS = {
  logo: { maxWidth: 512, targetBytes: 150 * 1024 },
  favicon: { maxWidth: 128, targetBytes: 50 * 1024 },
} as const;

export function describeOptimization(result: OptimizeResult): string {
  if (!result.wasOptimized) return "";
  return `${humanBytes(result.originalBytes)} → ${humanBytes(result.finalBytes)}`;
}
