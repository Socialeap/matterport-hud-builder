/**
 * Provider-wide LUS (License for Upkeep Services) state.
 *
 * The LUS is paid by the MSP (provider) and unlocks the "Premium Studio"
 * experience for both the provider and any clients linked to them via
 * `client_providers`. When inactive, the platform reverts to vanilla mode:
 * Smart Doc Engine dropzone, Neighborhood Map toggle, and premium Vault
 * menus are hidden, but existing data continues to render.
 *
 * Resolution order:
 *   1. If the current user has their own `licenses` row, that wins
 *      (they are the MSP / provider).
 *   2. Otherwise, look up the provider they're linked to via
 *      `get_provider_license(client_uuid)` (clients).
 *
 * Active = `license_status === 'active'` AND (no expiry OR expiry in the future).
 *
 * Distinct from `useLusFreeze`, which is a per-property write lock applied
 * by the provider to a single property_uuid.
 */
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type AppTier = Database["public"]["Enums"]["app_tier"];
type LicenseStatus = Database["public"]["Enums"]["license_status"];

export interface LusLicenseInfo {
  tier: AppTier;
  license_status: LicenseStatus;
  license_expiry: string | null;
  studio_id: string;
  /** Resolved provider whose license governs this user (self if MSP). */
  provider_id: string;
}

function isActive(info: LusLicenseInfo | null): boolean {
  if (!info) return false;
  if (info.license_status !== "active") return false;
  if (info.license_expiry && new Date(info.license_expiry).getTime() < Date.now()) {
    return false;
  }
  return true;
}

export function useLusLicense() {
  const { user } = useAuth();
  const [info, setInfo] = useState<LusLicenseInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setInfo(null);
      setLoading(false);
      return;
    }
    setLoading(true);

    // 1. Provider self-check
    const { data: own } = await supabase.rpc("get_license_info", {
      user_uuid: user.id,
    });
    if (own && own.length > 0) {
      const row = own[0];
      setInfo({
        tier: row.tier,
        license_status: row.license_status,
        license_expiry: row.license_expiry,
        studio_id: row.studio_id,
        provider_id: user.id,
      });
      setLoading(false);
      return;
    }

    // 2. Client → resolve via linked provider
    const { data: prov } = await supabase.rpc("get_provider_license", {
      client_uuid: user.id,
    });
    if (prov && prov.length > 0) {
      const row = prov[0];
      setInfo({
        tier: row.tier,
        license_status: row.license_status,
        license_expiry: row.license_expiry,
        studio_id: row.studio_id,
        provider_id: row.provider_id,
      });
    } else {
      setInfo(null);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    info,
    isActive: isActive(info),
    loading,
    refresh,
  };
}
