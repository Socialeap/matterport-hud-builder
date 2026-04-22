import { useState } from "react";
import { canonicalProxyUrl } from "@/lib/matterport-mhtml";
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
  /** When true, render only the inner body (no Card/Header wrapper) — used inside Accordion. */
  headless?: boolean;
}

export function PropertyModelsSection({
  models,
  onAdd,
  onRemove,
  onChange,
  onMediaChange,
  onOpenBehavior,
  savedModelId,
  headless,
}: PropertyModelsSectionProps) {
  const { isActive: lusActive, loading: lusLoading } = useLusLicense();
  const showPremium = lusLoading || lusActive;
  const [syncModelId, setSyncModelId] = useState<string | null>(null);
  const syncModel = syncModelId ? models.find((m) => m.id === syncModelId) ?? null : null;

  const addButton = (
    <Button size="sm" variant="outline" onClick={onAdd}>
      <Plus className="mr-1 size-3" />
      Add Property
    </Button>
  );

  const body = (
    <div className="space-y-4">
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
                <div className="flex items-center gap-2">
                  <Input
                    value={model.matterportId}
                    onChange={(e) => onChange(model.id, "matterportId", e.target.value)}
                    placeholder="e.g. SxQL3iGyoDo"
                    maxLength={11}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setSyncModelId(model.id)}
                    title="Sync videos, photos, and GIFs from a saved Matterport Media page"
                    className="shrink-0"
                  >
                    <Download className="mr-1 size-3.5" />
                    Sync
                  </Button>
                </div>
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

            {model.multimedia && model.multimedia.length > 0 && (
              <MediaAssetsList
                assets={model.multimedia}
                modelId={model.matterportId}
                onChange={(next) => onMediaChange(model.id, next)}
                onSyncMore={() => setSyncModelId(model.id)}
              />
            )}

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
                      Adds a "Cinema Mode" button to the Portal. Loads only when clicked — won't slow the tour.
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
                      ? "Adds a map button to the Portal using the Location above."
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
    </div>
  );

  const syncModalEl = syncModel && (
    <MediaSyncModal
      open={!!syncModelId}
      onOpenChange={(open) => {
        if (!open) setSyncModelId(null);
      }}
      currentMatterportId={syncModel.matterportId}
      existing={syncModel.multimedia ?? []}
      onConfirm={(merged, parsedModelId) => {
        onMediaChange(syncModel.id, merged);
        if (!syncModel.matterportId.trim() && parsedModelId) {
          onChange(syncModel.id, "matterportId", parsedModelId);
        }
      }}
    />
  );

  if (headless) {
    return (
      <>
        <div className="flex justify-end">{addButton}</div>
        {body}
        {syncModalEl}
      </>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Home className="size-5 text-primary" />
            Property Models
          </CardTitle>
          {addButton}
        </div>
      </CardHeader>
      <CardContent>{body}</CardContent>
      {syncModalEl}
    </Card>
  );
}

interface MediaAssetsListProps {
  assets: MediaAsset[];
  modelId?: string;
  onChange: (next: MediaAsset[]) => void;
  onSyncMore: () => void;
}

function MediaAssetsList({ assets, modelId, onChange, onSyncMore }: MediaAssetsListProps) {
  const videoCount = assets.filter((a) => a.kind === "video").length;
  const photoCount = assets.filter((a) => a.kind === "photo").length;
  const gifCount = assets.filter((a) => a.kind === "gif").length;
  const visibleCount = assets.filter((a) => a.visible).length;

  const toggle = (id: string, visible: boolean) =>
    onChange(assets.map((a) => (a.id === id ? { ...a, visible } : a)));
  const remove = (id: string) => onChange(assets.filter((a) => a.id !== id));

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Synced media</span>
          <Badge variant="secondary" className="text-[10px]">{videoCount} video</Badge>
          <Badge variant="secondary" className="text-[10px]">{photoCount} photo</Badge>
          {gifCount > 0 && <Badge variant="secondary" className="text-[10px]">{gifCount} GIF</Badge>}
          <span>· {visibleCount} visible</span>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onSyncMore} className="h-7 text-xs">
          <Download className="mr-1 size-3" />
          Sync more
        </Button>
      </div>
      <ul className="divide-y divide-border/50 rounded border border-border/40 bg-background">
        {assets.map((a) => (
          <li key={a.id} className="flex items-center gap-2 px-2 py-1.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground overflow-hidden">
              {a.kind !== "video" && canonicalProxyUrl(a, modelId) ? (
                <img
                  src={canonicalProxyUrl(a, modelId)}
                  alt=""
                  className="size-full object-cover"
                  loading="lazy"
                />
              ) : a.kind === "video" ? (
                <VideoIcon className="size-3.5" />
              ) : (
                <ImageIcon className="size-3.5" />
              )}
            </span>
            <div className="flex-1 min-w-0">
              <p className="truncate text-xs font-medium text-foreground">{a.label ?? a.id}</p>
              <p className="truncate text-[10px] text-muted-foreground">{a.id}</p>
            </div>
            <Badge variant="outline" className="text-[10px] capitalize">{a.kind}</Badge>
            <Switch
              checked={a.visible}
              onCheckedChange={(checked) => toggle(a.id, checked)}
              aria-label={`Toggle visibility for ${a.label ?? a.id}`}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
              onClick={() => remove(a.id)}
              aria-label={`Remove ${a.label ?? a.id}`}
            >
              <X className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
