/**
 * Matterport MHTML parser.
 *
 * Pure function — no DOM, no React, no I/O.
 * Parses a saved Matterport "Media" page (saved as Single-File MHTML),
 * extracts persistent Asset IDs for videos, photos, and GIFs, and pulls
 * the **actual signed CDN URLs** Matterport already embedded in the page.
 *
 * Why client-side: zero upload bandwidth, zero storage, instant UX.
 * The "delete after parsing" requirement is satisfied automatically since
 * the file never leaves the browser.
 *
 * IMPORTANT — what works and what doesn't:
 *  - PHOTOS / GIFs: the MHTML contains real cdn-2 signed URLs we can use
 *    directly in <img> tags. Tokens (`?t=...`) typically remain valid for
 *    days; we keep them as-is and surface a "re-sync" hint after 7 days.
 *  - VIDEOS: Matterport NEVER exposes a direct mp4/webm URL in the page —
 *    only a poster image. There is no embeddable video URL we can store.
 *    We capture the poster and fall back to opening the model's share page
 *    when the user clicks the carousel video tile.
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

/** Decode HTML entities the parser needs to handle (the page is HTML inside MIME). */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Detect the 11-char public Model ID. */
function findModelId(text: string): string | null {
  const showMatch = text.match(new RegExp(`my\\.matterport\\.com/(?:show/\\?m|models|work\\?m)=?(${ID_PATTERN})`, "i"));
  if (showMatch?.[1]) return showMatch[1];
  const m2 = text.match(new RegExp(`my\\.matterport\\.com/work\\?m=(${ID_PATTERN})`, "i"));
  if (m2?.[1]) return m2[1];
  const m3 = text.match(new RegExp(`/models/(${ID_PATTERN})(?:[?/&"\\s])`));
  if (m3?.[1]) return m3[1];
  return null;
}

/**
 * Extract every thumbnail-card block. Each block contains the assetId,
 * a sibling <img alt="FILENAME.ext" src="POSTER_URL"> with the real
 * filename (definitive kind hint) and a poster URL.
 */
interface RawCard {
  assetId: string;
  filename: string | null;
  posterUrl: string | null;
}

function extractCards(text: string): RawCard[] {
  const cards: RawCard[] = [];
  const cardRe = new RegExp(
    `data-testid="thumbnail-card-(${ID_PATTERN})"[\\s\\S]{0,1500}?<img[^>]*\\salt="([^"]*)"[^>]*\\ssrc="([^"]*)"`,
    "g"
  );
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(text)) !== null) {
    cards.push({
      assetId: m[1],
      filename: m[2] || null,
      posterUrl: m[3] ? decodeHtmlEntities(m[3]) : null,
    });
  }
  // Fallback: any thumbnail-card without a paired <img> (defensive — shouldn't happen on real Matterport pages)
  const knownIds = new Set(cards.map((c) => c.assetId));
  const idOnlyRe = new RegExp(`data-testid="thumbnail-card-(${ID_PATTERN})"`, "g");
  let im: RegExpExecArray | null;
  while ((im = idOnlyRe.exec(text)) !== null) {
    if (!knownIds.has(im[1])) {
      cards.push({ assetId: im[1], filename: null, posterUrl: null });
      knownIds.add(im[1]);
    }
  }
  return cards;
}

/** Find the largest signed apifs URL for this assetId (the full-size, not the 320x320 thumbnail crop). */
function findApifsUrl(text: string, modelId: string, assetId: string): string | null {
  // Match URLs and pick one without a `width=` crop param (full-size). Otherwise fall back to any.
  const re = new RegExp(
    `https://cdn-2\\.matterport\\.com/apifs/models/${modelId}/images/${assetId}/[^\\s"'<>&]+(?:&amp;[^\\s"'<>]*)*`,
    "g"
  );
  const candidates = [...new Set([...text.matchAll(re)].map((m) => decodeHtmlEntities(m[0])))];
  if (candidates.length === 0) return null;
  // Prefer the URL with no width/height params (full resolution).
  const fullSize = candidates.find((u) => !/[?&](width|height)=/i.test(u));
  if (fullSize) return fullSize;
  // Otherwise prefer the largest (highest width number).
  candidates.sort((a, b) => {
    const wa = Number(a.match(/[?&]width=(\d+)/i)?.[1] ?? 0);
    const wb = Number(b.match(/[?&]width=(\d+)/i)?.[1] ?? 0);
    return wb - wa;
  });
  return candidates[0];
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
  // Drop extension, replace separators, title-case-ish
  const stem = filename.replace(/\.[a-z0-9]+$/i, "");
  return stem.replace(/[-_]+/g, " ").trim() || fallback;
}

/**
 * Build the public "Open in Matterport" share URL for the model. We use
 * this for video tiles (since Matterport doesn't expose direct mp4 URLs).
 * The fragment hint helps users land near the video player area.
 */
function modelShareUrl(modelId: string): string {
  return `https://my.matterport.com/show/?m=${modelId}`;
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
  const syncedAt = new Date().toISOString();
  const shareUrl = modelShareUrl(modelId);
  let videoCount = 0;
  let photoCount = 0;
  let gifCount = 0;

  for (const card of cards) {
    const kind = classifyByFilename(card.filename);
    const apifsUrl = findApifsUrl(text, modelId, card.assetId);
    const posterUrl = card.posterUrl ?? undefined;

    if (kind === "video") {
      videoCount += 1;
      // Matterport does NOT expose a direct mp4 URL in the MHTML — we use the
      // model's share page as a click-through fallback and rely on the poster.
      videos.push({
        id: card.assetId,
        kind: "video",
        url: shareUrl,
        embeddable: false,
        posterUrl,
        filename: card.filename ?? undefined,
        label: prettyLabel(card.filename, `Clip ${videoCount}`),
        syncedAt,
        visible: true,
      });
    } else if (kind === "gif") {
      gifCount += 1;
      // Prefer the apifs gif URL if present, else fall back to the poster (an animation render).
      const url = apifsUrl ?? posterUrl ?? shareUrl;
      gifs.push({
        id: card.assetId,
        kind: "gif",
        url,
        embeddable: !!(apifsUrl || posterUrl),
        posterUrl,
        filename: card.filename ?? undefined,
        label: prettyLabel(card.filename, `GIF ${gifCount}`),
        syncedAt,
        visible: true,
      });
    } else {
      photoCount += 1;
      const url = apifsUrl ?? posterUrl ?? shareUrl;
      photos.push({
        id: card.assetId,
        kind: "photo",
        url,
        embeddable: !!(apifsUrl || posterUrl),
        posterUrl,
        filename: card.filename ?? undefined,
        label: prettyLabel(card.filename, `Photo ${photoCount}`),
        syncedAt,
        visible: true,
      });
    }
  }

  return { modelId, videos, photos, gifs };
}

/**
 * Merge newly-parsed assets into an existing list, deduping by asset id.
 * Existing entries are preserved (so user-toggled visibility/labels survive),
 * but their `url`, `posterUrl`, and `syncedAt` are refreshed from the
 * incoming parse — signed tokens expire, so a re-sync MUST update them.
 */
export function mergeAssets(existing: MediaAsset[] | undefined, incoming: MediaAsset[]): MediaAsset[] {
  const map = new Map<string, MediaAsset>();
  (existing ?? []).forEach((a) => map.set(a.id, a));
  incoming.forEach((a) => {
    const prev = map.get(a.id);
    if (!prev) {
      map.set(a.id, a);
    } else {
      // Refresh URLs + syncedAt; preserve user toggles (visible) and any custom label override.
      map.set(a.id, {
        ...prev,
        url: a.url,
        posterUrl: a.posterUrl ?? prev.posterUrl,
        embeddable: a.embeddable,
        syncedAt: a.syncedAt ?? prev.syncedAt,
        filename: a.filename ?? prev.filename,
      });
    }
  });
  return Array.from(map.values());
}

/**
 * Sanitize a media list — defensive only. Previously stripped `?t=` tokens;
 * we now KEEP them (Matterport's CDN requires the signed token to serve
 * the bytes). This function is now a passthrough for back-compat.
 */
export function sanitizeMediaList(list: MediaAsset[] | undefined): MediaAsset[] {
  return list ?? [];
}
