import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export interface LusFreeze {
  property_uuid: string;
  frozen_at: string;
  frozen_by: string;
  reason: string | null;
}

export function useLusFreeze(propertyUuid: string | null) {
  const { user } = useAuth();
  const [freeze, setFreeze] = useState<LusFreeze | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!propertyUuid) {
      setFreeze(null);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("lus_freezes")
      .select("*")
      .eq("property_uuid", propertyUuid)
      .maybeSingle();
    if (error) {
      setFreeze(null);
    } else {
      setFreeze((data as unknown as LusFreeze) ?? null);
    }
    setLoading(false);
  }, [propertyUuid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const freezeProperty = useCallback(
    async (reason?: string) => {
      if (!user || !propertyUuid) return false;
      const { error } = await supabase.from("lus_freezes").upsert(
        {
          property_uuid: propertyUuid,
          frozen_by: user.id,
          reason: reason ?? null,
        },
        { onConflict: "property_uuid" },
      );
      if (error) {
        toast.error("Failed to freeze");
        return false;
      }
      toast.success("Property frozen");
      await refresh();
      return true;
    },
    [user, propertyUuid, refresh],
  );

  const unfreeze = useCallback(async () => {
    if (!propertyUuid) return false;
    const { error } = await supabase
      .from("lus_freezes")
      .delete()
      .eq("property_uuid", propertyUuid);
    if (error) {
      toast.error("Failed to unfreeze");
      return false;
    }
    toast.success("Property unfrozen");
    await refresh();
    return true;
  }, [propertyUuid, refresh]);

  return {
    freeze,
    isFrozen: !!freeze,
    loading,
    refresh,
    freezeProperty,
    unfreeze,
  };
}
