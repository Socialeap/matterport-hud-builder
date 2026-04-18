import { useState, useRef } from "react";
import { ChevronUp, ChevronDown, Phone, Mail, MessageSquare, Globe, X, MapPin, Film } from "lucide-react";
import type { PropertyModel, TourBehavior, AgentContact } from "./types";
import { buildMatterportUrl } from "./types";
import { NeighborhoodMapModal } from "./NeighborhoodMapModal";
import { CinemaModal } from "./CinemaModal";
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
}: HudPreviewProps) {
  const [headerVisible, setHeaderVisible] = useState(defaultHeaderVisible);
  const [contactOpen, setContactOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [cinemaOpen, setCinemaOpen] = useState(false);
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
    <div ref={containerRef} className="relative overflow-hidden rounded-lg border border-border shadow-lg">
      {/* Toggle button — always visible */}
      <div className="relative">
        <button
          onClick={() => setHeaderVisible((v) => !v)}
          className="absolute right-2 top-2 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition-colors hover:bg-white/30"
          aria-label={headerVisible ? "Hide header" : "Show header"}
        >
          {headerVisible ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {/* HUD Header — glassmorphism + animated */}
        <div
          className="transition-all duration-300 ease-in-out overflow-hidden"
          style={{
            maxHeight: headerVisible ? "120px" : "0px",
            opacity: headerVisible ? 1 : 0,
          }}
        >
          <div
            className="flex items-center justify-between px-4 py-4"
            style={{
              backgroundColor: `${hudBgColor}cc`,
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
            }}
          >
            <div className="flex items-center gap-3">
              {logoPreview && (
                <img src={logoPreview} alt="Brand logo" className="h-8 object-contain" />
              )}
              <div>
                <p className="text-sm font-semibold text-white">
                  {brandName || "Your Brand"}
                </p>
                {currentModel && (
                  <>
                    {currentModel.propertyName?.trim() && (
                      <p className="text-xs font-medium text-white/90">
                        {currentModel.propertyName}
                      </p>
                    )}
                    <p className="text-xs text-white/70">
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
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
                  title="View Neighborhood Map"
                  aria-label="View Neighborhood Map"
                >
                  <MapPin className="h-3.5 w-3.5" />
                </button>
              )}
              {hasCinematic && (
                <button
                  onClick={() => setCinemaOpen(true)}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
                  title="Watch Cinematic Video"
                  aria-label="Watch Cinematic Video"
                >
                  <Film className="h-3.5 w-3.5" />
                </button>
              )}
              {agent.name && (
                <span className="text-xs text-white/70">{agent.name}</span>
              )}
              {(agent.phone || agent.email || agent.name) && (
                <button
                  onClick={() => setContactOpen(true)}
                  className="rounded px-2 py-1 text-xs font-medium text-white cursor-pointer"
                  style={{ backgroundColor: accentColor }}
                >
                  Contact
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Property selector */}
      {models.length > 1 && (
        <div className="flex gap-1 border-b border-border bg-muted/50 px-4 py-2">
          {models.map((m, i) => (
            <button
              key={m.id}
              onClick={() => onSelectModel(i)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                i === selectedModelIndex
                  ? "text-white"
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
      <div className="relative aspect-video w-full bg-black">
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

        {/* Contact Side Panel — slides from right within the screen */}
        <div
          className="absolute inset-y-0 right-0 z-30 w-[280px] overflow-y-auto transition-transform duration-300 ease-in-out"
          style={{
            transform: contactOpen ? "translateX(0)" : "translateX(100%)",
            backgroundColor: `${hudBgColor}ee`,
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
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
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white text-sm font-bold"
                style={{ backgroundColor: accentColor }}
              >
                {agent.name ? agent.name.charAt(0).toUpperCase() : "?"}
              </div>
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

      {/* Powered by (Starter only) */}
      {!isPro && (
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
    </div>
  );
}
