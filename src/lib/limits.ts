/**
 * Centralized upload-size policy.
 *
 * These limits are PRODUCT POLICY, not configurable runtime data —
 * keeping them in code means the bytes the server enforces are
 * literally the same bytes the dropzone checked, and a drift between
 * client and server is a TypeScript / parity-test failure rather
 * than a silent oversized upload that gets rejected only at the
 * edge function.
 *
 * The Deno mirror at `supabase/functions/_shared/upload-limits.ts`
 * MUST stay in lockstep — the parity test enforces this.
 */

export const MB = 1024 * 1024;

export const UPLOAD_LIMITS = {
  /** Property-doc PDFs uploaded to vault-assets. */
  pdf_bytes: 5 * MB,
  /** Inline images: agent avatars, hero backgrounds, logos, gallery. */
  image_bytes: 2 * MB,
  /** Spatial-audio assets uploaded to vault-assets. */
  audio_bytes: 5 * MB,
} as const;

export type UploadKind = keyof typeof UPLOAD_LIMITS;

/**
 * Maximum number of property models per generated presentation.
 *
 * Rationale (see `.lovable/plan.md`):
 * - Each model's media + branding + AI training payload is inlined into
 *   the exported HTML; past ~5 properties, file size and initial paint
 *   degrade noticeably for visitors on average connections.
 * - The HUD header property switcher and Contact-drawer list are laid
 *   out for a small, scannable set — beyond 5 they wrap awkwardly.
 * - Multi-property presentations work best as a curated showcase, not a
 *   catalog. Clients needing more should publish a second presentation.
 */
export const MAX_PROPERTIES_PER_PRESENTATION = 5;

/**
 * Dedicated client-side ceiling for an uploaded presentation `index.html`
 * in the admin Presentation Upgrade Center (P5).
 *
 * This is INTENTIONALLY separate from `UPLOAD_LIMITS` above and is NOT
 * mirrored in the Deno edge-function limits: the presentation HTML is read
 * and patched entirely in the browser (`file.text()` + pure string scans)
 * and never reaches a server, so there is nothing to mirror and the
 * image/PDF/audio policy does not apply to it.
 *
 * Rationale for the value:
 * - A generated Builder package references its media/assets by relative URL
 *   (no `data:` URIs are inlined), so an `index.html` is essentially the
 *   inlined runtime (~150 KB, fixed) plus per-property config / AI-training /
 *   Q&A payloads for up to MAX_PROPERTIES_PER_PRESENTATION properties.
 * - Measured: the current single-property canary is ~153 KB; a rich
 *   five-property showcase realistically lands in the hundreds-of-KB to
 *   low-single-digit-MB range.
 * - 10 MB leaves generous headroom over the heaviest realistic presentation
 *   (and future runtime growth) so a legitimate package is never falsely
 *   rejected, while still bounding the in-browser read + linear scans to a
 *   size every browser handles instantly and firmly rejecting an accidental
 *   wrong-file selection (a video, archive, or database dump).
 */
export const MAX_PRESENTATION_HTML_BYTES = 10 * MB;

export interface PresentationHtmlSizeCheck {
  ok: boolean;
  /** Bytes received. */
  size: number;
  /** Limit applied (in bytes). */
  limit: number;
  /** Why it was rejected, or null when ok. */
  reason: "empty" | "too_large" | null;
  /** Human-readable message safe for an inline error / toast. */
  message: string;
}

/**
 * Validate an uploaded presentation HTML file's byte length BEFORE reading
 * it into memory. Rejects an empty file and anything over
 * MAX_PRESENTATION_HTML_BYTES; otherwise ok. Pure and deterministic so the
 * admin route and its tests apply the identical gate.
 */
export function checkPresentationHtmlSize(size: number): PresentationHtmlSizeCheck {
  const limit = MAX_PRESENTATION_HTML_BYTES;
  const safeSize = Number.isFinite(size) && size >= 0 ? size : 0;
  if (safeSize === 0) {
    return {
      ok: false,
      size: safeSize,
      limit,
      reason: "empty",
      message: "This file is empty — select the presentation's index.html.",
    };
  }
  if (safeSize > limit) {
    return {
      ok: false,
      size: safeSize,
      limit,
      reason: "too_large",
      message: `File too large: ${HUMAN(safeSize)} (max ${HUMAN(limit)} for a presentation index.html).`,
    };
  }
  return { ok: true, size: safeSize, limit, reason: null, message: "" };
}

export interface UploadLimitCheckResult {
  ok: boolean;
  /** Bytes received. */
  size: number;
  /** Limit applied (in bytes). */
  limit: number;
  /** Human-readable message safe for toast / 4xx response. */
  message: string;
}

const HUMAN = (bytes: number): string =>
  bytes >= MB
    ? `${Math.round(bytes / MB)} MB`
    : `${Math.round(bytes / 1024)} KB`;

/**
 * Check that a file (browser-side) or known byte length (server-side)
 * fits within the configured limit. Returns a structured result so
 * callers can render a deterministic toast message that matches what
 * the edge function will say if the same upload reaches it.
 */
export function checkUploadSize(
  size: number,
  kind: UploadKind,
): UploadLimitCheckResult {
  const limit = UPLOAD_LIMITS[kind];
  const safeSize = Number.isFinite(size) && size >= 0 ? size : 0;
  if (safeSize > limit) {
    return {
      ok: false,
      size: safeSize,
      limit,
      message: `File too large: ${HUMAN(safeSize)} (max ${HUMAN(limit)} for ${labelForKind(kind)}).`,
    };
  }
  return {
    ok: true,
    size: safeSize,
    limit,
    message: "",
  };
}

/** Map a MIME type to an UploadKind, or null when the type isn't covered. */
export function uploadKindForMime(mime: string | null | undefined): UploadKind | null {
  if (!mime) return null;
  const lower = mime.toLowerCase();
  if (lower === "application/pdf") return "pdf_bytes";
  if (lower.startsWith("image/")) return "image_bytes";
  if (lower.startsWith("audio/")) return "audio_bytes";
  return null;
}

function labelForKind(kind: UploadKind): string {
  switch (kind) {
    case "pdf_bytes":
      return "PDF documents";
    case "image_bytes":
      return "images";
    case "audio_bytes":
      return "audio files";
  }
}

/** Public, copy-ready string for help text under dropzones. */
export function uploadLimitDescription(kind: UploadKind): string {
  return `Max ${HUMAN(UPLOAD_LIMITS[kind])}`;
}
