import { useMemo } from "react";
import { Loader2, Music, Volume2, VolumeX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useVaultAssetsByCategory } from "@/hooks/useVaultAssetsByCategory";

interface Props {
  /** ID of the property currently selected via the Enhancements tab bar. */
  propertyId: string;
  /** Currently-selected vault asset id for this property (or null). */
  selectedAssetId: string | null;
  /** Manual `musicUrl` text the client may have typed in Property Models. */
  fallbackMusicUrl: string;
  onSelect: (assetId: string | null) => void;
}

/**
 * Per-property single-select picker for `spatial_audio` vault assets.
 *
 * Selecting an asset overrides the manual `musicUrl` field for the active
 * property at HTML generation time. Selecting "None" clears the override and
 * falls back to whatever the client typed in Property Models (if anything).
 */
export function SoundLibraryPicker({
  propertyId,
  selectedAssetId,
  fallbackMusicUrl,
  onSelect,
}: Props) {
  const { assets, loading } = useVaultAssetsByCategory("spatial_audio");

  const selected = useMemo(
    () => assets.find((a) => a.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Loading sounds…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-snug text-foreground/80">
        Pick one ambient track for{" "}
        <strong>this property</strong>. Selection overrides the manual Music URL field.
        {fallbackMusicUrl && !selected && (
          <span className="mt-1 block text-muted-foreground">
            Currently using manual URL: <code className="break-all">{fallbackMusicUrl}</code>
          </span>
        )}
      </div>

      {assets.length === 0 ? (
        <p className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
          Your provider hasn't published any ambient sounds yet.
        </p>
      ) : (
        <ul className="space-y-2">
          <li>
            <button
              type="button"
              onClick={() => onSelect(null)}
              className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                selectedAssetId === null
                  ? "border-primary bg-primary/10"
                  : "bg-card hover:bg-accent"
              }`}
              aria-pressed={selectedAssetId === null}
            >
              <VolumeX className="size-4 text-muted-foreground" />
              <span className="flex-1 text-sm font-medium">None</span>
              {selectedAssetId === null && <Badge variant="secondary">Selected</Badge>}
            </button>
          </li>

          {assets.map((asset) => {
            const isActive = asset.id === selectedAssetId;
            return (
              <li key={asset.id}>
                <button
                  type="button"
                  onClick={() => onSelect(asset.id)}
                  className={`flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${
                    isActive ? "border-primary bg-primary/10" : "bg-card hover:bg-accent"
                  }`}
                  aria-pressed={isActive}
                >
                  <Music className="mt-0.5 size-4 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{asset.label}</div>
                    {asset.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {asset.description}
                      </p>
                    )}
                  </div>
                  {isActive ? (
                    <Badge variant="secondary">Applied</Badge>
                  ) : (
                    <Volume2 className="size-4 text-muted-foreground" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            Will play on <strong>{propertyShortLabel(propertyId)}</strong>: {selected.label}
          </span>
          <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
            Clear
          </Button>
        </div>
      )}
    </div>
  );
}

function propertyShortLabel(id: string): string {
  // The wrapper passes a UUID; we don't need to surface it raw.
  // The parent already shows the full property name in the tab bar.
  return id ? "this property" : "this property";
}
