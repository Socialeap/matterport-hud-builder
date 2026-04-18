import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { VaultTemplate, JsonSchema, ExtractorId } from "@/lib/extraction/provider";

interface CreateInput {
  label: string;
  doc_kind: string;
  field_schema: JsonSchema;
  extractor?: ExtractorId;
}

interface UpdateInput {
  label?: string;
  doc_kind?: string;
  field_schema?: JsonSchema;
  extractor?: ExtractorId;
  is_active?: boolean;
  version?: number;
}

export function useVaultTemplates() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<VaultTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("vault_templates")
      .select("*")
      .eq("provider_id", user.id)
      .order("created_at", { ascending: false });

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

  const create = useCallback(
    async (input: CreateInput) => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("vault_templates")
        .insert({
          provider_id: user.id,
          label: input.label,
          doc_kind: input.doc_kind,
          field_schema: input.field_schema as unknown as Json,
          extractor: input.extractor ?? "pdfjs_heuristic",
        })
        .select()
        .single();

      if (error || !data) {
        toast.error("Failed to create template");
        return null;
      }
      toast.success("Template created");
      await refresh();
      return data as unknown as VaultTemplate;
    },
    [user, refresh],
  );

  const update = useCallback(
    async (id: string, patch: UpdateInput) => {
      const updatePatch: Record<string, unknown> = { ...patch };
      if (patch.field_schema !== undefined) {
        updatePatch.field_schema = patch.field_schema as unknown as Json;
      }
      const { error } = await supabase
        .from("vault_templates")
        .update(updatePatch as never)
        .eq("id", id);
      if (error) {
        toast.error("Failed to update template");
        return false;
      }
      toast.success("Template updated");
      await refresh();
      return true;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from("vault_templates")
        .delete()
        .eq("id", id);
      if (error) {
        toast.error("Failed to delete template");
        return false;
      }
      toast.success("Template deleted");
      await refresh();
      return true;
    },
    [refresh],
  );

  return { templates, loading, refresh, create, update, remove };
}
