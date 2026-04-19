/**
 * Matterport MHTML parser.
 *
 * Pure function — no DOM, no React, no I/O.
 * Parses a saved Matterport "Media" page (saved as Single-File MHTML)
 * and extracts persistent Asset IDs for videos, photos, and GIFs,
 * then reconstructs durable, token-free embed/asset URLs.
 *
 * Why client-side: zero upload bandwidth, zero storage, instant UX.
 * The spec's "delete after parsing" requirement is satisfied automatically
 * because the file never leaves the browser.
 */

import type { MediaAsset, MediaAssetKind } from "@/components/portal/types";

export interface ParsedMhtml {
  modelId: string | null;
  videos: MediaAsset[];
  photos: MediaAsset[];
  gifs: MediaAsset[];
}

const ID_PATTERN = "[A-Za-z0-9]{11}";

/**
 * Strip session-bound tokens (?t=..., &t=...) from a URL. These tokens are
 * tied to the original browser session and yield 401 outside it.
 */
function stripTokens(url: string): string {
  return url
    .replace(/([?&])t=[^&#]*&?/g, (_, p1) => (p1 === "?" ? "?" : "&"))
    .replace(/[?&]$/, "");
}

/**
 * Detect Matterport Model ID from common locations in the MHTML body.
 */
function findModelId(text: string): string | null {
  const showMatch = text.match(new RegExp(`my\\.matterport\\.com/show/\\?m=(${ID_PATTERN})`, "i"));
  if (showMatch?.[1]) return showMatch[1];
  const modelsPath = text.match(new RegExp(`/models/(${ID_PATTERN})/`));
  if (modelsPath?.[1]) return modelsPath[1];
  return null;
}

/**
 * Find every unique 11-char asset ID surfaced via the thumbnail-card test id.
 */
function findAssetIds(text: string): string[] {
  const re = new RegExp(`data-testid="thumbnail-card-(${ID_PATTERN})"`, "g");
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    ids.add(match[1]);
  }
  return Array.from(ids);
}

/**
 * Try to find an explicit photo/gif filename associated with this asset id
 * inside the MHTML payload (e.g. "{assetId}-Photo_03.jpg" or "{assetId}-Photo_01.gif").
 * Returns just the filename portion (e.g. "Photo_03.jpg") or null.
 */
function findExplicitPhotoFilename(text: string, modelId: string, assetId: string): string | null {
  const re = new RegExp(
    `models/${modelId}/images/${assetId}/${assetId}-([A-Za-z0-9_]+\\.(?:jpg|jpeg|png|gif|webp))`,
    "i"
  );
  const m = text.match(re);
  return m?.[1] ?? null;
}

/**
 * Classify an asset id by inspecting the MHTML for image-path evidence.
 * Returns "photo" / "gif" if an image path is found, else "video".
 */
function classify(text: string, modelId: string, assetId: string): MediaAssetKind {
  const filename = findExplicitPhotoFilename(text, modelId, assetId);
  if (filename) {
    return /\.gif$/i.test(filename) ? "gif" : "photo";
  }
  // Fallback: any presence of the images/ path -> photo
  if (text.includes(`models/${modelId}/images/${assetId}/`)) {
    return "photo";
  }
  return "video";
}

function reconstructVideoUrl(modelId: string, assetId: string): string {
  return `https://my.matterport.com/resources/model/${modelId}/clip/${assetId}`;
}

function reconstructImageUrl(modelId: string, assetId: string, filename: string): string {
  return stripTokens(
    `https://cdn-2.matterport.com/apifs/models/${modelId}/images/${assetId}/${assetId}-${filename}`
  );
}

/**
 * Parse a Matterport MHTML file (as a string). Pure & synchronous.
 */
export function parseMatterportMhtml(text: string): ParsedMhtml {
  const modelId = findModelId(text);
  const videos: MediaAsset[] = [];
  const photos: MediaAsset[] = [];
  const gifs: MediaAsset[] = [];

  if (!modelId) {
    return { modelId: null, videos, photos, gifs };
  }

  const assetIds = findAssetIds(text);
  let videoCount = 0;
  let photoCount = 0;
  let gifCount = 0;

  for (const assetId of assetIds) {
    const kind = classify(text, modelId, assetId);
    if (kind === "video") {
      videoCount += 1;
      videos.push({
        id: assetId,
        kind: "video",
        url: reconstructVideoUrl(modelId, assetId),
        visible: true,
        label: `Clip ${videoCount}`,
      });
    } else if (kind === "gif") {
      gifCount += 1;
      const filename = findExplicitPhotoFilename(text, modelId, assetId) ?? "Photo_01.gif";
      gifs.push({
        id: assetId,
        kind: "gif",
        url: reconstructImageUrl(modelId, assetId, filename),
        visible: true,
        label: `GIF ${gifCount}`,
      });
    } else {
      photoCount += 1;
      const filename = findExplicitPhotoFilename(text, modelId, assetId) ?? "Photo_01.jpg";
      photos.push({
        id: assetId,
        kind: "photo",
        url: reconstructImageUrl(modelId, assetId, filename),
        visible: true,
        label: `Photo ${photoCount}`,
      });
    }
  }

  return { modelId, videos, photos, gifs };
}

/**
 * Merge newly-parsed assets into an existing list, deduping by asset id.
 * Existing entries are preserved (so user-toggled visibility/labels survive).
 */
export function mergeAssets(existing: MediaAsset[] | undefined, incoming: MediaAsset[]): MediaAsset[] {
  const map = new Map<string, MediaAsset>();
  (existing ?? []).forEach((a) => map.set(a.id, a));
  incoming.forEach((a) => {
    if (!map.has(a.id)) map.set(a.id, a);
  });
  return Array.from(map.values());
}

/**
 * Sanitize a media list: strip any url containing a session token.
 * Defensive — should never trigger because parser already strips them.
 */
export function sanitizeMediaList(list: MediaAsset[] | undefined): MediaAsset[] {
  if (!list) return [];
  return list.filter((a) => !/[?&]t=/.test(a.url));
}
