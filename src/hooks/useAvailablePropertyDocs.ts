import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type AvailablePropertyDoc = Tables<"vault_assets">;

/**
 * Lists `category_type='property_doc'` vault assets the current user is
 * allowed to see under RLS: the user's own (if they're a provider)
 * plus any active docs from providers they're client-linked to.
 *
 * No provider_id filter — RLS does the scoping via the
 * "Clients can view active vault assets from their providers" +
 * "Providers can view their own vault assets" policies. We filter
 * `is_active=true` here so the picker never offers hidden docs.
 */
export function useAvailablePropertyDocs() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<AvailablePropertyDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("vault_assets")
      .select("*")
      .eq("category_type", "property_doc")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load property docs");
    } else {
      setDocs((data as AvailablePropertyDoc[]) ?? []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { docs, loading, refresh };
}
