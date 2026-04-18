import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { VaultTemplate } from "@/lib/extraction/provider";

/**
 * Lists active vault_templates readable by the current user under RLS:
 *   - The user's own templates (if they're a provider), via the
 *     "Providers manage their templates" policy.
 *   - Any active templates from providers they're client-linked to,
 *     via the "Bound clients can read active templates" policy.
 *
 * Contrast with `useVaultTemplates` (MSP editor) which filters on
 * `provider_id = auth.uid()` and covers the provider's CRUD surface.
 */
export function useAvailableTemplates() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<VaultTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("vault_templates")
      .select("*")
      .eq("is_active", true)
      .order("label", { ascending: true });

    if (error) {
      toast.error("Failed to load templates");
    } else {
      setTemplates((data as unknown as VaultTemplate[]) ?? []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { templates, loading, refresh };
}
