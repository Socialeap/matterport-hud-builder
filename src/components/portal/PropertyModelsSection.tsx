import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2, Home, Settings2 } from "lucide-react";
import type { PropertyModel } from "./types";

interface PropertyModelsSectionProps {
  models: PropertyModel[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, field: keyof PropertyModel, value: string) => void;
  onOpenBehavior: (id: string) => void;
}

export function PropertyModelsSection({
  models,
  onAdd,
  onRemove,
  onChange,
  onOpenBehavior,
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
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
