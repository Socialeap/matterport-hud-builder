/**
 * Cinematic video URL parser.
 *
 * Pure function — no DOM, no React. Converts user-supplied URLs from
 * popular hosts (YouTube, Vimeo, Wistia, Loom) or direct .mp4 links
 * into clean embed URLs ready for iframe/video tags.
 */

export type VideoProvider = "youtube" | "vimeo" | "wistia" | "loom" | "mp4";

export type ParsedVideo =
  | { kind: "iframe"; embedUrl: string; provider: Exclude<VideoProvider, "mp4"> }
  | { kind: "mp4"; embedUrl: string; provider: "mp4" }
  | { kind: "invalid"; embedUrl: ""; provider: VideoProvider };

const INVALID: ParsedVideo = { kind: "invalid", embedUrl: "", provider: "mp4" };

export function parseCinematicVideo(rawUrl: string | undefined | null): ParsedVideo {
  if (!rawUrl) return INVALID;
  const url = rawUrl.trim();
  if (!url) return INVALID;

  // Direct mp4 — bypass iframe.
  if (/\.mp4(\?.*)?$/i.test(url)) {
    return { kind: "mp4", embedUrl: url, provider: "mp4" };
  }

  // YouTube — youtu.be/<id>, youtube.com/watch?v=<id>, youtube.com/embed/<id>, youtube.com/shorts/<id>
  const yt =
    url.match(/youtu\.be\/([\w-]{6,})/i) ||
    url.match(/youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/)([\w-]{6,})/i);
  if (yt?.[1]) {
    return {
      kind: "iframe",
      provider: "youtube",
      embedUrl: `https://www.youtube.com/embed/${yt[1]}?rel=0&modestbranding=1&autoplay=1`,
    };
  }

  // Vimeo — vimeo.com/<id>, player.vimeo.com/video/<id>
  const vimeo =
    url.match(/player\.vimeo\.com\/video\/(\d+)/i) ||
    url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vimeo?.[1]) {
    return {
      kind: "iframe",
      provider: "vimeo",
      embedUrl: `https://player.vimeo.com/video/${vimeo[1]}?title=0&byline=0&portrait=0&autoplay=1`,
    };
  }

  // Wistia — wistia.com/medias/<id>, *.wistia.net/embed/iframe/<id>
  const wistia =
    url.match(/wistia\.com\/medias\/([\w-]+)/i) ||
    url.match(/wistia\.net\/embed\/iframe\/([\w-]+)/i) ||
    url.match(/wistia\.net\/medias\/([\w-]+)/i);
  if (wistia?.[1]) {
    return {
      kind: "iframe",
      provider: "wistia",
      embedUrl: `https://fast.wistia.net/embed/iframe/${wistia[1]}?autoPlay=true`,
    };
  }

  // Loom — loom.com/share/<id>, loom.com/embed/<id>
  const loom =
    url.match(/loom\.com\/(?:share|embed)\/([\w-]+)/i);
  if (loom?.[1]) {
    return {
      kind: "iframe",
      provider: "loom",
      embedUrl: `https://www.loom.com/embed/${loom[1]}?autoplay=1`,
    };
  }

  return INVALID;
}
