import { useState } from "react";
import { ChevronUp, ChevronDown, Phone, Mail, MessageSquare, Globe } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { PropertyModel, TourBehavior, AgentContact } from "./types";
import { buildMatterportUrl } from "./types";

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
}: HudPreviewProps) {
  const [headerVisible, setHeaderVisible] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const currentModel = models[selectedModelIndex];
  const behavior = currentModel ? behaviors[currentModel.id] : null;
  const iframeUrl = currentModel && behavior
    ? buildMatterportUrl(currentModel.matterportId, behavior)
    : "";

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
    <>
      <div className="overflow-hidden rounded-lg border border-border shadow-lg">
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
                    <p className="text-xs text-white/70">
                      {currentModel.name || "Property"} — {currentModel.location || "Location"}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 mr-8">
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
        </div>

        {/* Powered by (Starter only) */}
        {!isPro && (
          <div className="bg-muted/30 px-4 py-1.5 text-center text-xs text-muted-foreground">
            Powered by Transcendence Media
          </div>
        )}
      </div>

      {/* Contact Side Modal */}
      <Sheet open={contactOpen} onOpenChange={setContactOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Get in Touch</SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {/* Agent info */}
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full text-white text-xl font-bold" style={{ backgroundColor: accentColor }}>
                {agent.name ? agent.name.charAt(0).toUpperCase() : "?"}
              </div>
              <div>
                <p className="text-lg font-semibold text-foreground">{agent.name || "Agent"}</p>
                {brandName && <p className="text-sm text-muted-foreground">{brandName}</p>}
              </div>
            </div>

            {/* Welcome note */}
            {agent.welcomeNote && (
              <div className="rounded-lg border border-border bg-muted/50 p-4">
                <p className="text-sm text-foreground whitespace-pre-wrap">{agent.welcomeNote}</p>
              </div>
            )}

            {/* Contact actions */}
            <div className="space-y-2">
              {agent.phone && (
                <>
                  <a
                    href={`tel:${agent.phone}`}
                    className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    Call {agent.phone}
                  </a>
                  <a
                    href={`sms:${agent.phone}`}
                    className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    Text {agent.phone}
                  </a>
                </>
              )}
              {agent.email && (
                <a
                  href={`mailto:${agent.email}`}
                  className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  {agent.email}
                </a>
              )}
            </div>

            {/* Social links */}
            {socialLinks.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Social</p>
                <div className="flex flex-wrap gap-2">
                  {socialLinks.map((s) => (
                    <a
                      key={s.label}
                      href={s.url.startsWith("http") ? s.url : `https://${s.url}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      <s.icon className="h-3.5 w-3.5" />
                      {s.label}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
