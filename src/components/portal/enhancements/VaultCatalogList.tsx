import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import { useVaultAssetsByCategory, type VaultAssetRow } from "@/hooks/useVaultAssetsByCategory";
import type { Database } from "@/integrations/supabase/types";

type VaultCategory = Database["public"]["Enums"]["vault_category"];

interface Props {
  category: VaultCategory;
  emptyHint: string;
  /**
   * When true, renders the catalog read-only with a "Coming soon" badge so
   * clients can preview what their MSP has published without applying it
   * (the runtime doesn't render this category yet).
   */
  comingSoon?: boolean;
}

/**
 * Read-only catalog of vault assets for a single category.
 *
 * Used by the Enhancements panel for any category that doesn't have a
 * specialised picker yet (HUD filters, widgets, icons, links, property docs).
 * Clients see what's available; "Coming soon" rows can't be applied.
 */
export function VaultCatalogList({ category, emptyHint, comingSoon = false }: Props) {
  const { assets, loading } = useVaultAssetsByCategory(category);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Loading…
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <p className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
        {emptyHint}
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {assets.map((asset) => (
        <CatalogRow key={asset.id} asset={asset} comingSoon={comingSoon} />
      ))}
    </ul>
  );
}

function CatalogRow({ asset, comingSoon }: { asset: VaultAssetRow; comingSoon: boolean }) {
  return (
    <li className="flex items-start gap-3 rounded-md border bg-card px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{asset.label}</span>
          {comingSoon && (
            <Badge variant="outline" className="border-amber-300 text-amber-700">
              Coming soon
            </Badge>
          )}
        </div>
        {asset.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{asset.description}</p>
        )}
      </div>

      {comingSoon ? (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button size="sm" variant="outline" disabled className="cursor-not-allowed">
                  Apply
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-[220px] text-xs">
              Your provider has published this asset. Runtime support is rolling out — selections aren't applied to the tour yet.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <Badge variant="secondary">Available</Badge>
      )}
    </li>
  );
}
