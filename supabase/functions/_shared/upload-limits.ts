/**
 * Deno mirror of `src/lib/limits.ts`. Logic must stay in lockstep —
 * `tests/upload-limits-parity.test.mjs` enforces this.
 */

export const MB = 1024 * 1024;

export const UPLOAD_LIMITS = {
  pdf_bytes: 5 * MB,
  image_bytes: 2 * MB,
  audio_bytes: 5 * MB,
} as const;

export type UploadKind = keyof typeof UPLOAD_LIMITS;

export interface UploadLimitCheckResult {
  ok: boolean;
  size: number;
  limit: number;
  message: string;
}

const HUMAN = (bytes: number): string =>
  bytes >= MB
    ? `${Math.round(bytes / MB)} MB`
    : `${Math.round(bytes / 1024)} KB`;

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
