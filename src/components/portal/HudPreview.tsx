import { useState, useRef } from "react";
import { ChevronUp, ChevronDown, Phone, Mail, MessageSquare, Globe, X, MapPin, Film, Images, Copy, Bookmark, Info, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { PropertyModel, TourBehavior, AgentContact, LiveTourStop } from "./types";
import { buildMatterportUrl } from "./types";
import { NeighborhoodMapModal } from "./NeighborhoodMapModal";
import { CinemaModal } from "./CinemaModal";
import { MediaCarouselModal } from "./MediaCarouselModal";
import { parseCinematicVideo } from "@/lib/video-embed";

interface HudPreviewProps {
  models: PropertyModel[];
  selectedModelIndex: number;
  onSelectModel: (index: number) => void;
  behaviors: Record<string, TourBehavior>;
  brandName: string;
  accentColor: string;
  hudBgColor: string;
  logoPreview: string | null;
  agent: AgentContact;
  isPro: boolean;
  defaultHeaderVisible?: boolean;
  fullViewport?: boolean;
  /**
   * Builder-only affordance: shows the "Add Bookmark" button + Guided
   * Paste toolbar. Visitor previews and the exported HTML runtime never
   * pass this prop. Without `onAddBookmark`, the button is a no-op so we
   * also gate on its presence.
   */
  enableBookmarking?: boolean;
  /** Append a stop to the currently selected model's `liveTourStops`. */
  onAddBookmark?: (modelId: string, stop: LiveTourStop) => void;
  /** Remove a stop by id from the currently selected model. */
  onRemoveBookmark?: (modelId: string, stopId: string) => void;
  /**
   * Where to render the Bookmark button + Guided-Paste toolbar.
   * - "overlay" (default): floats over the iframe — used by the standalone
   *   end-product preview and `fullViewport` mode.
   * - "above": renders as a normal-flow card stacked directly above the
   *   iframe — used by the Builder so it never covers Matterport's controls.
   */
  bookmarkBarPlacement?: "overlay" | "above";
}

export function HudPreview({
  models,
  selectedModelIndex,
  onSelectModel,
  behaviors,
  brandName,
  accentColor,
  hudBgColor,
  logoPreview,
  agent,
  isPro,
  defaultHeaderVisible = false,
  fullViewport = false,
  enableBookmarking = false,
  onAddBookmark,
  onRemoveBookmark,
  bookmarkBarPlacement = "overlay",
}: HudPreviewProps) {
  const [headerVisible, setHeaderVisible] = useState(defaultHeaderVisible);
  const [contactOpen, setContactOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [cinemaOpen, setCinemaOpen] = useState(false);
  const [carouselOpen, setCarouselOpen] = useState(false);
  // Quick-message form state (mirrors the standalone end-product behavior)
  const [qMessage, setQMessage] = useState("");
  const [qEmail, setQEmail] = useState("");
  const [qActive, setQActive] = useState<number>(-1);
  const [qStatus, setQStatus] = useState("");
  // Bookmark / Guided-Paste state — Builder-only.
  const [isBookmarking, setIsBookmarking] = useState(false);
  const [bookmarkName, setBookmarkName] = useState("");
  const [bookmarkLink, setBookmarkLink] = useState("");
  const bookmarkNameRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentModel = models[selectedModelIndex];
  const bookmarkingActive = enableBookmarking && isBookmarking && !!onAddBookmark;
  const stops = currentModel?.liveTourStops ?? [];

  /**
   * Parse a Matterport "Press U to copy" deep link and append it as a new
   * stop on the current model. Returns true if a stop was successfully
   * captured. Keeps the toolbar open afterwards so the agent can rapidly
   * capture several views in a row.
   */
  const captureBookmarkFromLink = (rawLink: string): boolean => {
    if (!currentModel || !onAddBookmark) return false;
    const trimmed = rawLink.trim();
    if (!trimmed) return false;
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      toast.error("That doesn't look like a Matterport link.");
      return false;
    }
    const ss = parsed.searchParams.get("ss");
    const sr = parsed.searchParams.get("sr");
    if (!ss || !ss.trim()) {
      toast.error(
        "This link doesn't contain a sweep position. In the 3D tour, click inside, press U on your keyboard, then paste the link.",
      );
      return false;
    }
    const fallbackName = `Stop ${stops.length + 1}`;
    const stopName = bookmarkName.trim() || fallbackName;
    onAddBookmark(currentModel.id, {
      id: crypto.randomUUID(),
      name: stopName,
      ss: ss.trim(),
      sr: (sr ?? "").trim(),
    });
    setBookmarkName("");
    setBookmarkLink("");
    toast.success(`Saved "${stopName}"`);
    // Refocus the name input so the agent can immediately label the next stop.
    setTimeout(() => bookmarkNameRef.current?.focus(), 0);
    return true;
  };

  const handleLinkPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text/plain");
    if (!pasted) return;
    const captured = captureBookmarkFromLink(pasted);
    if (captured) {
      // Suppress the browser's default paste so the trailing onChange
      // can't re-populate the input with the just-saved coordinates.
      e.preventDefault();
      setBookmarkLink("");
    }
  };

  const exitBookmarkMode = () => {
    setIsBookmarking(false);
    setBookmarkName("");
    setBookmarkLink("");
  };
  const behavior = currentModel ? behaviors[currentModel.id] : null;
  const iframeUrl = currentModel && behavior
    ? buildMatterportUrl(currentModel.matterportId, behavior)
    : "";
  const cinematicParsed = currentModel
    ? parseCinematicVideo(currentModel.cinematicVideoUrl)
    : null;
  const hasCinematic = cinematicParsed?.kind === "iframe" || cinematicParsed?.kind === "mp4";
  const visibleMedia = (currentModel?.multimedia ?? []).filter((m) => m.visible);
  const hasMedia = visibleMedia.length > 0;

  const socialLinks = [
    { url: agent.linkedin, icon: Globe, label: "LinkedIn" },
    { url: agent.twitter, icon: Globe, label: "Twitter" },
    { url: agent.instagram, icon: Globe, label: "Instagram" },
    { url: agent.facebook, icon: Globe, label: "Facebook" },
    { url: agent.tiktok, icon: Globe, label: "TikTok" },
    { url: agent.website, icon: Globe, label: "Website" },
    { url: agent.other, icon: Globe, label: "Other" },
  ].filter((s) => s.url);

  // Render the bookmark UI either as an overlay over the iframe (default,
  // used by the standalone end-product) or as a normal-flow card above the
  // iframe (used by the Builder so it never covers Matterport's controls).
  const bookmarkAbove = bookmarkBarPlacement === "above";
  const showBookmarkOverlay = !bookmarkAbove;

  // Shared JSX for the Guided-Paste toolbar. Position classes differ between
  // overlay and above placements; everything else is identical.
  const renderBookmarkToolbar = (placement: "overlay" | "above") => (
    <div
      className={
        placement === "overlay"
          ? "absolute inset-x-0 top-0 z-40 border-b border-white/10 px-3 py-2"
          : "relative z-10 rounded-lg border border-border px-3 py-2 shadow-sm"
      }
      style={{
        backgroundColor: placement === "overlay" ? `${hudBgColor}cc` : hudBgColor,
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        boxShadow:
          placement === "overlay"
            ? "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06)"
            : "0 2px 12px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Bookmark className="h-3.5 w-3.5 shrink-0 text-white/80" />
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-white/70">
          Add Bookmark
        </span>
        <input
          ref={bookmarkNameRef}
          type="text"
          value={bookmarkName}
          onChange={(e) => setBookmarkName(e.target.value)}
          placeholder={`Stop name (e.g. Foyer)`}
          className="min-w-[140px] flex-1 rounded-md border border-white/15 bg-white/10 px-2.5 py-1 text-xs text-white placeholder:text-white/40 outline-none focus:border-white/40"
          aria-label="Stop name"
          onKeyDown={(e) => {
            if (e.key === "Escape") exitBookmarkMode();
          }}
        />
        <input
          type="text"
          value={bookmarkLink}
          onChange={(e) => setBookmarkLink(e.target.value)}
          onPaste={handleLinkPaste}
          placeholder="Paste deep link (Cmd/Ctrl+V)"
          className="min-w-[180px] flex-[2] rounded-md border border-white/15 bg-white/10 px-2.5 py-1 text-xs text-white placeholder:text-white/40 outline-none focus:border-white/40"
          aria-label="Paste Matterport deep link"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              captureBookmarkFromLink(bookmarkLink);
            } else if (e.key === "Escape") {
              exitBookmarkMode();
            }
          }}
        />
        <button
          type="button"
          onClick={() => captureBookmarkFromLink(bookmarkLink)}
          disabled={!bookmarkLink.trim()}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/80 text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Save bookmark"
          title="Save bookmark"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
              aria-label="How to capture a Matterport view"
              title="How to capture a Matterport view"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="end" className="w-72 text-xs leading-relaxed">
            <p className="mb-2 font-semibold text-foreground">How to capture a view</p>
            <ol className="ml-4 list-decimal space-y-1 text-muted-foreground">
              <li>Click inside the 3D tour {placement === "above" ? "below" : "above"}.</li>
              <li>
                Press <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">U</kbd> on
                your keyboard. Matterport copies the exact view to your clipboard.
              </li>
              <li>
                Click into the &ldquo;Paste deep link&rdquo; field {placement === "above" ? "above" : "above"} and
                paste (<kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">⌘V</kbd> /{" "}
                <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">Ctrl+V</kbd>).
              </li>
            </ol>
            <p className="mt-2 text-muted-foreground">
              The bookmark is saved automatically. Optionally name it first; otherwise we&rsquo;ll auto-label it.
            </p>
          </PopoverContent>
        </Popover>
        <button
          type="button"
          onClick={exitBookmarkMode}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20"
          aria-label="Close bookmark toolbar"
          title="Close (Esc)"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {stops.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Saved</span>
          {stops.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 py-0.5 pl-2.5 pr-1 text-[11px] font-medium text-white"
              title={`ss=${s.ss}${s.sr ? `  sr=${s.sr}` : ""}`}
            >
              <span className="max-w-[140px] truncate">{s.name}</span>
              {onRemoveBookmark && (
                <button
                  type="button"
                  onClick={() => {
                    if (currentModel) onRemoveBookmark(currentModel.id, s.id);
                  }}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/20 hover:text-white"
                  aria-label={`Remove "${s.name}"`}
                  title={`Remove "${s.name}"`}
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  // Reusable info popover content describing the Guided-Paste flow.
  // Surfaced both in the toolbar AND alongside the Bookmark pill so the
  // agent can read the instructions BEFORE activating the toolbar.
  const renderBookmarkInfoPopover = (variant: "light" | "dark") => (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={
            variant === "light"
              ? "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-md transition-colors hover:bg-white/30"
              : "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
          }
          aria-label="How Live Tour bookmarks work"
          title="How Live Tour bookmarks work"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-72 text-xs leading-relaxed">
        <p className="mb-2 font-semibold text-foreground">How to capture a view</p>
        <ol className="ml-4 list-decimal space-y-1 text-muted-foreground">
          <li>Open the 3D tour and navigate to the view you want to save.</li>
          <li>
            Press <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">U</kbd> on
            your keyboard. Matterport copies the exact view to your clipboard.
          </li>
          <li>
            Click <span className="font-semibold text-foreground">Bookmark</span>, then paste into the
            &ldquo;Paste deep link&rdquo; field (
            <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">⌘V</kbd> /{" "}
            <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">Ctrl+V</kbd>).
          </li>
        </ol>
        <p className="mt-2 text-muted-foreground">
          The bookmark saves automatically on paste. Optionally name it first; otherwise we&rsquo;ll
          auto-label it.
        </p>
      </PopoverContent>
    </Popover>
  );

  // Shared JSX for the "Bookmark" pill button. In overlay mode it floats
  // top-right of the iframe; in "above" mode it sits inside a header row.
  // Wrapped in a flex container so the always-visible Info popover sits
  // immediately next to the pill in both placements.
  const renderBookmarkButton = (placement: "overlay" | "above") => (
    <div
      className={
        placement === "overlay"
          ? "absolute right-12 top-2 z-30 flex items-center gap-1.5"
          : "flex items-center gap-1.5"
      }
    >
      <button
        onClick={() => {
          setHeaderVisible(false);
          setIsBookmarking(true);
          setTimeout(() => bookmarkNameRef.current?.focus(), 0);
        }}
        disabled={!currentModel?.matterportId?.trim()}
        className={
          placement === "overlay"
            ? "flex h-6 items-center gap-1 rounded-full bg-white/20 px-2.5 text-[11px] font-medium text-white backdrop-blur-md transition-colors hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-40"
            : "flex h-7 items-center gap-1.5 rounded-full bg-foreground/90 px-3 text-[11px] font-medium text-background transition-colors hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-40"
        }
        aria-label="Add Live Tour bookmark"
        title={
          currentModel?.matterportId?.trim()
            ? "Add a Live Tour bookmark for this property"
            : "Add a Matterport Model ID first"
        }
        style={
          placement === "overlay"
            ? { WebkitBackdropFilter: "blur(12px)", backdropFilter: "blur(12px)" }
            : undefined
        }
      >
        <Bookmark className="h-3 w-3" />
        <span>Bookmark</span>
        {stops.length > 0 && (
          <span
            className={
              placement === "overlay"
                ? "ml-0.5 rounded-full bg-white/25 px-1.5 text-[10px] font-semibold leading-4"
                : "ml-0.5 rounded-full bg-background/25 px-1.5 text-[10px] font-semibold leading-4"
            }
          >
            {stops.length}
          </span>
        )}
      </button>
      {renderBookmarkInfoPopover(placement === "overlay" ? "light" : "dark")}
    </div>
  );

  // The Builder-mode header that sits above the iframe and hosts the
  // bookmark button + (when active) the toolbar/saved-chip card.
  const aboveBookmarkBlock = bookmarkAbove && enableBookmarking ? (
    <div className="mb-2 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bookmark className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Live Tour Bookmarks
          </span>
        </div>
        {!bookmarkingActive && renderBookmarkButton("above")}
      </div>
      {bookmarkingActive && renderBookmarkToolbar("above")}
    </div>
  ) : null;

  return (
    <>
      {aboveBookmarkBlock}
      <div
        ref={containerRef}
        className={
          fullViewport
            ? "relative h-screen w-screen overflow-hidden bg-black"
            : "relative overflow-hidden rounded-lg border border-border shadow-lg"
        }
      >
      {/* Property selector */}
      {models.length > 1 && (
        <div
          className={
            fullViewport
              ? "absolute left-3 top-3 z-30 flex gap-1 rounded-full border border-white/10 bg-black/40 px-2 py-1 backdrop-blur-md"
              : "flex gap-1 border-b border-border bg-muted/50 px-4 py-2"
          }
        >
          {models.map((m, i) => (
            <button
              key={m.id}
              onClick={() => onSelectModel(i)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                i === selectedModelIndex
                  ? "text-white"
                  : fullViewport
                    ? "bg-transparent text-white/70 hover:bg-white/10"
                    : "bg-transparent text-muted-foreground hover:bg-muted"
              }`}
              style={i === selectedModelIndex ? { backgroundColor: accentColor } : undefined}
            >
              {m.name || `Property ${i + 1}`}
            </button>
          ))}
        </div>
      )}

      {/* Matterport iframe */}
      <div className={fullViewport ? "relative h-full w-full bg-black" : "relative aspect-video w-full bg-black"}>

        {iframeUrl ? (
          <iframe
            src={iframeUrl}
            className="h-full w-full"
            allow="fullscreen; xr-spatial-tracking"
            allowFullScreen
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/50">
            Add a Matterport Model ID to see the preview
          </div>
        )}

        {/* Guided-Paste bookmark toolbar — overlay placement only.
            In "above" placement (Builder), the toolbar is rendered outside
            this container so it never covers the Matterport iframe. */}
        {showBookmarkOverlay && bookmarkingActive && renderBookmarkToolbar("overlay")}

        {/* Add Bookmark pill button — overlay placement only.
            In "above" placement (Builder), this button is rendered outside
            this container so it never sits on top of the Matterport iframe. */}
        {showBookmarkOverlay && enableBookmarking && !bookmarkingActive && renderBookmarkButton("overlay")}

        {/* Toggle button — overlays the 3D model. Hidden while bookmarking
            so the agent has a clean surface to interact with the iframe. */}
        {!bookmarkingActive && (
          <button
            onClick={() => setHeaderVisible((v) => !v)}
            className="absolute right-2 top-2 z-30 flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-md transition-colors hover:bg-white/30"
            aria-label={headerVisible ? "Hide header" : "Show header"}
            style={{ WebkitBackdropFilter: "blur(12px)", backdropFilter: "blur(12px)" }}
          >
            {headerVisible ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}

        {/* HUD Header — overlays the 3D model with glassmorphism. While
            bookmarking, force-hide via opacity-0 + pointer-events-none so
            the agent can interact with the raw Matterport iframe. */}
        <div
          className={
            bookmarkingActive
              ? "pointer-events-none absolute inset-x-0 top-0 z-20 overflow-hidden opacity-0 transition-opacity duration-200"
              : "absolute inset-x-0 top-0 z-20 transition-all duration-300 ease-in-out overflow-hidden"
          }
          style={
            bookmarkingActive
              ? { maxHeight: 0 }
              : {
                  maxHeight: headerVisible ? "120px" : "0px",
                  opacity: headerVisible ? 1 : 0,
                }
          }
        >
          <div
            className="flex items-center justify-between px-4 py-4 border-b border-white/10"
            style={{
              backgroundColor: `${hudBgColor}66`,
              backdropFilter: "blur(20px) saturate(180%)",
              WebkitBackdropFilter: "blur(20px) saturate(180%)",
              boxShadow: "0 4px 24px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.08)",
            }}
          >
            <div className="flex items-center gap-3">
              {logoPreview && (
                <img src={logoPreview} alt="Brand logo" className="h-8 object-contain" />
              )}
              <div>
                <p className="text-sm font-semibold text-white drop-shadow-sm">
                  {brandName || "Your Brand"}
                </p>
                {currentModel && (
                  <>
                    {currentModel.propertyName?.trim() && (
                      <p className="text-xs font-medium text-white/90 drop-shadow-sm">
                        {currentModel.propertyName}
                      </p>
                    )}
                    <p className="text-xs text-white/80 drop-shadow-sm">
                      {currentModel.name || "Property"} — {currentModel.location || "Location"}
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 mr-8">
              {currentModel?.enableNeighborhoodMap && currentModel.location.trim() && (
                <button
                  onClick={() => setMapOpen(true)}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition-colors hover:bg-white/25"
                  title="View Neighborhood Map"
                  aria-label="View Neighborhood Map"
                >
                  <MapPin className="h-3.5 w-3.5" />
                </button>
              )}
              {hasCinematic && (
                <button
                  onClick={() => setCinemaOpen(true)}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition-colors hover:bg-white/25"
                  title="Watch Cinematic Video"
                  aria-label="Watch Cinematic Video"
                >
                  <Film className="h-3.5 w-3.5" />
                </button>
              )}
              {hasMedia && (
                <button
                  onClick={() => setCarouselOpen(true)}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition-colors hover:bg-white/25"
                  title="View Media Gallery"
                  aria-label="View Media Gallery"
                >
                  <Images className="h-3.5 w-3.5" />
                </button>
              )}
              {agent.name && (
                <span className="text-xs text-white/80 drop-shadow-sm">{agent.name}</span>
              )}
              {(agent.phone || agent.email || agent.name) && (
                <button
                  onClick={() => setContactOpen(true)}
                  className="rounded px-2 py-1 text-xs font-medium text-white cursor-pointer shadow-md"
                  style={{ backgroundColor: accentColor }}
                >
                  Contact
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Contact Side Panel — slides from right with glassmorphism */}
        <div
          className="absolute inset-y-0 right-0 z-40 w-[280px] overflow-y-auto transition-transform duration-300 ease-in-out border-l border-white/10"
          style={{
            transform: contactOpen ? "translateX(0)" : "translateX(100%)",
            backgroundColor: `${hudBgColor}80`,
            backdropFilter: "blur(24px) saturate(180%)",
            WebkitBackdropFilter: "blur(24px) saturate(180%)",
            boxShadow: "-8px 0 32px rgba(0,0,0,0.25)",
          }}
        >
          <div className="p-4">
            {/* Close button */}
            <button
              onClick={() => setContactOpen(false)}
              className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>

            <h3 className="text-sm font-semibold text-white mb-4">Get in Touch</h3>

            {/* Agent info */}
            <div className="flex items-center gap-3 mb-4">
              {agent.avatarUrl ? (
                <img
                  src={agent.avatarUrl}
                  alt={agent.name || "Agent"}
                  className="h-12 w-12 shrink-0 rounded-full object-cover border border-white/20 shadow-sm"
                />
              ) : (
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white text-sm font-bold border border-white/20 shadow-sm"
                  style={{ backgroundColor: accentColor }}
                >
                  {agent.name ? agent.name.charAt(0).toUpperCase() : "?"}
                </div>
              )}
              <div>
                <p className="text-sm font-semibold text-white">{agent.name || "Agent"}</p>
                {agent.titleRole && (
                  <p className="text-xs text-white/60">{agent.titleRole}</p>
                )}
                {brandName && !agent.titleRole && (
                  <p className="text-xs text-white/60">{brandName}</p>
                )}
              </div>
            </div>

            {/* Welcome note */}
            {agent.welcomeNote && (
              <div className="rounded-lg bg-white/10 p-3 mb-4">
                <p className="text-xs text-white/90 whitespace-pre-wrap">{agent.welcomeNote}</p>
              </div>
            )}

            {/* Contact actions */}
            <div className="space-y-2 mb-4">
              {agent.phone && (
                <>
                  <a
                    href={`tel:${agent.phone}`}
                    className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
                  >
                    <Phone className="h-3.5 w-3.5 text-white/70" />
                    Call {agent.phone}
                  </a>
                  <a
                    href={`sms:${agent.phone}`}
                    className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
                  >
                    <MessageSquare className="h-3.5 w-3.5 text-white/70" />
                    Text {agent.phone}
                  </a>
                </>
              )}
              {agent.email && (
                <a
                  href={`mailto:${agent.email}`}
                  className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
                >
                  <Mail className="h-3.5 w-3.5 text-white/70" />
                  {agent.email}
                </a>
              )}
            </div>

            {/* Quick-message form (matches the standalone end-product) */}
            {(agent.email || agent.phone) && (() => {
              const TEMPLATES = [
                { label: "Pricing", subject: "Pricing question — {P}", body: "Hi, could you share the asking price and any recent price changes for {P}?" },
                { label: "Availability", subject: "Availability — {P}", body: "Is {P} still available? When can I view it?" },
                { label: "Schedule a tour", subject: "Tour request — {P}", body: "I'd like to schedule a tour of {P}. What times work this week?" },
                { label: "HOA / fees", subject: "HOA & fees — {P}", body: "Could you share HOA dues and any other recurring fees for {P}?" },
                { label: "Square footage", subject: "Square footage — {P}", body: "Could you confirm the total square footage and room dimensions for {P}?" },
                { label: "Pet policy", subject: "Pet policy — {P}", body: "What's the pet policy for {P}?" },
                { label: "Financing", subject: "Financing — {P}", body: "Are there preferred lenders or financing options for {P}?" },
                { label: "Other", subject: "Inquiry — {P}", body: "" },
              ];
              const propName = (currentModel?.propertyName?.trim() || currentModel?.name?.trim() || "this property");
              const fillFrom = (idx: number) => {
                setQActive(idx);
                const tpl = TEMPLATES[idx];
                if (tpl.body) setQMessage(tpl.body.split("{P}").join(propName));
                setQStatus("");
              };
              const subject = qActive >= 0
                ? TEMPLATES[qActive].subject.split("{P}").join(propName)
                : `Inquiry — ${propName}`;
              const buildBody = (forSms: boolean) => {
                const msg = qMessage.trim();
                const ve = qEmail.trim();
                const trailer = ve ? (forSms ? `\nReply to: ${ve}` : `\n\n— Sent from ${ve}`) : "";
                return msg + trailer;
              };
              const ok = qMessage.trim().length > 0;
              const mailHref = `mailto:${encodeURIComponent(agent.email || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildBody(false))}`;
              const smsHref = `sms:${agent.phone || ""}?body=${encodeURIComponent(buildBody(true))}`;
              const onCopy = async () => {
                if (!ok) return;
                const text = `Subject: ${subject}\n\n${buildBody(false)}`;
                try {
                  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
                  setQStatus("Copied to clipboard.");
                } catch {
                  setQStatus("Couldn't copy — please select and copy manually.");
                }
              };
              return (
                <div className="mb-4 border-t border-white/10 pt-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/50">Ask a quick question</p>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {TEMPLATES.map((t, i) => (
                      <button
                        key={t.label}
                        type="button"
                        onClick={() => fillFrom(i)}
                        className="rounded-full px-2.5 py-1 text-[10px] font-medium text-white transition-colors hover:bg-white/20"
                        style={{ backgroundColor: i === qActive ? accentColor : "rgba(255,255,255,0.1)" }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={qMessage}
                    onChange={(e) => setQMessage(e.target.value)}
                    rows={4}
                    placeholder="Type your question, or pick a topic above…"
                    className="mb-1.5 w-full rounded-lg border border-white/10 bg-white/10 p-2 text-xs text-white placeholder:text-white/40 outline-none focus:border-white/30"
                  />
                  <input
                    type="email"
                    value={qEmail}
                    onChange={(e) => setQEmail(e.target.value)}
                    placeholder="Your email (so we can reply)"
                    autoComplete="email"
                    className="mb-2 w-full rounded-lg border border-white/10 bg-white/10 p-2 text-xs text-white placeholder:text-white/40 outline-none focus:border-white/30"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {agent.email && (
                      <a
                        href={ok ? mailHref : undefined}
                        onClick={(e) => { if (!ok) e.preventDefault(); else setQStatus("Opening your email app…"); }}
                        aria-disabled={!ok}
                        className="inline-flex flex-1 min-w-[110px] items-center justify-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-white transition-opacity"
                        style={{ backgroundColor: accentColor, opacity: ok ? 1 : 0.45, pointerEvents: ok ? "auto" : "none" }}
                      >
                        <Mail className="h-3 w-3" /> Email agent
                      </a>
                    )}
                    {agent.phone && (
                      <a
                        href={ok ? smsHref : undefined}
                        onClick={(e) => { if (!ok) e.preventDefault(); else setQStatus("Opening your messaging app…"); }}
                        aria-disabled={!ok}
                        className="inline-flex flex-1 min-w-[110px] items-center justify-center gap-1 rounded-lg bg-white/15 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/25"
                        style={{ opacity: ok ? 1 : 0.45, pointerEvents: ok ? "auto" : "none" }}
                      >
                        <MessageSquare className="h-3 w-3" /> Text agent
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={onCopy}
                      disabled={!ok}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-transparent px-3 py-2 text-[11px] font-medium text-white/85 transition-colors hover:bg-white/10 disabled:opacity-45"
                    >
                      <Copy className="h-3 w-3" /> Copy
                    </button>
                  </div>
                  {qStatus && <p className="mt-1.5 text-[11px] text-white/55">{qStatus}</p>}
                </div>
              );
            })()}

            {/* Social links */}
            {socialLinks.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/50">Social</p>
                <div className="flex flex-wrap gap-1.5">
                  {socialLinks.map((s) => (
                    <a
                      key={s.label}
                      href={s.url.startsWith("http") ? s.url : `https://${s.url}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-medium text-white transition-colors hover:bg-white/20"
                    >
                      <s.icon className="h-3 w-3" />
                      {s.label}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Powered by (Starter only) — hidden in fullViewport mode (page renders its own footer strip) */}
      {!isPro && !fullViewport && (
        <div className="bg-muted/30 px-4 py-1.5 text-center text-xs text-muted-foreground">
          Powered by Transcendence Media
        </div>
      )}

      {currentModel && (
        <NeighborhoodMapModal
          open={mapOpen}
          onOpenChange={setMapOpen}
          location={currentModel.location}
          propertyName={currentModel.name}
        />
      )}

      {hasCinematic && currentModel && (
        <CinemaModal
          open={cinemaOpen}
          onClose={() => setCinemaOpen(false)}
          videoUrl={currentModel.cinematicVideoUrl ?? ""}
        />
      )}

      {hasMedia && (
        <MediaCarouselModal
          open={carouselOpen}
          onClose={() => setCarouselOpen(false)}
          assets={visibleMedia}
          modelId={currentModel?.matterportId}
        />
      )}
    </div>
    </>
  );
}
