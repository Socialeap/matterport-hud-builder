import { useState, useRef } from "react";
import { ChevronUp, ChevronDown, Phone, Mail, MessageSquare, Globe, X, MapPin, Film, Images, Copy } from "lucide-react";
import type { PropertyModel, TourBehavior, AgentContact } from "./types";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const currentModel = models[selectedModelIndex];
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

  return (
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

        {/* Toggle button — overlays the 3D model */}
        <button
          onClick={() => setHeaderVisible((v) => !v)}
          className="absolute right-2 top-2 z-30 flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-md transition-colors hover:bg-white/30"
          aria-label={headerVisible ? "Hide header" : "Show header"}
          style={{ WebkitBackdropFilter: "blur(12px)", backdropFilter: "blur(12px)" }}
        >
          {headerVisible ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {/* HUD Header — overlays the 3D model with glassmorphism */}
        <div
          className="absolute inset-x-0 top-0 z-20 transition-all duration-300 ease-in-out overflow-hidden"
          style={{
            maxHeight: headerVisible ? "120px" : "0px",
            opacity: headerVisible ? 1 : 0,
          }}
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
  );
}
