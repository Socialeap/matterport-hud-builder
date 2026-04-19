/**
 * Matterport MHTML parser.
 *
 * Pure function — no DOM, no React, no I/O.
 * Parses a saved Matterport "Media" page (saved as Single-File MHTML)
 * and extracts a list of assets per kind (video / photo / gif).
 *
 * For each asset we emit:
 *   - id        — the 11-char Matterport asset id (extracted from data-testid)
 *   - kind      — video | photo | gif (classified by filename extension)
 *   - label     — friendly name (derived from filename)
 *   - proxyUrl  — `/api/mp-image?m=...&id=...` for photos/gifs
 *                 (browsers will 302 to a fresh signed CDN URL on each load)
 *   - embedUrl  — `https://my.matterport.com/resources/model/{m}/clip/{id}`
 *                 for videos (Matterport's official iframeable clip player)
 *
 * We no longer extract or store any short-lived `?t=...` signed URLs —
 * the proxy resolves them at request time, so they never expire.
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
 * Decode a quoted-printable-encoded string (RFC 2045).
 * Matterport-saved MHTML uses Content-Transfer-Encoding: quoted-printable,
 * which escapes "=" as "=3D" and inserts soft line breaks ("=" + newline)
 * to keep lines under ~76 chars. We must reverse both before regex parsing.
 */
function decodeQuotedPrintable(input: string): string {
  const noSoftBreaks = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < noSoftBreaks.length; i++) {
    const c = noSoftBreaks.charCodeAt(i);
    if (c === 0x3d /* "=" */ && i + 2 < noSoftBreaks.length) {
      const hex = noSoftBreaks.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(c & 0xff);
  }
  try {
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  } catch {
    return noSoftBreaks;
  }
}

/** Detect the 11-char public Model ID. */
function findModelId(text: string): string | null {
  const showMatch = text.match(
    new RegExp(`my\\.matterport\\.com/(?:show/\\?m|models|work\\?m)=?(${ID_PATTERN})`, "i")
  );
  if (showMatch?.[1]) return showMatch[1];
  const m2 = text.match(new RegExp(`my\\.matterport\\.com/work\\?m=(${ID_PATTERN})`, "i"));
  if (m2?.[1]) return m2[1];
  const m3 = text.match(new RegExp(`/models/(${ID_PATTERN})(?:[?/&"\\s])`));
  if (m3?.[1]) return m3[1];
  return null;
}

/**
 * Extract every thumbnail-card block. Each block contains the assetId
 * and (optionally) a sibling <img alt="FILENAME.ext"> with the real
 * filename, which is the definitive kind hint.
 */
interface RawCard {
  assetId: string;
  filename: string | null;
}

function extractCards(text: string): RawCard[] {
  const cards: RawCard[] = [];
  const cardRe = new RegExp(
    `data-testid="thumbnail-card-(${ID_PATTERN})"[\\s\\S]{0,1500}?<img[^>]*\\salt="([^"]*)"`,
    "g"
  );
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(text)) !== null) {
    cards.push({ assetId: m[1], filename: m[2] || null });
  }
  // Fallback: any thumbnail-card without a paired <img alt> (defensive).
  const knownIds = new Set(cards.map((c) => c.assetId));
  const idOnlyRe = new RegExp(`data-testid="thumbnail-card-(${ID_PATTERN})"`, "g");
  let im: RegExpExecArray | null;
  while ((im = idOnlyRe.exec(text)) !== null) {
    if (!knownIds.has(im[1])) {
      cards.push({ assetId: im[1], filename: null });
      knownIds.add(im[1]);
    }
  }
  return cards;
}

function fileExt(filename: string | null): string {
  if (!filename) return "";
  const m = filename.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}

function classifyByFilename(filename: string | null): MediaAssetKind {
  const ext = fileExt(filename);
  if (["mp4", "mov", "webm", "m4v"].includes(ext)) return "video";
  if (ext === "gif") return "gif";
  return "photo"; // jpg/jpeg/png/webp or unknown → safest as photo
}

function prettyLabel(filename: string | null, fallback: string): string {
  if (!filename) return fallback;
  const stem = filename.replace(/\.[a-z0-9]+$/i, "");
  return stem.replace(/[-_]+/g, " ").trim() || fallback;
}

function buildProxyUrl(modelId: string, assetId: string): string {
  return `/api/mp-image?m=${modelId}&id=${assetId}`;
}

function buildClipEmbedUrl(modelId: string, assetId: string): string {
  return `https://my.matterport.com/resources/model/${modelId}/clip/${assetId}`;
}

/** Parse a Matterport MHTML file (as a string). Pure & synchronous. */
export function parseMatterportMhtml(rawText: string): ParsedMhtml {
  const isQP =
    /Content-Transfer-Encoding:\s*quoted-printable/i.test(rawText) ||
    /=3D"/.test(rawText);
  const text = isQP ? decodeQuotedPrintable(rawText) : rawText;

  const modelId = findModelId(text);
  const videos: MediaAsset[] = [];
  const photos: MediaAsset[] = [];
  const gifs: MediaAsset[] = [];

  if (!modelId) {
    return { modelId: null, videos, photos, gifs };
  }

  const cards = extractCards(text);
  let videoCount = 0;
  let photoCount = 0;
  let gifCount = 0;

  for (const card of cards) {
    const kind = classifyByFilename(card.filename);

    if (kind === "video") {
      videoCount += 1;
      videos.push({
        id: card.assetId,
        kind: "video",
        embedUrl: buildClipEmbedUrl(modelId, card.assetId),
        filename: card.filename ?? undefined,
        label: prettyLabel(card.filename, `Clip ${videoCount}`),
        visible: true,
      });
    } else if (kind === "gif") {
      gifCount += 1;
      gifs.push({
        id: card.assetId,
        kind: "gif",
        proxyUrl: buildProxyUrl(modelId, card.assetId),
        filename: card.filename ?? undefined,
        label: prettyLabel(card.filename, `GIF ${gifCount}`),
        visible: true,
      });
    } else {
      photoCount += 1;
      photos.push({
        id: card.assetId,
        kind: "photo",
        proxyUrl: buildProxyUrl(modelId, card.assetId),
        filename: card.filename ?? undefined,
        label: prettyLabel(card.filename, `Photo ${photoCount}`),
        visible: true,
      });
    }
  }

  return { modelId, videos, photos, gifs };
}

/**
 * Merge newly-parsed assets into an existing list, deduping by asset id.
 * Existing entries are preserved (so user-toggled visibility/labels survive),
 * but their URLs are refreshed from the incoming parse.
 */
export function mergeAssets(
  existing: MediaAsset[] | undefined,
  incoming: MediaAsset[]
): MediaAsset[] {
  const map = new Map<string, MediaAsset>();
  (existing ?? []).forEach((a) => map.set(a.id, a));
  incoming.forEach((a) => {
    const prev = map.get(a.id);
    if (!prev) {
      map.set(a.id, a);
    } else {
      map.set(a.id, {
        ...prev,
        proxyUrl: a.proxyUrl ?? prev.proxyUrl,
        embedUrl: a.embedUrl ?? prev.embedUrl,
        filename: a.filename ?? prev.filename,
      });
    }
  });
  return Array.from(map.values());
}

/** Defensive passthrough kept for back-compat with older callers. */
export function sanitizeMediaList(list: MediaAsset[] | undefined): MediaAsset[] {
  return list ?? [];
}
