import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const pollEmailSendStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { messageId: string }) => input)
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

    const { data: entries, error } = await supabaseAdmin
      .from("email_send_log")
      .select("status, error_message, created_at")
      .eq("message_id", data.messageId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Response("Failed to query email send log", { status: 500 });
    }

    return { entries: entries ?? [] };
  });
