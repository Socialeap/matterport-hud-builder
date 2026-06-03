/**
 * Atlas curation enrichment (server-only).
 *
 * Resolves a place from name + address and drafts Atlas listing metadata for the
 * admin Curated Listing Assistant. Preference order:
 *   1. Google Places (legacy Text Search + Details) when GOOGLE_PLACES_API_KEY is
 *      present in the server runtime — gives place_id, exact lat/lng, formatted
 *      address, types, website, phone, and multi-match candidates.
 *   2. Free city-level geocode (Census + Nominatim) via geocodeAddress().
 *   3. Manual entry by the admin (handled in the UI / update fn).
 *
 * Server-only: reads process.env and uses geocode.server. Reached exclusively via
 * dynamic import inside server-fn handlers, so it never enters the client bundle.
 * Only the fixed Google host is fetched (no arbitrary/user URLs → no SSRF).
 */
import { geocodeAddress } from "@/server/geocode.server";
import { renderAtlasLiveTour, type AtlasLiveTourStop } from "./atlas-live-tour";
import type {
  AtlasCurationDraft,
  AtlasPlaceCandidate,
} from "./atlas-demo-data";

const PLACES_TEXT_SEARCH =
  "https://maps.googleapis.com/maps/api/place/textsearch/json";
const PLACES_DETAILS = "https://maps.googleapis.com/maps/api/place/details/json";
const DETAILS_FIELDS =
  "place_id,name,formatted_address,geometry,types,website,formatted_phone_number,address_components";
const FETCH_TIMEOUT_MS = 6000;
const MAX_CANDIDATES = 5;

function placesKey(): string | null {
  const k = (process.env.GOOGLE_PLACES_API_KEY ?? "").trim();
  return k.length > 0 ? k : null;
}

export function placesAvailable(): boolean {
  return placesKey() !== null;
}

interface GoogleAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

export interface ResolvedPlace {
  place_id: string;
  name: string;
  formatted_address: string;
  latitude: number | null;
  longitude: number | null;
  types: string[];
  website: string | null;
  phone: string | null;
  city: string;
  region: string;
  country: string;
}

async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pickComponent(
  components: GoogleAddressComponent[],
  type: string,
  field: "long_name" | "short_name" = "long_name",
): string {
  const c = components.find((x) => x.types.includes(type));
  return c ? c[field] : "";
}

function parseComponents(components: GoogleAddressComponent[]): {
  city: string;
  region: string;
  country: string;
} {
  const city =
    pickComponent(components, "locality") ||
    pickComponent(components, "postal_town") ||
    pickComponent(components, "sublocality") ||
    pickComponent(components, "administrative_area_level_2");
  const region = pickComponent(components, "administrative_area_level_1", "short_name");
  const country = pickComponent(components, "country", "short_name") || "US";
  return { city, region, country };
}

/**
 * Google Places Text Search. Returns up to MAX_CANDIDATES candidates and whether
 * Places was even available (no key → available:false, empty candidates).
 */
export async function resolvePlaceCandidates(
  query: string,
): Promise<{ available: boolean; candidates: AtlasPlaceCandidate[] }> {
  const key = placesKey();
  if (!key || !query.trim()) return { available: Boolean(key), candidates: [] };

  const url = `${PLACES_TEXT_SEARCH}?query=${encodeURIComponent(query.trim())}&key=${key}`;
  const data = (await fetchJson(url)) as
    | { status?: string; results?: Array<Record<string, unknown>> }
    | null;
  if (!data || (data.status !== "OK" && data.status !== "ZERO_RESULTS")) {
    return { available: true, candidates: [] };
  }
  const results = Array.isArray(data.results) ? data.results : [];
  const candidates: AtlasPlaceCandidate[] = results
    .slice(0, MAX_CANDIDATES)
    .map((r) => {
      const geometry = r.geometry as { location?: { lat?: number; lng?: number } } | undefined;
      const loc = geometry?.location;
      return {
        place_id: String(r.place_id ?? ""),
        name: String(r.name ?? ""),
        formatted_address: String(r.formatted_address ?? ""),
        latitude: typeof loc?.lat === "number" ? loc.lat : null,
        longitude: typeof loc?.lng === "number" ? loc.lng : null,
        types: Array.isArray(r.types) ? (r.types as string[]) : [],
      };
    })
    .filter((c) => c.place_id);
  return { available: true, candidates };
}

/** Google Place Details for a specific place_id → full resolved place. */
export async function fetchPlaceDetails(placeId: string): Promise<ResolvedPlace | null> {
  const key = placesKey();
  if (!key || !placeId) return null;
  const url = `${PLACES_DETAILS}?place_id=${encodeURIComponent(placeId)}&fields=${DETAILS_FIELDS}&key=${key}`;
  const data = (await fetchJson(url)) as
    | { status?: string; result?: Record<string, unknown> }
    | null;
  if (!data || data.status !== "OK" || !data.result) return null;
  const r = data.result;
  const geometry = r.geometry as { location?: { lat?: number; lng?: number } } | undefined;
  const loc = geometry?.location;
  const components = (Array.isArray(r.address_components)
    ? r.address_components
    : []) as GoogleAddressComponent[];
  const { city, region, country } = parseComponents(components);
  return {
    place_id: String(r.place_id ?? placeId),
    name: String(r.name ?? ""),
    formatted_address: String(r.formatted_address ?? ""),
    latitude: typeof loc?.lat === "number" ? loc.lat : null,
    longitude: typeof loc?.lng === "number" ? loc.lng : null,
    types: Array.isArray(r.types) ? (r.types as string[]) : [],
    website: typeof r.website === "string" ? r.website : null,
    phone: typeof r.formatted_phone_number === "string" ? r.formatted_phone_number : null,
    city,
    region,
    country,
  };
}

/** Free city-level geocode fallback (no API key). Returns null on no match. */
export async function cityLevelGeocode(
  city: string,
  region: string,
): Promise<{ lat: number; lng: number } | null> {
  if (!city.trim() || !region.trim()) return null;
  return geocodeAddress({ city: city.trim(), region: region.trim() });
}

/** Map Google place types → an Atlas category. */
export function inferCategory(types: string[]): string {
  const t = new Set(types);
  if (t.has("restaurant") || t.has("cafe") || t.has("bar") || t.has("food") || t.has("bakery"))
    return "restaurant";
  if (t.has("lodging") || t.has("hotel")) return "hotel";
  if (t.has("art_gallery")) return "gallery";
  if (t.has("museum") || t.has("tourist_attraction") || t.has("place_of_worship") || t.has("library"))
    return "cultural";
  if (t.has("gym") || t.has("spa") || t.has("health")) return "wellness";
  if (t.has("store") || t.has("shopping_mall") || t.has("clothing_store") || t.has("furniture_store"))
    return "retail";
  if (t.has("stadium") || t.has("convention_center") || t.has("banquet_hall")) return "event_space";
  return "other";
}

/**
 * Assemble the editable Atlas draft from admin inputs + (optional) resolved place.
 * Neutral, truthful copy — never implies partnership/endorsement.
 */
export function buildDraft(args: {
  inputName: string;
  inputAddress: string;
  inputCategory: string;
  inputCity: string;
  inputRegion: string;
  inputCountry: string;
  resolved: ResolvedPlace | null;
  latitude: number | null;
  longitude: number | null;
}): AtlasCurationDraft {
  const resolved = args.resolved;
  const title = (args.inputName || resolved?.name || "").trim();
  const city = (resolved?.city || args.inputCity || "").trim();
  const region = (resolved?.region || args.inputRegion || "").trim();
  const country = (resolved?.country || args.inputCountry || "US").trim().toUpperCase().slice(0, 2) || "US";
  const address = (resolved?.formatted_address || args.inputAddress || "").trim();
  const category =
    args.inputCategory.trim() ||
    (resolved ? inferCategory(resolved.types) : "other");

  const loc = [city, region].filter(Boolean).join(", ");
  const summary = title
    ? `Curated showcase of ${title}${loc ? ` in ${loc}` : ""}. Step inside this immersive 3D space on the Frontiers3D Atlas.`
    : "";

  const tags = Array.from(
    new Set(
      ["curated", category, ...(resolved?.types ?? []).slice(0, 3)]
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ).slice(0, 12);

  return {
    title,
    category,
    summary,
    tags,
    address,
    city,
    region,
    country,
    latitude: args.latitude,
    longitude: args.longitude,
    hero_image_url: "",
  };
}

// ── Minimal-but-real curated presentation package ────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "frontiers3d-presentation"
  );
}

export interface CuratedPackageInput {
  curationJobId: string;
  matterportId: string;
  title: string;
  summary: string;
  category: string;
  city: string;
  region: string;
  tags: string[];
  heroImageUrl: string;
  /**
   * Optional destination for the "Own this listing? Claim / contact" CTA.
   * Must be an http(s) URL (validated; anything else is dropped). When absent
   * the CTA is not rendered — the showcase stays neutral and link-free.
   */
  claimUrl?: string;
  /**
   * Optional pre-saved Explore Together tour stops. Atlas showcases carry none
   * today (no backend), so the shared-tour panel shows a friendly empty note.
   */
  liveTourStops?: AtlasLiveTourStop[];
}

export interface CuratedPackageResult {
  base64: string;
  filename: string;
  sizeBytes: number;
}

// Accent used across the curated page chrome + the Live Tour shell (buttons,
// remote pointer, pulse pill). Matches the Frontiers3D indigo brand tone.
const CURATED_ACCENT = "#818cf8";

/** Allow only http(s) absolute URLs through to an href (drops javascript:, data:, etc.). */
function safeHttpUrl(value: string | undefined | null): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Render a self-contained, default-branded Frontiers3D presentation page that
 * embeds the curated Matterport tour. Minimal but real: a single index.html
 * with inline styles, the live Matterport iframe, and the approved HUD set —
 * Share, About/Summary, an optional Claim CTA, and the "Explore Together"
 * shared live tour (voice + synced views + annotations). No build step;
 * deployable as-is (the Live Tour runtime is inlined, PeerJS loads from CDN).
 */
function renderCuratedHtml(input: CuratedPackageInput): string {
  const title = escapeHtml(input.title || "Frontiers3D Showcase");
  const loc = escapeHtml([input.city, input.region].filter(Boolean).join(", "));
  const summary = escapeHtml(input.summary || "");
  const desc = summary || `${title}${loc ? ` — ${loc}` : ""}. An immersive 3D showcase on the Frontiers3D Atlas.`;
  const embedSrc = `https://my.matterport.com/show/?m=${encodeURIComponent(input.matterportId)}&play=1`;
  const claimUrl = safeHttpUrl(input.claimUrl);
  const tags = (input.tags ?? []).filter((t) => typeof t === "string" && t.trim()).slice(0, 12);

  const liveTour = renderAtlasLiveTour({
    accentColor: CURATED_ACCENT,
    matterportEmbedSrc: embedSrc,
    shareTitle: input.title || "Frontiers3D Showcase",
    stops: input.liveTourStops,
  });

  const tagsHtml = tags.length
    ? `<div class="about-tags">${tags
        .map((t) => `<span class="about-tag">${escapeHtml(t)}</span>`)
        .join("")}</div>`
    : "";
  const claimBtnHtml = claimUrl
    ? `<a class="f3d-iconbtn f3d-claim" href="${escapeHtml(claimUrl)}" target="_blank" rel="noopener noreferrer" title="Own this listing? Claim or contact">Own this listing?</a>`
    : "";
  const claimAboutHtml = claimUrl
    ? `<a class="about-claim" href="${escapeHtml(claimUrl)}" target="_blank" rel="noopener noreferrer">Own this listing? Claim or contact &rarr;</a>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Frontiers3D</title>
<meta name="description" content="${escapeHtml(desc)}" />
<meta property="og:title" content="${title} — Frontiers3D" />
<meta property="og:description" content="${escapeHtml(desc)}" />
<style>
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;background:#0a0e27;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  body{display:flex;flex-direction:column}
  .f3d-bar{display:flex;align-items:center;gap:.75rem;padding:.5rem 1rem;background:rgba(10,14,39,.92);border-bottom:1px solid rgba(255,255,255,.08);backdrop-filter:blur(8px);position:relative;z-index:1300}
  .f3d-logo{font-weight:800;letter-spacing:.18em;font-size:.8rem;flex-shrink:0}
  .f3d-logo span{background:linear-gradient(90deg,#67e8f9,#818cf8);-webkit-background-clip:text;background-clip:text;color:transparent}
  .f3d-meta{display:flex;flex-direction:column;min-width:0;line-height:1.2}
  .f3d-title{font-weight:700;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .f3d-loc{font-size:.7rem;color:#94a3b8}
  .f3d-actions{margin-left:auto;display:flex;align-items:center;gap:.4rem;flex-shrink:0}
  .f3d-iconbtn{appearance:none;display:inline-flex;align-items:center;gap:.35rem;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);color:#fff;border-radius:7px;padding:.4rem .7rem;font:600 12px/1 inherit;font-family:inherit;cursor:pointer;text-decoration:none;transition:background .18s,opacity .18s}
  .f3d-iconbtn:hover{background:rgba(255,255,255,.15)}
  .f3d-iconbtn svg{width:14px;height:14px}
  .f3d-iconbtn.lt-launch{background:${CURATED_ACCENT};border-color:${CURATED_ACCENT}}
  .f3d-iconbtn.lt-launch:hover{opacity:.9;background:${CURATED_ACCENT}}
  .f3d-claim{border-color:rgba(129,140,248,.45);background:rgba(129,140,248,.14);color:#c7d2fe}
  .f3d-claim:hover{background:rgba(129,140,248,.24)}
  @media(max-width:560px){.f3d-iconbtn .f3d-btn-label{display:none}.f3d-iconbtn{padding:.4rem .5rem}}
  .f3d-stage{position:relative;flex:1;min-height:0}
  .f3d-frame{position:absolute;inset:0;width:100%;height:100%;border:0;background:#020617}
  .f3d-foot{padding:.5rem 1rem;font-size:.72rem;color:#94a3b8;background:#070b1f;border-top:1px solid rgba(255,255,255,.05)}
  body.live-tour-active .f3d-foot{display:none}

  /* ── About / Summary panel ─────────────────────────────────────── */
  .about-backdrop{position:fixed;inset:0;z-index:2200;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(8px);padding:16px}
  .about-backdrop.open{display:flex}
  .about-box{position:relative;width:min(520px,94vw);max-height:84vh;overflow-y:auto;background:rgba(18,20,34,.96);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:20px 22px;box-shadow:0 25px 80px -15px rgba(0,0,0,.75)}
  .about-close{position:absolute;top:12px;right:12px;width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,.1);border:none;color:rgba(255,255,255,.75);font-size:16px;cursor:pointer}
  .about-close:hover{background:rgba(255,255,255,.2)}
  .about-title{font-size:18px;font-weight:700;margin:0 4px 2px 0;padding-right:28px}
  .about-loc{font-size:12px;color:#94a3b8;margin-bottom:12px}
  .about-summary{font-size:13.5px;line-height:1.6;color:rgba(255,255,255,.85);white-space:pre-wrap;margin:0 0 14px}
  .about-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
  .about-tag{font-size:11px;font-weight:600;color:#c7d2fe;background:rgba(129,140,248,.12);border:1px solid rgba(129,140,248,.25);padding:3px 9px;border-radius:999px}
  .about-claim{display:inline-block;margin-top:4px;font-size:12.5px;font-weight:600;color:#c7d2fe;text-decoration:none;border-bottom:1px solid rgba(199,210,254,.4)}
  .about-claim:hover{color:#fff}

${liveTour.css}
</style>
${liveTour.headHtml}
</head>
<body>
<header class="f3d-bar">
  <span class="f3d-logo">FRONTIERS<span>3D</span></span>
  <div class="f3d-meta">
    <span class="f3d-title">${title}</span>
    ${loc ? `<span class="f3d-loc">${loc}</span>` : ""}
  </div>
  <div class="f3d-actions">
    ${liveTour.launchButtonHtml}
    <button id="about-btn" type="button" class="f3d-iconbtn" title="About this showcase">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      <span class="f3d-btn-label">About</span>
    </button>
    <button id="share-btn" type="button" class="f3d-iconbtn" title="Share this showcase">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
      <span class="f3d-btn-label">Share</span>
    </button>
    ${claimBtnHtml}
  </div>
</header>
${liveTour.toolbarHtml}
<main class="f3d-stage" id="viewer">
  <div id="anno-letterbox-wrap">
    <iframe id="matterport-frame" class="f3d-frame" src="${embedSrc}" title="${title} — 3D tour"
      allow="xr-spatial-tracking; gyroscope; accelerometer; fullscreen; autoplay"
      allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe>
    ${liveTour.stageOverlayHtml}
  </div>
</main>
${summary ? `<footer class="f3d-foot">${summary}</footer>` : ""}

<!-- About / Summary panel -->
<div id="about-panel" class="about-backdrop" role="dialog" aria-modal="true" aria-label="About this showcase">
  <div class="about-box">
    <button id="about-close" class="about-close" type="button" aria-label="Close">&times;</button>
    <h2 class="about-title">${title}</h2>
    ${loc ? `<div class="about-loc">${loc}</div>` : ""}
    ${summary ? `<p class="about-summary">${summary}</p>` : `<p class="about-summary">An immersive 3D showcase on the Frontiers3D Atlas.</p>`}
    ${tagsHtml}
    ${claimAboutHtml}
  </div>
</div>

${liveTour.bodyHtml}
${liveTour.scriptHtml}
<script>
(function(){
  // ── Page chrome: Share + About (no backslashes / regex here so this
  //    inline block stays trivially correct without a verify guard). ──
  var aboutBtn=document.getElementById("about-btn");
  var aboutPanel=document.getElementById("about-panel");
  var aboutClose=document.getElementById("about-close");
  function openAbout(){ if(aboutPanel) aboutPanel.classList.add("open"); }
  function closeAbout(){ if(aboutPanel) aboutPanel.classList.remove("open"); }
  if(aboutBtn) aboutBtn.addEventListener("click",openAbout);
  if(aboutClose) aboutClose.addEventListener("click",closeAbout);
  if(aboutPanel) aboutPanel.addEventListener("click",function(e){ if(e.target===aboutPanel) closeAbout(); });
  document.addEventListener("keydown",function(e){ if(e.key==="Escape") closeAbout(); });

  var shareBtn=document.getElementById("share-btn");
  var SHARE_TITLE=${JSON.stringify((input.title || "Frontiers3D Showcase")).replace(/</g, "\\u003c")};
  function pageUrl(){ try { return String(window.location.href).split("#")[0]; } catch(_e){ return ""; } }
  function flashShare(label){
    if(!shareBtn) return;
    var lbl=shareBtn.querySelector(".f3d-btn-label");
    var prev=lbl?lbl.textContent:"";
    if(lbl) lbl.textContent=label;
    setTimeout(function(){ if(lbl) lbl.textContent=prev||"Share"; },2000);
  }
  if(shareBtn){
    shareBtn.addEventListener("click",function(){
      var url=pageUrl();
      var data={ title:SHARE_TITLE, text:SHARE_TITLE+" — an immersive 3D showcase on Frontiers3D", url:url };
      if(navigator&&typeof navigator.share==="function"){
        navigator.share(data).then(function(){},function(){ copyUrl(url); });
        return;
      }
      copyUrl(url);
    });
  }
  function copyUrl(url){
    if(navigator&&navigator.clipboard&&typeof navigator.clipboard.writeText==="function"){
      navigator.clipboard.writeText(url).then(function(){ flashShare("Link copied"); },function(){ flashShare("Copy failed"); });
    } else {
      flashShare("Copy unavailable");
    }
  }
})();
</script>
</body>
</html>`;
}

/**
 * The files that make up a curated showcase folder: index.html (branded
 * Matterport embed) + atlas-manifest.json. Shared by the downloadable zip and
 * the GitHub-repo publishing path so both produce an identical folder.
 */
export function buildShowcaseFiles(input: CuratedPackageInput): Record<string, string> {
  const manifest = {
    service: "frontiers3d-atlas",
    version: 1 as const,
    kind: "curated_showcase" as const,
    curation_job_id: input.curationJobId,
    matterport_id: input.matterportId,
    issued_at: new Date().toISOString(),
  };
  return {
    "index.html": renderCuratedHtml(input),
    "atlas-manifest.json": JSON.stringify(manifest, null, 2),
  };
}

/**
 * Build the curated package zip (flat root: index.html + atlas-manifest.json).
 * Reuses fflate (Node-compatible) + the Atlas manifest shape. Returns base64 so
 * the admin server fn can hand it straight to the browser for download — the
 * package is a few KB (the Matterport tour is embedded, not bundled).
 */
export async function buildCuratedPackageZip(
  input: CuratedPackageInput,
): Promise<CuratedPackageResult> {
  const { zipSync, strToU8 } = await import("fflate");
  const files = buildShowcaseFiles(input);
  const zipInput: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    zipInput[path] = strToU8(content);
  }
  const zipped = zipSync(zipInput, { level: 6 });
  return {
    base64: Buffer.from(zipped).toString("base64"),
    filename: `${slugify(input.title)}-frontiers3d-${new Date().toISOString().slice(0, 10)}.zip`,
    sizeBytes: zipped.length,
  };
}
