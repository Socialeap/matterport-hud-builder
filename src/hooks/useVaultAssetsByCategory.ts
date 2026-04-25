import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Database, Tables } from "@/integrations/supabase/types";

type VaultCategory = Database["public"]["Enums"]["vault_category"];
export type VaultAssetRow = Tables<"vault_assets">;

/**
 * Fetches active vault assets the current user can read under RLS, scoped to
 * a single category. Used by the client Builder's Enhancements panel to list
 * the MSP's published catalog (audio, filters, widgets, icons, links, docs).
 *
 * RLS already restricts visibility to:
 *   - the provider's own assets, OR
 *   - active assets of providers the current user is client-linked to.
 * This hook just narrows by `category_type` + `is_active`.
 */
export function useVaultAssetsByCategory(category: VaultCategory) {
  const [assets, setAssets] = useState<VaultAssetRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("vault_assets")
      .select("*")
      .eq("category_type", category)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      // Don't shout for every category that happens to be empty; surface only
      // genuine read failures.
      console.warn(`[vault] failed to load ${category}:`, error);
      toast.error(`Failed to load ${category.replace("_", " ")} assets`);
      setAssets([]);
    } else {
      setAssets((data as VaultAssetRow[]) ?? []);
    }
    setLoading(false);
  }, [category]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { assets, loading, refresh };
}
