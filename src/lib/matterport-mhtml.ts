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
 *   - proxyUrl  — for photos/gifs:
 *                   `https://my.matterport.com/resources/model/{modelId}/image/{assetId}`
 *                   This is Matterport's stable, token-free permalink — the same
 *                   pattern used for video clips (`/clip/{assetId}`). No signed
 *                   token; Matterport handles auth server-side for public models.
 *   - embedUrl  — for videos: Matterport's official iframeable clip player.
 *
 * Why we use the /resources/ URL instead of the CDN URL:
 *   Signed CDN URLs (cdn-2.matterport.com) extracted from the MHTML expire in
 *   ~1 h and are refused cross-origin. The /resources/ permalink is stable and
 *   works indefinitely for public models — no scraping or token management needed.
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
 *
 * NOTE: only apply this to the HTML MIME part, not to base64 image parts —
 * base64 data contains "=" padding chars that must not be QP-decoded.
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

/**
 * Extract the HTML MIME part from the raw MHTML text, then QP-decode it.
 *
 * In a well-formed MHTML file the HTML part is first and has
 * Content-Transfer-Encoding: quoted-printable.  We locate the boundary,
 * split off the first part, and decode only that — leaving base64 image
 * parts untouched so they aren't corrupted by the QP decoder.
 *
 * Falls back gracefully to decoding the entire text (old behaviour) if the
 * MIME structure cannot be parsed, so existing tests / edge cases are safe.
 */
function extractAndDecodeHtmlPart(raw: string): string {
  // Locate the multipart boundary
  const boundaryMatch = raw.match(
    /Content-Type:\s*multipart\/[^;]+;\s*(?:[^;]+;\s*)?boundary="?([^"\r\n]+)"?/i
  );
  if (!boundaryMatch) {
    // Not a multipart MHTML — try decoding the whole thing (single-part QP)
    const isQP =
      /Content-Transfer-Encoding:\s*quoted-printable/i.test(raw) ||
      /=3D"/.test(raw);
    return isQP ? decodeQuotedPrintable(raw) : raw;
  }

  const boundary = boundaryMatch[1].trim();
  const delimiter = `--${boundary}`;

  // Split into parts; skip preamble (before first boundary)
  const parts = raw.split(delimiter);
  // parts[0]  = preamble (ignored)
  // parts[1…] = MIME parts (each starts with headers then blank line then body)
  // parts[last] = "--\r\n" end marker

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part.trimStart().startsWith("--")) continue; // end boundary

    // Find where headers end (blank line)
    const blankLine = part.match(/\r?\n\r?\n/);
    if (!blankLine || blankLine.index === undefined) continue;

    const headers = part.slice(0, blankLine.index);
    const body = part.slice(blankLine.index + blankLine[0].length);

    const isHtml = /Content-Type:\s*text\/html/i.test(headers);
    if (!isHtml) continue;

    const isQP = /Content-Transfer-Encoding:\s*quoted-printable/i.test(headers);
    return isQP ? decodeQuotedPrintable(body) : body;
  }

  // Fallback: no text/html part found — decode the whole thing
  const isQP =
    /Content-Transfer-Encoding:\s*quoted-printable/i.test(raw) ||
    /=3D"/.test(raw);
  return isQP ? decodeQuotedPrintable(raw) : raw;
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
 * Extract every thumbnail-card block.
 *
 * For each block we capture:
 *   assetId  — from data-testid="thumbnail-card-{assetId}"
 *   filename — from the nearby <img alt="FILENAME.ext"> (best kind hint)
 *   imgSrc   — from the nearby <img src="https://cdn-2.matterport.com/...">
 *              (a live signed CDN URL valid for ~1 h after the MHTML was saved)
 *
 * Strategy:
 *   1. Walk the text finding all thumbnail-card data-testid matches.
 *   2. For each match, look ahead up to 2 000 chars to find the first <img>.
 *   3. Extract both src and alt from that img tag (attribute order-independent).
 */
interface RawCard {
  assetId: string;
  filename: string | null;
  /** Direct CDN URL extracted from the MHTML's <img src>. May be null if not found. */
  imgSrc: string | null;
}

function extractCards(text: string): RawCard[] {
  const cards: RawCard[] = [];
  const seen = new Set<string>();

  const cardRe = new RegExp(`data-testid="thumbnail-card-(${ID_PATTERN})"`, "g");
  let m: RegExpExecArray | null;

  while ((m = cardRe.exec(text)) !== null) {
    const assetId = m[1];
    if (seen.has(assetId)) continue;
    seen.add(assetId);

    // Lookahead window: 2 000 chars should cover any inline markup between
    // the data-testid attribute and its associated <img>.
    const window = text.slice(m.index, m.index + 2000);

    let filename: string | null = null;
    let imgSrc: string | null = null;

    // Match the first <img ...> in the window (self-closing or not)
    const imgTagMatch = window.match(/<img\b([^>]*)>/i);
    if (imgTagMatch) {
      const attrs = imgTagMatch[1];
      const altMatch = attrs.match(/\balt="([^"]*)"/i);
      const srcMatch = attrs.match(/\bsrc="(https?:\/\/[^"]*)"/i);
      filename = altMatch?.[1] ?? null;
      imgSrc = srcMatch?.[1] ?? null;
    }

    cards.push({ assetId, filename, imgSrc });
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

function buildResourceUrl(modelId: string, assetId: string): string {
  return `https://my.matterport.com/resources/model/${modelId}/image/${assetId}`;
}

function buildClipEmbedUrl(modelId: string, assetId: string): string {
  return `https://my.matterport.com/resources/model/${modelId}/clip/${assetId}`;
}

/** Parse a Matterport MHTML file (as a string). Pure & synchronous. */
export function parseMatterportMhtml(rawText: string): ParsedMhtml {
  // Decode only the HTML MIME part to avoid corrupting base64 image parts.
  const text = extractAndDecodeHtmlPart(rawText);

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
        // Videos use embedUrl (iframe clip player); no /image/ resource URL.
        proxyUrl: undefined,
        filename: card.filename ?? undefined,
        label: prettyLabel(card.filename, `Clip ${videoCount}`),
        visible: true,
      });
    } else if (kind === "gif") {
      gifCount += 1;
      gifs.push({
        id: card.assetId,
        kind: "gif",
        proxyUrl: buildResourceUrl(modelId, card.assetId),
        filename: card.filename ?? undefined,
        label: prettyLabel(card.filename, `GIF ${gifCount}`),
        visible: true,
      });
    } else {
      photoCount += 1;
      photos.push({
        id: card.assetId,
        kind: "photo",
        proxyUrl: buildResourceUrl(modelId, card.assetId),
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
