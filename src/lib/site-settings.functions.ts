import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getSupabaseUrl,
  getSupabasePublishableKey,
} from "@/integrations/supabase/env";

export type CheckoutMode = "live" | "waitlist";

export const fetchCheckoutMode = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ mode: CheckoutMode }> => {
    // Use the publishable (anon) client — checkout_mode is a public read
    // and this avoids requiring SUPABASE_SERVICE_ROLE_KEY at runtime.
    const client = createClient(getSupabaseUrl(), getSupabasePublishableKey());
    const { data, error } = await client
      .from("site_settings")
      .select("value")
      .eq("key", "checkout_mode")
      .maybeSingle();

    if (error || !data) return { mode: "live" };

    const raw = (data as { value: unknown }).value;
    if (raw === "waitlist") return { mode: "waitlist" };
    return { mode: "live" };
  },
);

export const updateCheckoutMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { mode: CheckoutMode }) => input)
  .handler(async ({ data, context }) => {
    const { data: roleRow } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleRow) {
      throw new Response("Forbidden", { status: 403 });
    }

    const { error } = await supabaseAdmin
      .from("site_settings")
      .update({
        value: data.mode satisfies string,
        updated_at: new Date().toISOString(),
        updated_by: context.userId,
      })
      .eq("key", "checkout_mode");

    if (error) throw new Response("Failed to update setting", { status: 500 });

    return { mode: data.mode };
  });
