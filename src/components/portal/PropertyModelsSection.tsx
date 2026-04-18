import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Lock, Plus, Trash2, Home, Settings2, MapPin } from "lucide-react";
import type { PropertyModel } from "./types";
import { PropertyDocsPanel } from "./PropertyDocsPanel";
import { useLusLicense } from "@/hooks/useLusLicense";

interface PropertyModelsSectionProps {
  models: PropertyModel[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, field: keyof PropertyModel, value: string | boolean) => void;
  onOpenBehavior: (id: string) => void;
  savedModelId?: string | null;
}

export function PropertyModelsSection({
  models,
  onAdd,
  onRemove,
  onChange,
  onOpenBehavior,
  savedModelId,
}: PropertyModelsSectionProps) {
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

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Property Name</Label>
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
                    : "Add a Location above to enable this feature."}
                </p>
              </div>
            </div>

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
