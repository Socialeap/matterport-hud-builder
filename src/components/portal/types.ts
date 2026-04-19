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
}

export function buildNeighborhoodMapUrl(location: string): string {
  if (!location.trim()) return "";
  return `https://maps.google.com/maps?q=${encodeURIComponent(location)}&t=&z=15&ie=UTF8&iwloc=&output=embed`;
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
