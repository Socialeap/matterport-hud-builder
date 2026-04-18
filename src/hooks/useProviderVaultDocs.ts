import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type VaultDocAsset = Tables<"vault_assets">;

/**
 * Provider-scoped list of vault assets with category_type='property_doc'.
 * Used by the builder's Property Docs panel to let the MSP pick which
 * uploaded PDF to extract against a template for a given property.
 */
export function useProviderVaultDocs() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<VaultDocAsset[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("vault_assets")
      .select("*")
      .eq("provider_id", user.id)
      .eq("category_type", "property_doc")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load property docs");
    } else {
      setDocs((data as VaultDocAsset[]) ?? []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { docs, loading, refresh };
}
