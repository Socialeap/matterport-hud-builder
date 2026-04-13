import { useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { PropertyModel, TourBehavior } from "./types";
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
  agentName: string;
  agentPhone: string;
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
  agentName,
  agentPhone,
  isPro,
}: HudPreviewProps) {
  const [headerVisible, setHeaderVisible] = useState(false);
  const currentModel = models[selectedModelIndex];
  const behavior = currentModel ? behaviors[currentModel.id] : null;
  const iframeUrl = currentModel && behavior
    ? buildMatterportUrl(currentModel.matterportId, behavior)
    : "";

  return (
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
              {agentName && (
                <span className="text-xs text-white/70">{agentName}</span>
              )}
              {agentPhone && (
                <a
                  href={`tel:${agentPhone}`}
                  className="rounded px-2 py-1 text-xs font-medium text-white"
                  style={{ backgroundColor: accentColor }}
                >
                  Contact
                </a>
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
  );
}