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
