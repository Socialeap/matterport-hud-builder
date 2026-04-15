import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

interface SavePresentationInput {
  providerId: string;
  name: string;
  properties: Array<{
    id: string;
    name: string;
    location: string;
    matterportId: string;
    musicUrl: string;
  }>;
  tourConfig: Record<string, unknown>;
  agent: Record<string, string>;
  brandingOverrides: {
    brandName: string;
    accentColor: string;
    hudBgColor: string;
    gateLabel: string;
  };
}

export const savePresentationRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: SavePresentationInput) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: model, error: modelError } = await supabase
      .from("saved_models")
      .insert({
        client_id: userId,
        provider_id: data.providerId,
        name: data.name || "Untitled Presentation",
        properties: data.properties as unknown as import("@/integrations/supabase/types").Json,
        tour_config: {
          behaviors: data.tourConfig,
          agent: data.agent,
          brandingOverrides: data.brandingOverrides,
        } as unknown as import("@/integrations/supabase/types").Json,
        status: "pending_payment" as const,
        is_released: false,
        model_count: data.properties.filter((p) => p.matterportId.trim()).length,
      })
      .select("id")
      .single();

    if (modelError || !model) {
      console.error("Failed to save model:", modelError);
      return { success: false, error: "Failed to save presentation" };
    }

    const { error: notifError } = await supabase
      .from("order_notifications")
      .insert({
        provider_id: data.providerId,
        client_id: userId,
        model_id: model.id,
        status: "unread",
      });

    if (notifError) {
      console.error("Failed to create notification:", notifError);
    }

    return { success: true, modelId: model.id };
  });

export const checkFulfillmentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { modelId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: model, error } = await supabase
      .from("saved_models")
      .select("id, status, is_released, name, properties, tour_config")
      .eq("id", data.modelId)
      .eq("client_id", userId)
      .single();

    if (error || !model) {
      return { allowed: false, reason: "Presentation not found" };
    }

    if (model.status !== "paid") {
      return { allowed: false, reason: "Payment has not been confirmed yet" };
    }

    if (!model.is_released) {
      return { allowed: false, reason: "Presentation has not been released by the provider yet" };
    }

    // Fulfillment guard passed — return the config for generation
    return {
      allowed: true,
      reason: null,
      config: {
        name: model.name,
        properties: model.properties,
        tourConfig: model.tour_config,
      },
    };
  });

interface PropertyData {
  id: string;
  name: string;
  location: string;
  matterportId: string;
  musicUrl: string;
}

interface TourConfigData {
  behaviors?: Record<string, Record<string, unknown>>;
  agent?: Record<string, string>;
  brandingOverrides?: {
    brandName: string;
    accentColor: string;
    hudBgColor: string;
    gateLabel: string;
  };
}

function buildMatterportUrlServer(modelId: string, behavior: Record<string, unknown>): string {
  if (!modelId) return "";
  const params: string[] = [];
  if (behavior.hideBranding) params.push("brand=0");
  if (behavior.mlsModeEnabled) params.push(`mls=${behavior.mlsModeValue || "1"}`);
  if (behavior.hideTitle) params.push("title=0");
  if (behavior.autoPlay) params.push("play=1");
  if (behavior.quickstart) params.push("qs=1");
  if (behavior.autoStartTour) params.push(`ts=${behavior.autoStartTourDelay || "8"}`);
  if (behavior.loopGuidedTour) params.push("lp=1");
  if (behavior.hideDollhouse) params.push("dh=0");
  if (behavior.hideHighlightReel) params.push("hr=0");
  if (behavior.singleFloorFocus) params.push("f=0");
  if (behavior.hideMattertags) params.push("mt=0");
  if (behavior.hideSearch) params.push("search=0");
  if (behavior.disableScrollWheelZoom) params.push("wh=0");
  if (behavior.disableZoom) params.push("nozoom=1");
  if (behavior.forceLanguage) params.push(`lang=${behavior.languageCode || "en"}`);
  if (behavior.hideGuidedPath) params.push("guidedpath=0");
  if (behavior.transitionEnabled) params.push(`transition=${behavior.transitionValue || "2"}`);
  if (behavior.customParams) params.push(String(behavior.customParams));
  const qs = params.length > 0 ? `&${params.join("&")}` : "";
  return `https://my.matterport.com/show/?m=${modelId}${qs}`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const generatePresentation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { modelId: string }) => data)
  .handler(async ({ data, context }): Promise<{ success: boolean; html?: string; error?: string }> => {
    const { supabase, userId } = context;

    // Verify fulfillment
    const { data: model, error } = await supabase
      .from("saved_models")
      .select("id, status, is_released, name, properties, tour_config, provider_id")
      .eq("id", data.modelId)
      .eq("client_id", userId)
      .single();

    if (error || !model) {
      return { success: false, error: "Presentation not found" };
    }
    if (model.status !== "paid") {
      return { success: false, error: "Payment not confirmed" };
    }
    if (!model.is_released) {
      return { success: false, error: "Not released by provider" };
    }

    // Get provider branding
    const { data: brandingData } = await supabase
      .from("branding_settings")
      .select("*")
      .eq("provider_id", model.provider_id)
      .single();

    const properties = (model.properties || []) as unknown as PropertyData[];
    const tourConfig = (model.tour_config || {}) as unknown as TourConfigData;
    const behaviors = tourConfig.behaviors || {};
    const agent = tourConfig.agent || {};
    const overrides = (tourConfig.brandingOverrides || {}) as Record<string, string>;

    const brandName = overrides.brandName || brandingData?.brand_name || "Property Tours";
    const accentColor = overrides.accentColor || brandingData?.accent_color || "#3B82F6";
    const hudBgColor = overrides.hudBgColor || brandingData?.hud_bg_color || "#1a1a2e";
    const gateLabel = overrides.gateLabel || brandingData?.gate_label || "Enter";
    const isPro = brandingData?.tier === "pro";
    const logoUrl = brandingData?.logo_url || "";

    // Build iframe URLs for each property
    const propertyEntries = properties
      .filter((p) => p.matterportId?.trim())
      .map((p) => {
        const behavior = behaviors[p.id] || {};
        return {
          name: p.name || "Untitled",
          location: p.location || "",
          iframeUrl: buildMatterportUrlServer(p.matterportId, behavior),
          musicUrl: p.musicUrl || "",
        };
      });

    // Base64-encode config for obfuscation
    const configObj = {
      properties: propertyEntries,
      agent,
      brandName,
      accentColor,
      hudBgColor,
      gateLabel,
      logoUrl,
    };
    const configB64 = Buffer.from(JSON.stringify(configObj)).toString("base64");

    const poweredBy = isPro
      ? ""
      : `<div style="text-align:center;padding:8px;font-size:11px;color:#888;border-top:1px solid #333;">Powered by Transcendence Media</div>`;

    const agentDrawer = agent.name
      ? `<div id="agent-drawer" style="display:none;position:fixed;top:0;right:0;width:320px;height:100%;background:${escapeHtml(hudBgColor)};color:#fff;z-index:1000;box-shadow:-4px 0 20px rgba(0,0,0,0.5);padding:24px;overflow-y:auto;">
          <button onclick="document.getElementById('agent-drawer').style.display='none'" style="position:absolute;top:12px;right:12px;background:none;border:none;color:#fff;font-size:20px;cursor:pointer;">&times;</button>
          <h3 style="margin-top:32px;font-size:18px;">${escapeHtml(String(agent.name))}</h3>
          ${agent.titleRole ? `<p style="color:#aaa;font-size:13px;">${escapeHtml(String(agent.titleRole))}</p>` : ""}
          ${agent.email ? `<p style="margin-top:12px;"><a href="mailto:${escapeHtml(String(agent.email))}" style="color:${escapeHtml(accentColor)};">${escapeHtml(String(agent.email))}</a></p>` : ""}
          ${agent.phone ? `<p><a href="tel:${escapeHtml(String(agent.phone))}" style="color:${escapeHtml(accentColor)};">${escapeHtml(String(agent.phone))}</a></p>` : ""}
          ${agent.welcomeNote ? `<p style="margin-top:16px;font-size:13px;color:#ccc;">${escapeHtml(String(agent.welcomeNote))}</p>` : ""}
        </div>`
      : "";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(model.name || "3D Presentation")}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#000;color:#fff;overflow:hidden}
#gate{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:${hudBgColor};z-index:2000;transition:opacity 0.5s}
#gate.hidden{opacity:0;pointer-events:none}
#gate h1{font-size:28px;margin-bottom:8px}
#gate p{color:#aaa;font-size:14px;margin-bottom:24px}
#gate button{padding:12px 32px;font-size:16px;border:none;border-radius:8px;cursor:pointer;background:${accentColor};color:#fff;font-weight:600}
#hud{position:fixed;bottom:0;left:0;right:0;background:${hudBgColor}ee;backdrop-filter:blur(12px);z-index:100;padding:8px 16px;display:flex;align-items:center;gap:8px}
#hud .tab{padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;background:transparent;border:1px solid #555;color:#ccc;transition:all 0.2s}
#hud .tab.active{background:${accentColor};border-color:${accentColor};color:#fff}
#hud .spacer{flex:1}
#hud .agent-btn{padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;background:${accentColor};border:none;color:#fff}
#viewer{position:fixed;inset:0;bottom:50px}
#viewer iframe{width:100%;height:100%;border:none}
${logoUrl ? `#gate img.logo{max-height:64px;margin-bottom:16px}` : ""}
</style>
</head>
<body>
<div id="gate">
  ${logoUrl ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="Logo">` : ""}
  <h1>${escapeHtml(brandName)}</h1>
  <p>${escapeHtml(model.name || "")}</p>
  <button onclick="document.getElementById('gate').classList.add('hidden')">${escapeHtml(gateLabel)}</button>
</div>
<div id="viewer"><iframe id="matterport-frame" allowfullscreen></iframe></div>
<div id="hud">
  <div id="tabs"></div>
  <div class="spacer"></div>
  ${agent.name ? `<button class="agent-btn" onclick="document.getElementById('agent-drawer').style.display='block'">Contact</button>` : ""}
</div>
${agentDrawer}
${poweredBy}
<script>
(function(){
var C=JSON.parse(atob("${configB64}"));
var props=C.properties;
var frame=document.getElementById("matterport-frame");
var tabsEl=document.getElementById("tabs");
var current=0;
function load(i){
  current=i;
  frame.src=props[i].iframeUrl;
  var tabs=tabsEl.querySelectorAll(".tab");
  tabs.forEach(function(t,j){t.classList.toggle("active",j===i)});
}
props.forEach(function(p,i){
  var btn=document.createElement("button");
  btn.className="tab"+(i===0?" active":"");
  btn.textContent=p.name;
  btn.onclick=function(){load(i)};
  tabsEl.appendChild(btn);
});
if(props.length>0) load(0);
})();
</script>
</body>
</html>`;

    return { success: true, html };
  });
