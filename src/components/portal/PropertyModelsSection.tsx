import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Lock,
  Plus,
  Trash2,
  Home,
  Settings2,
  MapPin,
  Film,
  Download,
  Image as ImageIcon,
  Video as VideoIcon,
  X,
} from "lucide-react";
import type { PropertyModel, MediaAsset } from "./types";
import { PropertyDocsPanel } from "./PropertyDocsPanel";
import { MediaSyncModal } from "./MediaSyncModal";
import { useLusLicense } from "@/hooks/useLusLicense";
import { parseCinematicVideo } from "@/lib/video-embed";

interface PropertyModelsSectionProps {
  models: PropertyModel[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, field: keyof PropertyModel, value: string | boolean) => void;
  onMediaChange: (id: string, assets: MediaAsset[]) => void;
  onOpenBehavior: (id: string) => void;
  savedModelId?: string | null;
}

export function PropertyModelsSection({
  models,
  onAdd,
  onRemove,
  onChange,
  onMediaChange,
  onOpenBehavior,
  savedModelId,
}: PropertyModelsSectionProps) {
  const { isActive: lusActive, loading: lusLoading } = useLusLicense();
  const showPremium = lusLoading || lusActive;
  const [syncModelId, setSyncModelId] = useState<string | null>(null);
  const syncModel = syncModelId ? models.find((m) => m.id === syncModelId) ?? null : null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Home className="size-5 text-primary" />
            Property Models
          </CardTitle>
          <Button size="sm" variant="outline" onClick={onAdd}>
            <Plus className="mr-1 size-3" />
            Add Property
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {models.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No properties added yet. Click "Add Property" to get started.
          </p>
        )}
        {models.map((model, index) => (
          <div
            key={model.id}
            className="rounded-lg border border-border p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                Property {index + 1}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onOpenBehavior(model.id)}
                  title="Tour Behavior Settings"
                >
                  <Settings2 className="size-4" />
                </Button>
                {models.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onRemove(model.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">
                Property Name <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                value={model.propertyName ?? ""}
                onChange={(e) => onChange(model.id, "propertyName", e.target.value)}
                placeholder="e.g. The Grand Hotel, Aspen Loft (leave blank for residential)"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Property Address</Label>
                <Input
                  value={model.name}
                  onChange={(e) => onChange(model.id, "name", e.target.value)}
                  placeholder="123 Main Street"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Location</Label>
                <Input
                  value={model.location}
                  onChange={(e) => onChange(model.id, "location", e.target.value)}
                  placeholder="City, State"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Matterport Model ID</Label>
                <Input
                  value={model.matterportId}
                  onChange={(e) => onChange(model.id, "matterportId", e.target.value)}
                  placeholder="e.g. SxQL3iGyoDo"
                  maxLength={11}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Music URL (optional)</Label>
                <Input
                  value={model.musicUrl}
                  onChange={(e) => onChange(model.id, "musicUrl", e.target.value)}
                  placeholder="https://example.com/music.mp3"
                />
              </div>
            </div>

            {(() => {
              const raw = model.cinematicVideoUrl ?? "";
              const parsed = parseCinematicVideo(raw);
              const showWarning = raw.trim().length > 0 && parsed.kind === "invalid";
              return (
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1.5">
                    <Film className="size-3.5 text-primary" />
                    Cinematic Video URL <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    value={raw}
                    onChange={(e) => onChange(model.id, "cinematicVideoUrl", e.target.value)}
                    placeholder="YouTube, Vimeo, Loom, Wistia, or .mp4 link"
                  />
                  {showWarning ? (
                    <p className="text-[11px] leading-snug text-destructive">
                      Unrecognized link. Use a YouTube, Vimeo, Loom, Wistia URL, or a direct .mp4 file.
                    </p>
                  ) : (
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Adds a "Cinema Mode" button to the HUD. Loads only when clicked — won't slow the tour.
                    </p>
                  )}
                </div>
              );
            })()}

            {showPremium ? (
              <div className="flex items-start gap-3 rounded-md border border-border/60 bg-muted/30 p-3">
                <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <Label
                      htmlFor={`map-toggle-${model.id}`}
                      className="text-xs font-medium"
                    >
                      Enable Neighborhood Map
                    </Label>
                    <Switch
                      id={`map-toggle-${model.id}`}
                      checked={!!model.enableNeighborhoodMap}
                      disabled={!model.location.trim()}
                      onCheckedChange={(checked) =>
                        onChange(model.id, "enableNeighborhoodMap", checked)
                      }
                    />
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    {model.location.trim()
                      ? "Adds a map button to the HUD using the Location above."
                    : "Add the address above to enable this feature."}
                  </p>
                </div>
              </div>
            ) : model.enableNeighborhoodMap ? (
              <div className="flex items-start gap-3 rounded-md border border-border/60 bg-muted/20 p-3">
                <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="flex-1">
                  <Label className="text-xs font-medium">
                    Neighborhood Map (locked)
                  </Label>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    Studio license inactive. Existing map still renders in your
                    tour, but the toggle is paused until upkeep is reactivated.
                  </p>
                </div>
              </div>
            ) : null}

            <PropertyDocsPanel
              propertyUuid={model.id}
              savedModelId={savedModelId ?? null}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
