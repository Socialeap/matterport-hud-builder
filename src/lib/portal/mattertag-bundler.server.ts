/**
 * Server-only helper used at presentation export time to mirror Mattertag
 * file attachments into the downloaded .zip bundle, so the exported
 * presentation is fully self-contained and works from any static host
 * (Netlify, S3, the agent's own webserver, or just file://).
 *
 * Reuses the same Matterport GraphQL flow as the /api/mp-attachment
 * proxy route to resolve a fresh signed downloadUrl, then fetches the
 * bytes. Never persists anything to our backend storage.
 */

const MP_ID_RE = /^[A-Za-z0-9]{11}$/;
const ATTACHMENT_ID_RE = /^[A-Za-z0-9]{16,64}$/;
const MATTERPORT_APP_KEY = "h2f9mazn377g554gxkkay5aqd";
const MATTERPORT_ENDPOINT = "https://my.matterport.com/api/mp/models/graph";
const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES_PER_ATTACHMENT = 8 * 1024 * 1024; // 8MB hard cap per file

const GRAPHQL_QUERY = `query GetAttachments($modelId: ID!) {
  model(id: $modelId) {
    mattertags(includeDisabled: false) {
      id
      fileAttachments { id downloadUrl mimeType filename }
    }
  }
}`;

export interface ResolvedAttachment {
  /** Raw bytes ready to put into a zip entry. */
  bytes: Uint8Array;
  /** File extension WITHOUT the leading dot (`jpg`, `png`, etc.). */
  ext: string;
}

interface AttachmentMeta {
  downloadUrl: string;
  mimeType: string;
  filename: string;
}

const metaCache = new Map<string, Map<string, AttachmentMeta>>();

async function loadModelAttachmentMeta(
  modelId: string,
): Promise<Map<string, AttachmentMeta> | null> {
  if (metaCache.has(modelId)) return metaCache.get(modelId)!;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(MATTERPORT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-matterport-application-key": MATTERPORT_APP_KEY,
        Origin: "https://my.matterport.com",
        Referer: `https://my.matterport.com/show/?m=${modelId}`,
      },
      body: JSON.stringify({ query: GRAPHQL_QUERY, variables: { modelId } }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const payload = (await res.json()) as {
      data?: {
        model?: {
          mattertags?: Array<{
            id?: string;
            fileAttachments?: Array<{
              id?: string;
              downloadUrl?: string;
              mimeType?: string;
              filename?: string;
            }>;
          }>;
        };
      };
    };
    const tags = payload?.data?.model?.mattertags;
    if (!Array.isArray(tags)) return null;
    const map = new Map<string, AttachmentMeta>();
    for (const tag of tags) {
      const atts = tag?.fileAttachments;
      if (!Array.isArray(atts)) continue;
      for (const att of atts) {
        const id = String(att?.id ?? "");
        const url = String(att?.downloadUrl ?? "");
        if (!ATTACHMENT_ID_RE.test(id) || !/^https?:\/\//i.test(url)) continue;
        map.set(id, {
          downloadUrl: url,
          mimeType: String(att?.mimeType ?? "").toLowerCase(),
          filename: String(att?.filename ?? ""),
        });
      }
    }
    metaCache.set(modelId, map);
    // Cache eviction: short TTL so re-exports later still pick up fresh
    // signed URLs (downloadUrl tokens expire ~24h).
    setTimeout(() => metaCache.delete(modelId), 5 * 60 * 1000);
    return map;
  } catch (err) {
    clearTimeout(timer);
    console.error("[mattertag-bundler] meta lookup failed:", err);
    return null;
  }
}

function extFromMeta(meta: AttachmentMeta): string {
  const m = meta.mimeType;
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/gif") return "gif";
  if (m === "image/webp") return "webp";
  if (m === "image/avif") return "avif";
  if (m === "image/svg+xml") return "svg";
  const fn = meta.filename.toLowerCase();
  const dot = fn.lastIndexOf(".");
  if (dot >= 0 && dot < fn.length - 1) {
    const ext = fn.slice(dot + 1).replace(/[^a-z0-9]/g, "");
    if (ext.length > 0 && ext.length <= 5) return ext;
  }
  // Last-resort assumption: Matterport-uploaded media is overwhelmingly JPEG.
  return "jpg";
}

/**
 * Fetch a single Mattertag attachment's bytes + canonical extension.
 * Returns null on any failure so the caller can omit the file without
 * breaking the rest of the bundle.
 */
export async function fetchMattertagAttachment(args: {
  modelId: string;
  mattertagId: string;
  attachmentId: string;
}): Promise<ResolvedAttachment | null> {
  const { modelId, mattertagId, attachmentId } = args;
  if (!MP_ID_RE.test(modelId)) return null;
  if (!MP_ID_RE.test(mattertagId)) return null;
  if (!ATTACHMENT_ID_RE.test(attachmentId)) return null;

  const metaMap = await loadModelAttachmentMeta(modelId);
  if (!metaMap) return null;
  const meta = metaMap.get(attachmentId);
  if (!meta) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(meta.downloadUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES_PER_ATTACHMENT) {
      return null;
    }
    return { bytes: new Uint8Array(buf), ext: extFromMeta(meta) };
  } catch (err) {
    clearTimeout(timer);
    console.error("[mattertag-bundler] attachment fetch failed:", err);
    return null;
  }
}

/** Max byte cap for inlined branding/avatar assets (4 MB). Tighter than
 *  the Mattertag attachment cap because branding files are typically
 *  logos/icons/avatars — anything larger is almost certainly an
 *  unoptimized hero shot we'd rather leave as a remote URL. */
const MAX_BYTES_PER_BRANDING = 4 * 1024 * 1024;

function extFromContentType(ct: string | null | undefined): string | null {
  if (!ct) return null;
  const m = ct.toLowerCase().split(";")[0].trim();
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/gif") return "gif";
  if (m === "image/webp") return "webp";
  if (m === "image/avif") return "avif";
  if (m === "image/svg+xml") return "svg";
  if (m === "image/x-icon" || m === "image/vnd.microsoft.icon") return "ico";
  return null;
}

function extFromUrlPath(url: string): string | null {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    const dot = path.lastIndexOf(".");
    if (dot < 0 || dot === path.length - 1) return null;
    const ext = path.slice(dot + 1).replace(/[^a-z0-9]/g, "");
    if (ext.length === 0 || ext.length > 5) return null;
    return ext;
  } catch {
    return null;
  }
}

/**
 * Fetch a Matterport photo/gif asset for bundling into the exported
 * .zip. Uses the stable token-free permalink
 * `https://my.matterport.com/resources/model/{m}/image/{id}` (same URL
 * the /api/mp-image proxy redirects to). Returns null on any failure
 * so the caller can leave the remote URL in place.
 */
export async function fetchMatterportImage(args: {
  modelId: string;
  assetId: string;
}): Promise<ResolvedAttachment | null> {
  const { modelId, assetId } = args;
  if (!MP_ID_RE.test(modelId) || !MP_ID_RE.test(assetId)) return null;
  const url = `https://my.matterport.com/resources/model/${modelId}/image/${assetId}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES_PER_ATTACHMENT) {
      return null;
    }
    const ext =
      extFromContentType(res.headers.get("content-type")) ||
      extFromUrlPath(res.url || url) ||
      "jpg";
    return { bytes: new Uint8Array(buf), ext };
  } catch (err) {
    clearTimeout(timer);
    console.error("[mattertag-bundler] mp image fetch failed:", err);
    return null;
  }
}

/**
 * Fetch an arbitrary public http(s) asset (typically a branding image
 * stored in Supabase Storage — logo, favicon, hero, agent avatar) for
 * bundling into the exported .zip. Capped at 4 MB. Returns null on
 * non-http URLs, oversize bodies, or any network failure.
 */
export async function fetchPublicAsset(
  url: string,
): Promise<ResolvedAttachment | null> {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES_PER_BRANDING) {
      return null;
    }
    const ext =
      extFromContentType(res.headers.get("content-type")) ||
      extFromUrlPath(url) ||
      "png";
    return { bytes: new Uint8Array(buf), ext };
  } catch (err) {
    clearTimeout(timer);
    console.error("[mattertag-bundler] public asset fetch failed:", err);
    return null;
  }
}

/**
 * Run a list of async tasks with bounded concurrency. Order is preserved
 * in the returned array.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
      }
    },
  );
  await Promise.all(runners);
  return results;
}
