export type MediaAssetKind = "video" | "photo" | "gif";

export interface MediaAsset {
  /** 11-char Matterport asset id. */
  id: string;
  kind: MediaAssetKind;
  /** User toggle for carousel inclusion. */
  visible: boolean;
  /** Friendly display label (derived from filename or generic). */
  label?: string;
  /** Original Matterport filename (e.g. "LONG-INTRO-480p-MP4.mp4") — best label source. */
  filename?: string;
  /**
   * For photo/gif: stable proxy URL hosted by us that 302-redirects to a
   * fresh signed Matterport CDN URL on every request. Safe to embed in
   * exported standalone HTML — never expires.
   *   e.g. /api/mp-image?m={modelId}&id={assetId}
   */
  proxyUrl?: string;
  /**
   * For video: Matterport's official iframeable clip player.
   *   e.g. https://my.matterport.com/resources/model/{modelId}/clip/{assetId}
   */
  embedUrl?: string;
}

/**
 * A saved Matterport "Spotlight" view that an Agent can teleport a remote
 * Visitor to during a Live Guided Tour session.
 *
 * Captured in the Builder via the "Guided Paste" workflow (agent presses
 * `U` inside the Matterport tour to copy the current view to the
 * clipboard, then pastes the deep link). We extract the `ss` (sweep id)
 * and `sr` (rotation) query parameters; both are appended to the
 * Matterport iframe URL alongside `&qs=1&play=1` to instantly snap the
 * Visitor's iframe to that view, no SDK required.
 */
export interface LiveTourStop {
  /** Stable client-side id (UUID) — used as React key and as the wire id. */
  id: string;
  /** Friendly label shown to the Agent on the live-session button list. */
  name: string;
  /** Matterport sweep id from the deep link's `ss` query parameter. */
  ss: string;
  /** Matterport rotation tuple from the deep link's `sr` query parameter. */
  sr: string;
}

/**
 * A single Mattertag extracted from a public Matterport model via the
 * Matterport GraphQL endpoint. Populated server-side by
 * `extractMattertags` and surfaced in the "Property Features" drawer in
 * both the React Builder and the exported standalone HTML. Independent
 * of the iframe-internal Mattertag rendering controlled by
 * `TourBehavior.hideMattertags`.
 */
export interface MattertagData {
  /** Stable Mattertag id (sid) from the source model. */
  id: string;
  /** Tag title surfaced to the visitor. */
  label: string;
  /** Tag body. May contain raw URLs that the renderer linkifies. */
  description: string;
  /** Optional media URL pinned to the tag (image, video, or external link). */
  media: string;
  /** 3D anchor position; `y` is used to floor-order cards (highest first). */
  anchorPosition: { x: number; y: number; z: number };
}

export interface PropertyModel {
  id: string;
  name: string;
  propertyName?: string;
  location: string;
  matterportId: string;
  musicUrl: string;
  cinematicVideoUrl?: string;
  enableNeighborhoodMap?: boolean;
  multimedia?: MediaAsset[];
  /**
   * Bookmarked views for the Live Guided Tour feature. Optional and
   * absent on legacy presentations — the runtime treats `undefined` and
   * `[]` identically (no Live Guide available for that property).
   */
  liveTourStops?: LiveTourStop[];
  /**
   * Extracted Mattertags from the public Matterport model. Populated by
   * the `extractMattertags` server function; undefined on legacy
   * presentations / models that haven't been synced yet.
   */
  mattertags?: MattertagData[];
  /**
   * When true, this property loads first in the visitor's tour and
   * appears at the top of the in-HUD property dropdown. Exactly one
   * model is primary at a time; if no flag is set, the first model in
   * the array is treated as primary by the runtime + builder.
   */
  isPrimary?: boolean;
}

export function buildNeighborhoodMapUrl(
  parts: { propertyName?: string; address?: string; location?: string } | string,
): string {
  // Back-compat: callers may still pass a single location string.
  const p = typeof parts === "string" ? { location: parts } : parts;
  const clean = (s?: string) => (s ?? "").replace(/[\r\n\t]+/g, " ").trim();
  const segs = [clean(p.propertyName), clean(p.address), clean(p.location)].filter(Boolean);
  if (segs.length === 0) return "";
  // Drop propertyName if it's already contained in the address/location tail
  const tail = segs.slice(1).join(", ").toLowerCase();
  if (segs[0] && tail.includes(segs[0].toLowerCase())) segs.shift();
  const q = encodeURIComponent(segs.join(", "));
  // www.google.com is the keyless embed host that still allows iframing.
  return `https://www.google.com/maps?q=${q}&t=&z=15&ie=UTF8&iwloc=&output=embed`;
}

export interface AgentContact {
  name: string;
  titleRole: string;
  email: string;
  phone: string;
  welcomeNote: string;
  linkedin: string;
  twitter: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  other: string;
  website: string;
  gaTrackingId: string;
  avatarUrl: string;
}

export interface TourBehavior {
  hideBranding: boolean;
  mlsModeEnabled: boolean;
  mlsModeValue: string;
  hideTitle: boolean;
  autoPlay: boolean;
  quickstart: boolean;
  autoStartTour: boolean;
  autoStartTourDelay: string;
  loopGuidedTour: boolean;
  hideDollhouse: boolean;
  hideHighlightReel: boolean;
  singleFloorFocus: boolean;
  hideMattertags: boolean;
  hideSearch: boolean;
  disableScrollWheelZoom: boolean;
  disableZoom: boolean;
  forceLanguage: boolean;
  languageCode: string;
  hideGuidedPath: boolean;
  transitionEnabled: boolean;
  transitionValue: string;
  customParams: string;
}

export const DEFAULT_BEHAVIOR: TourBehavior = {
  hideBranding: false,
  mlsModeEnabled: false,
  mlsModeValue: "1",
  hideTitle: false,
  autoPlay: true,
  quickstart: false,
  autoStartTour: false,
  autoStartTourDelay: "8",
  loopGuidedTour: false,
  hideDollhouse: false,
  hideHighlightReel: false,
  singleFloorFocus: false,
  hideMattertags: false,
  hideSearch: false,
  disableScrollWheelZoom: true,
  disableZoom: false,
  forceLanguage: false,
  languageCode: "en",
  hideGuidedPath: false,
  transitionEnabled: false,
  transitionValue: "2",
  customParams: "",
};

export const DEFAULT_AGENT: AgentContact = {
  name: "",
  titleRole: "",
  email: "",
  phone: "",
  welcomeNote: "",
  linkedin: "",
  twitter: "",
  instagram: "",
  facebook: "",
  tiktok: "",
  other: "",
  website: "",
  gaTrackingId: "",
  avatarUrl: "",
};

export function buildMatterportUrl(modelId: string, behavior: TourBehavior): string {
  if (!modelId) return "";
  const params: string[] = [];
  if (behavior.hideBranding) params.push("brand=0");
  if (behavior.mlsModeEnabled) params.push(`mls=${behavior.mlsModeValue}`);
  if (behavior.hideTitle) params.push("title=0");
  if (behavior.autoPlay) params.push("play=1");
  if (behavior.quickstart) params.push("qs=1");
  if (behavior.autoStartTour) params.push(`ts=${behavior.autoStartTourDelay}`);
  if (behavior.loopGuidedTour) params.push("lp=1");
  if (behavior.hideDollhouse) params.push("dh=0");
  if (behavior.hideHighlightReel) params.push("hr=0");
  if (behavior.singleFloorFocus) params.push("f=0");
  if (behavior.hideMattertags) params.push("mt=0");
  if (behavior.hideSearch) params.push("search=0");
  if (behavior.disableScrollWheelZoom) params.push("wh=0");
  if (behavior.disableZoom) params.push("nozoom=1");
  if (behavior.forceLanguage) params.push(`lang=${behavior.languageCode}`);
  if (behavior.hideGuidedPath) params.push("guidedpath=0");
  if (behavior.transitionEnabled) params.push(`transition=${behavior.transitionValue}`);
  if (behavior.customParams) params.push(behavior.customParams);
  const qs = params.length > 0 ? `&${params.join("&")}` : "";
  return `https://my.matterport.com/show/?m=${modelId}${qs}`;
}
