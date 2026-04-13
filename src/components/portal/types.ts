export interface PropertyModel {
  id: string;
  name: string;
  location: string;
  matterportId: string;
  musicUrl: string;
}

export interface AgentContact {
  name: string;
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
