import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Evaluate which trial-conversion email (if any) should be sent for a provider.
 *
 * Returns one of:
 *  - { template: 'grant-expiry-warning', ... }  — 7 days before expiry
 *  - { template: 'trial-expired', ... }          — on expiry day
 *  - { template: 'trial-purge-warning', ... }    — 30 days after expiry
 *  - { template: null }                          — no email needed
 *
 * Prevents repeated sends by checking email_send_log exactly like
 * grant-expiry.functions.ts does.
 */
export const checkTrialConversionEmailNeeded = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { recipientEmail: string; providerId: string }) => input,
  )
  .handler(async ({ data }) => {
    const supabaseUrl =
      process.env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return { template: null as string | null };
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Check if provider has active paid access — if so, no conversion email needed.
    const { data: hasPaid } = await admin.rpc("provider_has_paid_access", {
      _provider_id: data.providerId,
    });
    if (hasPaid === true) {
      return { template: null };
    }

    // Resolve the provider's license/grant state to determine timeline position.
    const { data: license } = await admin
      .from("licenses")
      .select("license_status, license_expiry, updated_at")
      .eq("user_id", data.providerId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: grant } = await admin
      .from("admin_grants")
      .select("expires_at, revoked_at, created_at")
      .eq("provider_id", data.providerId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Determine the effective expiry date from the most recent license or grant.
    let expiryDate: Date | null = null;

    if (license?.license_expiry) {
      expiryDate = new Date(license.license_expiry);
    }
    if (grant?.expires_at) {
      const grantExpiry = new Date(grant.expires_at);
      if (!expiryDate || grantExpiry > expiryDate) {
        expiryDate = grantExpiry;
      }
    }

    // If no expiry date found, check if there's a license that went inactive.
    if (!expiryDate && license?.license_status !== "active" && license?.updated_at) {
      expiryDate = new Date(license.updated_at);
    }

    if (!expiryDate) {
      return { template: null };
    }

    const now = Date.now();
    const expiryMs = expiryDate.getTime();
    const daysUntilExpiry = Math.ceil((expiryMs - now) / (24 * 60 * 60 * 1000));
    const daysSinceExpiry = Math.floor((now - expiryMs) / (24 * 60 * 60 * 1000));

    let templateName: string | null = null;

    if (daysUntilExpiry > 0 && daysUntilExpiry <= 7) {
      templateName = "grant-expiry-warning";
    } else if (daysUntilExpiry <= 0 && daysSinceExpiry <= 3) {
      templateName = "trial-expired";
    } else if (daysSinceExpiry >= 30 && daysSinceExpiry <= 37) {
      templateName = "trial-purge-warning";
    }

    if (!templateName) {
      return { template: null };
    }

    // Prevent duplicate sends: check if this template was already sent recently.
    const dedupeWindow =
      templateName === "trial-purge-warning" ? THIRTY_DAYS_MS : SEVEN_DAYS_MS;
    const cutoff = new Date(now - dedupeWindow).toISOString();

    const { data: recent } = await admin
      .from("email_send_log")
      .select("id")
      .eq("recipient_email", data.recipientEmail.toLowerCase())
      .eq("template_name", templateName)
      .eq("status", "sent")
      .gt("created_at", cutoff)
      .limit(1)
      .maybeSingle();

    if (recent) {
      return { template: null };
    }

    return {
      template: templateName,
      expiryDate: expiryDate.toISOString(),
      daysUntilExpiry,
      daysSinceExpiry,
    };
  });
