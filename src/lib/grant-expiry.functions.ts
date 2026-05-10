import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Trim then lowercase the email so the downstream `.eq("recipient_email", …)`
// query matches the normalised value the email pipeline writes. `.email()`
// rejects malformed addresses; `.max(254)` matches RFC 5321.
const CheckGrantExpiryInputSchema = z.object({
  recipientEmail: z.string().trim().toLowerCase().email().max(254),
});

/**
 * Server-side check (service-role) — determines whether a grant-expiry-warning
 * email needs to be sent for the given recipient. Returns `shouldSend: true`
 * only if no such email has been logged in the last 7 days, preventing repeated
 * sends on every dashboard load.
 */
export const checkGrantExpiryEmailNeeded = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => CheckGrantExpiryInputSchema.parse(input))
  .handler(async ({ data }) => {
    const supabaseUrl = process.env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return { shouldSend: false };
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const cutoff = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
    // recipientEmail is already trimmed + lowercased by the schema.
    const { data: recent } = await admin
      .from("email_send_log")
      .select("id")
      .eq("recipient_email", data.recipientEmail)
      .eq("template_name", "grant-expiry-warning")
      .eq("status", "sent")
      .gt("created_at", cutoff)
      .limit(1)
      .maybeSingle();

    return { shouldSend: !recent };
  });
