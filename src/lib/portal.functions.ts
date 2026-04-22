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
    /** Optional client-supplied logo URL (already uploaded to storage). */
    logoUrl?: string;
    /** Optional client-supplied favicon URL (already uploaded to storage). */
    faviconUrl?: string;
  };
}

export const savePresentationRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: SavePresentationInput) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Provider-link guard: ensure the client is actually linked to this MSP.
    // resolve_studio_access auto-heals from accepted invitations server-side.
    const { data: accessRows, error: accessError } = await supabase.rpc(
      "resolve_studio_access",
      { _provider_id: data.providerId },
    );
    if (accessError) {
      console.error("resolve_studio_access failed:", accessError);
      return { success: false, error: "Could not verify Studio access" };
    }
    const access = Array.isArray(accessRows) ? accessRows[0] : null;
    if (!access?.linked) {
      return {
        success: false,
        error: "You are not linked to this provider. Please use your invitation link to access this Studio.",
      };
    }

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

/**
 * Narrowly typed facade over the Supabase client — only the three calls
 * we actually make. Keeps us from having to import the heavyweight
 * generated Database type into this helper's public signature.
 */
type PropertyDocsSupabase = {
  from: (table: "property_extractions" | "vault_templates") => {
    select: (cols: string) => {
      in: (col: string, vals: string[]) => PromiseLike<{
        data: Array<Record<string, unknown>> | null;
        error: unknown;
      }>;
    };
  };
};

async function loadExtractionsByProperty(
  supabase: PropertyDocsSupabase,
  propertyUuids: string[],
): Promise<Record<string, PropertyExtractionForHud[]>> {
  if (propertyUuids.length === 0) return {};
  try {
    const { data: rows, error } = await supabase
      .from("property_extractions")
      .select(
        "template_id, property_uuid, fields, chunks, canonical_qas, extracted_at",
      )
      .in("property_uuid", propertyUuids);
    if (error || !rows) {
      if (error) console.error("property_extractions fetch failed:", error);
      return {};
    }

    const templateIds = Array.from(
      new Set(rows.map((r) => String(r.template_id))),
    );
    const labelByTemplate: Record<string, string> = {};
    if (templateIds.length > 0) {
      const { data: templates } = await supabase
        .from("vault_templates")
        .select("id, label, doc_kind")
        .in("id", templateIds);
      for (const t of templates ?? []) {
        labelByTemplate[String(t.id)] =
          String(t.label ?? "") || String(t.doc_kind ?? "Document");
      }
    }

    const out: Record<string, PropertyExtractionForHud[]> = {};
    for (const row of rows) {
      const uuid = String(row.property_uuid);
      const tplId = String(row.template_id);
      const bucket = (out[uuid] ??= []);
      const rawChunks = Array.isArray(row.chunks) ? row.chunks : [];
      const rawCanonicalQAs = Array.isArray(row.canonical_qas)
        ? row.canonical_qas
        : [];
      bucket.push({
        template_id: tplId,
        template_label: labelByTemplate[tplId] || "Document",
        fields: (row.fields as Record<string, unknown>) ?? {},
        chunks: rawChunks
          .filter(
            (c): c is {
              id: string;
              section: string;
              content: string;
              embedding?: unknown;
            } =>
              !!c &&
              typeof c === "object" &&
              typeof (c as { content?: unknown }).content === "string",
          )
          .map((c) => ({
            id: String(c.id ?? ""),
            section: String(c.section ?? ""),
            content: String(c.content ?? ""),
            embedding: normalizeEmbedding(c.embedding),
          })),
        canonical_qas: rawCanonicalQAs
          .filter(
            (q): q is {
              id: string;
              field: string;
              question: string;
              answer: string;
              source_anchor_id: string;
              embedding?: unknown;
            } =>
              !!q &&
              typeof q === "object" &&
              typeof (q as { question?: unknown }).question === "string" &&
              typeof (q as { answer?: unknown }).answer === "string",
          )
          .map((q) => ({
            id: String(q.id ?? ""),
            field: String(q.field ?? ""),
            question: String(q.question ?? ""),
            answer: String(q.answer ?? ""),
            source_anchor_id: String(q.source_anchor_id ?? ""),
            embedding: normalizeEmbedding(q.embedding),
          })),
        extracted_at: String(row.extracted_at ?? ""),
      });
    }
    return out;
  } catch (err) {
    console.error("loadExtractionsByProperty threw:", err);
    return {};
  }
}

/** Coerce an unknown JSONB value to a number[] or null. Guards against
 *  pgvector-style serialised strings and drops malformed shapes. */
function normalizeEmbedding(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0) return null;
  const out: number[] = [];
  for (const v of raw) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

interface QADatabaseEntry {
  id: string;
  question: string;
  answer: string;
  source_anchor_id: string;
  embedding: number[];
}

interface PropertyExtractionForHud {
  template_id: string;
  template_label: string;
  fields: Record<string, unknown>;
  chunks: Array<{
    id: string;
    section: string;
    content: string;
    embedding: number[] | null;
  }>;
  canonical_qas: Array<{
    id: string;
    field: string;
    question: string;
    answer: string;
    source_anchor_id: string;
    embedding: number[] | null;
  }>;
  extracted_at: string;
}

type ExtractionsByProperty = Record<string, PropertyExtractionForHud[]>;

/**
 * Safely embed a JSON literal inside an HTML <script> tag.
 * Prevents `</script>` break-out and JS-parser hazards from U+2028 / U+2029.
 */
function safeJsonScriptLiteral(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Docs Q&A panel (Phase 3). A lazily-initialised chat surface that
 * BM25-searches the active property's chunks + fields-as-text via Orama.
 * Emits CSS, the DOM shell, and the toggle button. The runtime
 * initialisation lives in the main IIFE below so it shares the
 * `load(i)` tab-change hook. Empty string when no property has docs.
 */
function buildDocsQaAssets(
  extractionsByProperty: ExtractionsByProperty,
  hudBgColor: string,
  accentColor: string,
): { css: string; toggleBtn: string; panelHtml: string; enabled: boolean } {
  const anyDocs = Object.values(extractionsByProperty).some((arr) =>
    arr.some(
      (e) =>
        (e.chunks && e.chunks.length > 0) ||
        Object.keys(e.fields ?? {}).length > 0,
    ),
  );
  if (!anyDocs) {
    return { css: "", toggleBtn: "", panelHtml: "", enabled: false };
  }

  const css = `
#docs-qa-toggle{padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;background:${escapeHtml(accentColor)};border:none;color:#fff;display:flex;align-items:center;gap:6px}
#docs-qa-toggle svg{width:14px;height:14px}
#docs-qa-panel{display:none;position:fixed;bottom:56px;right:16px;width:380px;max-width:calc(100vw - 32px);height:480px;max-height:calc(100vh - 80px);background:${escapeHtml(hudBgColor)};border:1px solid #333;border-radius:12px;z-index:99;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.5);overflow:hidden}
#docs-qa-panel.open{display:flex}
#docs-qa-header{padding:12px 16px;border-bottom:1px solid #333;display:flex;align-items:center;justify-content:space-between}
#docs-qa-header h4{font-size:14px;font-weight:600;color:#fff;margin:0}
#docs-qa-close{background:none;border:none;color:#999;font-size:18px;cursor:pointer;padding:0 4px}
#docs-qa-messages{flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px}
.dqa-msg{max-width:88%;padding:8px 12px;border-radius:10px;font-size:13px;line-height:1.5;word-wrap:break-word;white-space:pre-wrap}
.dqa-msg.user{align-self:flex-end;background:${escapeHtml(accentColor)};color:#fff;border-bottom-right-radius:4px}
.dqa-msg.assistant{align-self:flex-start;background:#2a2a3e;color:#ddd;border-bottom-left-radius:4px}
.dqa-src{display:inline-block;margin-top:6px;padding:2px 8px;font-size:11px;color:#aaa;font-style:italic}
#docs-qa-input-row{padding:10px 12px;border-top:1px solid #333;display:flex;gap:8px;align-items:center}
#docs-qa-input{flex:1;background:#1e1e30;border:1px solid #444;border-radius:8px;padding:8px 12px;color:#fff;font-size:13px;outline:none}
#docs-qa-input:focus{border-color:${escapeHtml(accentColor)}}
#docs-qa-input:disabled{opacity:0.5;cursor:not-allowed}
#docs-qa-send{background:${escapeHtml(accentColor)};border:none;color:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:13px;font-weight:600}
#docs-qa-send:disabled{opacity:0.4;cursor:not-allowed}
`;

  const toggleBtn = `<button id="docs-qa-toggle" onclick="window.__openDocsQa&&window.__openDocsQa()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Ask docs</button>`;

  const panelHtml = `
<div id="docs-qa-panel">
  <div id="docs-qa-header">
    <h4>Ask the property docs</h4>
    <button id="docs-qa-close" onclick="document.getElementById('docs-qa-panel').classList.remove('open')">&times;</button>
  </div>
  <div id="docs-qa-messages"><div class="dqa-msg assistant">Hi! I can answer questions from the uploaded docs for this property. Try asking about fields, terms, dates, or amounts.</div></div>
  <div id="docs-qa-input-row">
    <input id="docs-qa-input" type="text" placeholder="Initializing search…" disabled />
    <button id="docs-qa-send" disabled>Send</button>
  </div>
</div>`;

  return { css, toggleBtn, panelHtml, enabled: true };
}

/** Renders a per-property-extraction block as trusted HTML. All dynamic
 *  values are escaped. Returned string is safe to interpolate into the
 *  <body>. Empty string when there are no extractions for any property. */
function buildPropertyDocsPanel(
  extractionsByProperty: ExtractionsByProperty,
  hudBgColor: string,
  accentColor: string,
): string {
  const anyExtractions = Object.values(extractionsByProperty).some(
    (arr) => arr.length > 0,
  );
  if (!anyExtractions) return "";

  const css = `
#property-docs{position:fixed;bottom:56px;left:16px;width:320px;max-width:calc(100vw - 32px);max-height:calc(100vh - 96px);background:${escapeHtml(hudBgColor)};border:1px solid #333;border-radius:12px;z-index:99;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.5);overflow:hidden;transition:transform 0.2s}
#property-docs.collapsed{transform:translateY(calc(100% - 40px))}
#pd-header{padding:10px 14px;border-bottom:1px solid #333;display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none}
#pd-header h4{font-size:13px;font-weight:600;color:#fff;margin:0}
#pd-toggle{background:none;border:none;color:#999;font-size:14px;cursor:pointer;padding:0 4px;pointer-events:none}
#pd-body{flex:1;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:12px}
.pd-extraction .pd-tpl{font-size:11px;font-weight:600;color:${escapeHtml(accentColor)};text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px}
.pd-extraction dl{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:12px}
.pd-extraction dt{color:#999;font-family:ui-monospace,Menlo,monospace;font-size:11px;white-space:nowrap}
.pd-extraction dd{color:#ddd;word-break:break-word}
.pd-empty{font-size:12px;color:#888;padding:8px 0;text-align:center}
`;

  // The DOM shell is emitted once; the body is re-rendered on tab change
  // via renderPropertyDocs(i) below.
  return `
<style>${css}</style>
<div id="property-docs">
  <div id="pd-header" onclick="document.getElementById('property-docs').classList.toggle('collapsed')">
    <h4>Property Docs</h4>
    <button id="pd-toggle" aria-hidden="true">&#x25BC;</button>
  </div>
  <div id="pd-body"></div>
</div>`;
}

export const generatePresentation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { modelId: string; qaDatabase?: QADatabaseEntry[] }) => data)
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

    const qaDatabase = data.qaDatabase ?? [];
    const hasQA = qaDatabase.length > 0;

    // ── Property Docs: pull extractions for every property in the model
    //    (bridge: saved_model.properties[i].id === property_extractions.property_uuid).
    //    Runs under the client's auth; Phase 1 RLS grants SELECT via
    //    the "Bound clients can read extractions" policy. Any failure is
    //    swallowed — the tour must still generate if docs are unavailable.
    const propertyUuids = properties
      .map((p) => p.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const extractionsByProperty = await loadExtractionsByProperty(
      supabase as unknown as PropertyDocsSupabase,
      propertyUuids,
    );
    // propertyUuidByIndex mirrors the filtered propertyEntries order so the
    // runtime tab-switcher can look up extractions by current tab index.
    const propertyUuidByIndex = properties
      .filter((p) => p.matterportId?.trim())
      .map((p) => p.id);

    // Base64-encode config for obfuscation
    const configObj = {
      properties: propertyEntries,
      agent,
      brandName,
      accentColor,
      hudBgColor,
      gateLabel,
      logoUrl,
      propertyUuidByIndex,
    };
    const configB64 = Buffer.from(JSON.stringify(configObj)).toString("base64");

    const propertyDocsPanelHtml = buildPropertyDocsPanel(
      extractionsByProperty,
      hudBgColor,
      accentColor,
    );
    const propertyDocsData = Object.values(extractionsByProperty).some(
      (arr) => arr.length > 0,
    )
      ? extractionsByProperty
      : null;

    const docsQaAssets = buildDocsQaAssets(
      extractionsByProperty,
      hudBgColor,
      accentColor,
    );

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

    // ── Chat Q&A CSS (only when qaDatabase is present) ────────────────
    const qaCss = hasQA
      ? `
#qa-toggle{padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;background:${accentColor};border:none;color:#fff;display:flex;align-items:center;gap:6px}
#qa-toggle svg{width:16px;height:16px}
#qa-panel{display:none;position:fixed;bottom:56px;right:16px;width:380px;max-width:calc(100vw - 32px);height:480px;max-height:calc(100vh - 80px);background:${hudBgColor};border:1px solid #333;border-radius:12px;z-index:999;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.5);overflow:hidden}
#qa-panel.open{display:flex}
#qa-header{padding:12px 16px;border-bottom:1px solid #333;display:flex;align-items:center;justify-content:space-between}
#qa-header h4{font-size:14px;font-weight:600;color:#fff}
#qa-close{background:none;border:none;color:#999;font-size:18px;cursor:pointer;padding:0 4px}
#qa-messages{flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px}
.qa-msg{max-width:88%;padding:8px 12px;border-radius:10px;font-size:13px;line-height:1.5;word-wrap:break-word}
.qa-msg.user{align-self:flex-end;background:${accentColor};color:#fff;border-bottom-right-radius:4px}
.qa-msg.assistant{align-self:flex-start;background:#2a2a3e;color:#ddd;border-bottom-left-radius:4px}
.qa-msg .source-link{display:inline-block;margin-top:6px;padding:2px 8px;font-size:11px;background:${accentColor}33;color:${accentColor};border-radius:4px;cursor:pointer;border:1px solid ${accentColor}55;text-decoration:none}
.qa-msg .source-link:hover{background:${accentColor}55}
.qa-msg.loading{color:#999;font-style:italic}
#qa-input-row{padding:10px 12px;border-top:1px solid #333;display:flex;gap:8px;align-items:center}
#qa-input{flex:1;background:#1e1e30;border:1px solid #444;border-radius:8px;padding:8px 12px;color:#fff;font-size:13px;outline:none}
#qa-input:focus{border-color:${accentColor}}
#qa-input:disabled{opacity:0.5;cursor:not-allowed}
#qa-send{background:${accentColor};border:none;color:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:13px;font-weight:600}
#qa-send:disabled{opacity:0.4;cursor:not-allowed}
@keyframes qa-pulse{0%,100%{opacity:0.4}50%{opacity:1}}
.qa-loading-dots span{animation:qa-pulse 1.4s infinite;animation-delay:calc(var(--i)*0.2s)}
`
      : "";

    // ── Chat panel HTML ───────────────────────────────────────────────
    const qaToggleBtn = hasQA
      ? `<button id="qa-toggle" onclick="document.getElementById('qa-panel').classList.toggle('open')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>Ask AI</button>`
      : "";

    const qaPanelHtml = hasQA
      ? `<div id="qa-panel">
  <div id="qa-header"><h4>Property Q&amp;A</h4><button id="qa-close" onclick="document.getElementById('qa-panel').classList.remove('open')">&times;</button></div>
  <div id="qa-messages"><div class="qa-msg assistant" id="qa-welcome">Hi! Ask me anything about this property.</div></div>
  <div id="qa-input-row"><input id="qa-input" type="text" placeholder="Initializing AI Assistant..." disabled /><button id="qa-send" disabled>Send</button></div>
</div>`
      : "";

    // ── Inline module script for the air-gapped chat engine ──────────
    const qaModuleScript = hasQA
      ? `<script>window.__QA_DATABASE__=${JSON.stringify(qaDatabase)};</script>
<script type="module">
// ── CDN imports ─────────────────────────────────────────────────────
const ORAMA_CDN = "https://cdn.jsdelivr.net/npm/@orama/orama@3.0.0/+esm";
const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.1.0";

const input = document.getElementById("qa-input");
const sendBtn = document.getElementById("qa-send");
const messagesEl = document.getElementById("qa-messages");

let oramaDb = null;
let embedPipeline = null;
let MODE_HYBRID = null;

function addMsg(text, role, anchorId) {
  const div = document.createElement("div");
  div.className = "qa-msg " + role;
  div.textContent = text;
  if (role === "assistant" && anchorId) {
    const link = document.createElement("span");
    link.className = "source-link";
    link.textContent = "View source: " + anchorId.replace(/-/g, " ");
    link.onclick = function() {
      var el = document.getElementById(anchorId);
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.style.outline = "2px solid ${accentColor}"; setTimeout(function(){ el.style.outline = "none"; }, 3000); }
    };
    div.appendChild(document.createElement("br"));
    div.appendChild(link);
  }
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function showLoading() {
  const div = document.createElement("div");
  div.className = "qa-msg assistant loading";
  div.id = "qa-loading";
  div.innerHTML = 'Searching<span style="--i:0"> .</span><span style="--i:1"> .</span><span style="--i:2"> .</span>';
  const spans = div.querySelectorAll("span");
  spans.forEach(function(s){ s.classList.add("qa-loading-dots"); });
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeLoading() {
  var el = document.getElementById("qa-loading");
  if (el) el.remove();
}

// ── Init pipeline ───────────────────────────────────────────────────
async function init() {
  try {
    input.placeholder = "Downloading AI model…";

    const [{ pipeline, env }, oramaModule] = await Promise.all([
      import(TRANSFORMERS_CDN),
      import(ORAMA_CDN),
    ]);

    env.allowLocalModels = false;
    input.placeholder = "Loading model into memory…";

    // WebGPU-first with WASM fallback; q8 quantisation in both paths to
    // keep cold-load bandwidth down relative to v4's fp32 default.
    try {
      if (typeof navigator !== "undefined" && navigator.gpu) {
        embedPipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { device: "webgpu", dtype: "q8" });
      }
    } catch (err) {
      console.warn("[transformers] webgpu init failed, falling back to wasm:", err);
      embedPipeline = null;
    }
    if (!embedPipeline) {
      embedPipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" });
    }
    MODE_HYBRID = oramaModule.MODE_HYBRID_SEARCH;

    input.placeholder = "Indexing property data…";

    // Build Orama DB from injected data
    const qaData = window.__QA_DATABASE__;
    oramaDb = await oramaModule.create({
      schema: { id: "string", question: "string", answer: "string", source_anchor_id: "string", embedding: "vector[384]" },
    });

    for (const entry of qaData) {
      await oramaModule.insert(oramaDb, {
        id: entry.id,
        question: entry.question,
        answer: entry.answer,
        source_anchor_id: entry.source_anchor_id,
        embedding: entry.embedding,
      });
    }

    // Ready!
    input.placeholder = "Ask a question about this property…";
    input.disabled = false;
    sendBtn.disabled = false;
  } catch (err) {
    console.error("QA init failed:", err);
    input.placeholder = "AI Assistant unavailable";
    addMsg("Sorry, I could not load the AI assistant. Please try refreshing the page.", "assistant", null);
  }
}

// ── Search handler ──────────────────────────────────────────────────
async function handleQuestion(question) {
  addMsg(question, "user", null);
  input.value = "";
  input.disabled = true;
  sendBtn.disabled = true;
  showLoading();

  try {
    const output = await embedPipeline(question, { pooling: "mean", normalize: true });
    const queryVec = Array.from(output.data);

    const { search } = await import(ORAMA_CDN);
    const results = await search(oramaDb, {
      mode: MODE_HYBRID,
      term: question,
      vector: { value: queryVec, property: "embedding" },
      limit: 3,
      similarity: 0.0,
    });

    removeLoading();

    if (results.hits.length > 0 && results.hits[0].score > 0.3) {
      const best = results.hits[0].document;
      addMsg(best.answer, "assistant", best.source_anchor_id);
    } else {
      addMsg("I don't have that specific information in the property details. Please reach out to the listing agent!", "assistant", null);
    }
  } catch (err) {
    console.error("QA search error:", err);
    removeLoading();
    addMsg("Sorry, something went wrong. Please try again.", "assistant", null);
  }

  input.disabled = false;
  sendBtn.disabled = false;
  input.focus();
}

// ── Event listeners ─────────────────────────────────────────────────
sendBtn.addEventListener("click", function() {
  var q = input.value.trim();
  if (q) handleQuestion(q);
});
input.addEventListener("keydown", function(e) {
  if (e.key === "Enter") {
    var q = input.value.trim();
    if (q) handleQuestion(q);
  }
});

init();
</script>`
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
${qaCss}
${docsQaAssets.css}
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
  ${docsQaAssets.toggleBtn}
  ${qaToggleBtn}
  ${agent.name ? `<button class="agent-btn" onclick="document.getElementById('agent-drawer').style.display='block'">Contact</button>` : ""}
</div>
${agentDrawer}
${qaPanelHtml}
${docsQaAssets.panelHtml}
${propertyDocsPanelHtml}
${poweredBy}
${
  propertyDocsData
    ? `<script>window.__PROPERTY_EXTRACTIONS__=${safeJsonScriptLiteral(propertyDocsData)};</script>`
    : ""
}
<script>
(function(){
var C=JSON.parse(atob("${configB64}"));
var props=C.properties;
var uuidByIndex=C.propertyUuidByIndex||[];
var frame=document.getElementById("matterport-frame");
var tabsEl=document.getElementById("tabs");
var current=0;

function escapeText(s){
  return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function formatFieldValue(v){
  if(v==null) return "\u2014";
  if(typeof v==="object") return JSON.stringify(v);
  return String(v);
}
function renderPropertyDocs(i){
  var container=document.getElementById("property-docs");
  if(!container) return;
  var body=document.getElementById("pd-body");
  var data=window.__PROPERTY_EXTRACTIONS__||{};
  var uuid=uuidByIndex[i];
  var entries=uuid?(data[uuid]||[]):[];
  if(!entries.length){
    container.style.display="none";
    body.innerHTML="";
    return;
  }
  container.style.display="flex";
  var parts=[];
  for(var e=0;e<entries.length;e++){
    var entry=entries[e];
    var fields=entry.fields||{};
    var keys=Object.keys(fields);
    var rows=keys.length
      ? keys.map(function(k){
          return "<dt>"+escapeText(k)+"</dt><dd>"+escapeText(formatFieldValue(fields[k]))+"</dd>";
        }).join("")
      : "";
    parts.push(
      '<div class="pd-extraction">'+
        '<div class="pd-tpl">'+escapeText(entry.template_label)+'</div>'+
        (rows?'<dl>'+rows+'</dl>':'<div class="pd-empty">No fields extracted.</div>')+
      '</div>'
    );
  }
  body.innerHTML=parts.join("");
}

// ── Docs Q&A (Phase 5): three-tier answer pipeline, fully local.
//    Tier 1 — cosine over pre-embedded canonical Q&As derived from
//      structured fields. Deterministic, high-precision.
//    Tier 2 — Orama hybrid (BM25 + vector) search over chunks. Uses
//      per-chunk embeddings baked into the tour HTML.
//    Tier 3 — BM25-only fallback for extraction rows that predate
//      Phase 5 and therefore lack embeddings.
//    All embedding / search happens client-side; no LLM at view time.
var __docsQa={
  initPromise:null,
  oramaModule:null,
  embedPipeline:null,
  MODE_HYBRID:null,
  db:null,
  mode:null,            // "hybrid" | "bm25"
  canonicalQAs:[],      // [{id, field, question, answer, source_anchor_id, embedding}]
  currentIndexKey:null,
  input:null,
  send:null,
  messages:null
};

// Tier 1 confidence threshold. Calibrated for MiniLM L2-normalized
// cosine: 0.72 catches phrasings close to the canonical forms without
// bleeding into unrelated questions. Tier 2 uses Orama's native scoring
// with no extra gate — the existence of any hit is enough, mirroring
// the Phase 3 baseline so we never regress on recall.
var __DQA_TIER1_THRESHOLD=0.72;

function __dqaAppendMsg(text,role,source){
  if(!__docsQa.messages) return;
  var div=document.createElement("div");
  div.className="dqa-msg "+role;
  div.textContent=text;
  if(source){
    var tag=document.createElement("div");
    tag.className="dqa-src";
    tag.textContent="from: "+source;
    div.appendChild(tag);
  }
  __docsQa.messages.appendChild(div);
  __docsQa.messages.scrollTop=__docsQa.messages.scrollHeight;
}
// Dot product on L2-normalized vectors is identical to cosine similarity
// but skips the square-root + two accumulator passes. Both query and
// canonical_qa embeddings are produced with normalize:true, so this is
// a straight simplification — the 0.72 tier-1 threshold keeps the same
// semantic meaning.
function __dqaDot(a,b){
  if(!a||!b||a.length!==b.length) return -1;
  var dot=0;
  for(var i=0;i<a.length;i++){dot+=a[i]*b[i];}
  return dot;
}
function __dqaActiveEntries(i){
  var data=window.__PROPERTY_EXTRACTIONS__||{};
  var uuid=uuidByIndex[i];
  return uuid?(data[uuid]||[]):[];
}
function __dqaCollectCanonicalQAs(entries){
  var out=[];
  for(var e=0;e<entries.length;e++){
    var qas=entries[e].canonical_qas||[];
    for(var q=0;q<qas.length;q++){
      var it=qas[q];
      if(!it||!Array.isArray(it.embedding)||it.embedding.length===0) continue;
      out.push(it);
    }
  }
  return out;
}
function __dqaCollectChunkDocs(entries){
  // Returns {docs, hasEmbeddings}. docs are Orama-ready objects; the
  // flag tells the caller which schema to build.
  var docs=[];
  var withEmb=0,total=0;
  for(var e=0;e<entries.length;e++){
    var entry=entries[e];
    var label=entry.template_label||"Document";
    var chunks=entry.chunks||[];
    for(var c=0;c<chunks.length;c++){
      total++;
      var ch=chunks[c];
      var hasEmb=Array.isArray(ch.embedding)&&ch.embedding.length>0;
      if(hasEmb) withEmb++;
      docs.push({
        id:label+"#chunk#"+(ch.id||c),
        source:label+" \u2192 "+(ch.section||"section"),
        content:String(ch.content||""),
        embedding:hasEmb?ch.embedding:null
      });
    }
    // Fields are also indexed for BM25 fallback; they never carry
    // embeddings (tier 1 covers these via canonical_qas).
    var fields=entry.fields||{};
    var fkeys=Object.keys(fields);
    for(var k=0;k<fkeys.length;k++){
      var val=fields[fkeys[k]];
      if(val==null) continue;
      var text=(typeof val==="object")?JSON.stringify(val):String(val);
      docs.push({
        id:label+"#field#"+fkeys[k],
        source:label+" \u2192 "+fkeys[k],
        content:fkeys[k]+": "+text,
        embedding:null
      });
    }
  }
  return {docs:docs,hasEmbeddings:total>0&&withEmb===total};
}
async function __dqaRebuildIndex(i){
  if(!__docsQa.initPromise) return;
  await __docsQa.initPromise;
  var key=String(i);
  if(__docsQa.currentIndexKey===key) return;
  var om=__docsQa.oramaModule;
  if(!om) return;
  var entries=__dqaActiveEntries(i);
  __docsQa.canonicalQAs=__dqaCollectCanonicalQAs(entries);
  var collected=__dqaCollectChunkDocs(entries);
  var useHybrid=collected.hasEmbeddings&&!!__docsQa.embedPipeline;
  __docsQa.mode=useHybrid?"hybrid":"bm25";
  var schema=useHybrid
    ? {id:"string",source:"string",content:"string",embedding:"vector[384]"}
    : {id:"string",source:"string",content:"string"};
  __docsQa.db=await om.create({
    schema:schema,
    components:{tokenizer:{language:"english",stemming:true}}
  });
  for(var d=0;d<collected.docs.length;d++){
    var doc=collected.docs[d];
    if(useHybrid){
      // Chunks lacking a vector cannot be inserted into a vector schema.
      // Synthesize a zero vector so they stay in the BM25 lane.
      var emb=doc.embedding||new Array(384).fill(0);
      await om.insert(__docsQa.db,{
        id:doc.id,source:doc.source,content:doc.content,embedding:emb
      });
    }else{
      await om.insert(__docsQa.db,{
        id:doc.id,source:doc.source,content:doc.content
      });
    }
  }
  __docsQa.currentIndexKey=key;
}
async function __dqaEmbedQuery(q){
  if(!__docsQa.embedPipeline) return null;
  try{
    var out=await __docsQa.embedPipeline(q,{pooling:"mean",normalize:true});
    return Array.from(out.data);
  }catch(err){
    console.warn("docs-qa query embed failed:",err);
    return null;
  }
}
function __dqaTier1(queryVec){
  if(!queryVec||!__docsQa.canonicalQAs.length) return null;
  var best=null,bestScore=-1;
  for(var i=0;i<__docsQa.canonicalQAs.length;i++){
    var qa=__docsQa.canonicalQAs[i];
    var s=__dqaDot(queryVec,qa.embedding);
    if(s>bestScore){bestScore=s;best=qa;}
  }
  if(best&&bestScore>=__DQA_TIER1_THRESHOLD){
    return {answer:best.answer,source:best.source_anchor_id||best.field,score:bestScore};
  }
  return null;
}
async function __dqaInit(){
  if(__docsQa.initPromise) return __docsQa.initPromise;
  __docsQa.input=document.getElementById("docs-qa-input");
  __docsQa.send=document.getElementById("docs-qa-send");
  __docsQa.messages=document.getElementById("docs-qa-messages");
  if(!__docsQa.input||!__docsQa.send) return;
  __docsQa.initPromise=(async function(){
    // Load Orama first (tiny), then transformers.js (heavy, WASM + ONNX
    // weights). Transformers is cached across the Q&A surface by URL so
    // a second import() here is instant after the first.
    var oramaModule=await import("https://cdn.jsdelivr.net/npm/@orama/orama@3.0.0/+esm");
    __docsQa.oramaModule=oramaModule;
    __docsQa.MODE_HYBRID=oramaModule.MODE_HYBRID_SEARCH;
    try{
      var tf=await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.1.0");
      tf.env.allowLocalModels=false;
      // WebGPU-first with WASM fallback; q8 in both paths to keep
      // cold-load bandwidth down relative to v4's fp32 default.
      var pipe=null;
      try{
        if(typeof navigator!=="undefined"&&navigator.gpu){
          pipe=await tf.pipeline("feature-extraction","Xenova/all-MiniLM-L6-v2",{device:"webgpu",dtype:"q8"});
        }
      }catch(gpuErr){
        console.warn("[transformers] webgpu init failed, falling back to wasm:",gpuErr);
        pipe=null;
      }
      if(!pipe){
        pipe=await tf.pipeline("feature-extraction","Xenova/all-MiniLM-L6-v2",{dtype:"q8"});
      }
      __docsQa.embedPipeline=pipe;
    }catch(err){
      // Network or WASM failure — graceful degradation to BM25-only.
      console.warn("docs-qa transformers load failed, falling back to BM25:",err);
      __docsQa.embedPipeline=null;
    }
  })();
  await __docsQa.initPromise;
  await __dqaRebuildIndex(current);
  __docsQa.input.placeholder="Ask about this property's docs\u2026";
  __docsQa.input.disabled=false;
  __docsQa.send.disabled=false;
  async function handleAsk(){
    var q=(__docsQa.input.value||"").trim();
    if(!q||!__docsQa.db) return;
    __docsQa.input.value="";
    __dqaAppendMsg(q,"user",null);
    __docsQa.input.disabled=true;
    __docsQa.send.disabled=true;
    try{
      // Embed the query once; tiers 1 + 2 share the vector.
      var queryVec=await __dqaEmbedQuery(q);

      // Tier 1 — canonical-QA cosine (deterministic, templated).
      var tier1=__dqaTier1(queryVec);
      if(tier1){
        __dqaAppendMsg(tier1.answer,"assistant",tier1.source);
      }else{
        // Tier 2 (hybrid) or Tier 3 (BM25) via Orama.
        var searchArgs;
        if(__docsQa.mode==="hybrid"&&queryVec){
          searchArgs={
            mode:__docsQa.MODE_HYBRID,
            term:q,
            vector:{value:queryVec,property:"embedding"},
            properties:["content"],
            limit:1,
            similarity:0
          };
        }else{
          searchArgs={term:q,properties:["content"],limit:1};
        }
        var res=await __docsQa.oramaModule.search(__docsQa.db,searchArgs);
        var hits=(res&&res.hits)||[];
        if(hits.length>0){
          var hit=hits[0].document;
          __dqaAppendMsg(String(hit.content||""),"assistant",String(hit.source||""));
        }else{
          __dqaAppendMsg("I couldn't find that in the docs for this property. Try rephrasing or switch to another property.","assistant",null);
        }
      }
    }catch(err){
      console.error("docs-qa search failed:",err);
      __dqaAppendMsg("Search failed. Please try again.","assistant",null);
    }
    __docsQa.input.disabled=false;
    __docsQa.send.disabled=false;
    __docsQa.input.focus();
  }
  __docsQa.send.addEventListener("click",handleAsk);
  __docsQa.input.addEventListener("keydown",function(e){if(e.key==="Enter") handleAsk();});
}
window.__openDocsQa=function(){
  var panel=document.getElementById("docs-qa-panel");
  if(!panel) return;
  panel.classList.add("open");
  __dqaInit();
};

function load(i){
  current=i;
  frame.src=props[i].iframeUrl;
  var tabs=tabsEl.querySelectorAll(".tab");
  tabs.forEach(function(t,j){t.classList.toggle("active",j===i)});
  renderPropertyDocs(i);
  // Reset Docs Q&A state so next open re-indexes for this property.
  __docsQa.currentIndexKey=null;
  if(__docsQa.messages){
    __docsQa.messages.innerHTML='<div class="dqa-msg assistant">Switched to '+escapeText(props[i].name||"property")+'. Ask me something.</div>';
  }
  if(__docsQa.initPromise){ __dqaRebuildIndex(i); }
}
props.forEach(function(p,i){
  var btn=document.createElement("button");
  btn.className="tab"+(i===0?" active":"");
  btn.textContent=p.name;
  btn.onclick=function(){load(i)};
  tabsEl.appendChild(btn);
});
if(props.length>0) load(0);

// Pre-warm the docs-qa pipeline after the Matterport iframe has finished
// its initial load. Gated on the panel actually existing so tours with
// no extractions skip the ~23 MB model download. requestIdleCallback
// keeps the work off the critical path; a short setTimeout covers
// browsers (Safari) that haven't shipped it yet.
function __dqaPrewarm(){
  if(!document.getElementById("docs-qa-panel")) return;
  __dqaInit().catch(function(err){console.warn("docs-qa prewarm failed:",err);});
}
if(frame){
  frame.addEventListener("load",function(){
    if(typeof window.requestIdleCallback==="function"){
      window.requestIdleCallback(__dqaPrewarm,{timeout:5000});
    }else{
      setTimeout(__dqaPrewarm,2000);
    }
  },{once:true});
}
})();
</script>
${qaModuleScript}
</body>
</html>`;

    return { success: true, html };
  });

// ============================================================================
// Account deletion (server function — uses admin client to fully remove user)
// ============================================================================
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const deleteOwnAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Best-effort cleanup of provider-owned rows that don't have FK cascades to auth.users.
    // Failures here should not block account deletion — the auth.admin.deleteUser
    // call is the authoritative removal step.
    try {
      await supabaseAdmin.from("branding_settings").delete().eq("provider_id", userId);
    } catch (e) {
      console.warn("branding cleanup failed:", e);
    }
    try {
      await supabaseAdmin.from("licenses").delete().eq("user_id", userId);
    } catch (e) {
      console.warn("license cleanup failed:", e);
    }
    try {
      await supabaseAdmin
        .from("client_providers")
        .delete()
        .or(`client_id.eq.${userId},provider_id.eq.${userId}`);
    } catch (e) {
      console.warn("client_providers cleanup failed:", e);
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      console.error("Failed to delete user:", error);
      throw new Error(error.message);
    }
    return { success: true };
  });

// ============================================================================
// Free/Pay client attribute management
// ============================================================================

/**
 * Update the `is_free` attribute on an invitation. If the invitation has
 * already been accepted (i.e. there's a matching client_providers link
 * for this provider + the email's owning user), propagate the flag onto
 * that link too so the checkout fulfilment path sees it.
 */
export const setClientFreeFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { invitationId: string; isFree: boolean }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1) Update invitation row (RLS confirms the caller owns it).
    const { data: invRow, error: invErr } = await supabase
      .from("invitations")
      .update({ is_free: data.isFree })
      .eq("id", data.invitationId)
      .eq("provider_id", userId)
      .select("email, status")
      .maybeSingle();

    if (invErr || !invRow) {
      throw new Error(invErr?.message || "Invitation not found");
    }

    // 2) If accepted, propagate to the client_providers link by looking
    //    up the auth user that owns that email (admin lookup — bypasses RLS).
    if (invRow.status === "accepted" && invRow.email) {
      try {
        const { data: usersList } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 200,
        });
        const match = usersList?.users?.find(
          (u) => u.email?.toLowerCase() === invRow.email.toLowerCase()
        );
        if (match) {
          await supabaseAdmin
            .from("client_providers")
            .update({ is_free: data.isFree })
            .eq("provider_id", userId)
            .eq("client_id", match.id);
        }
      } catch (e) {
        console.warn("client_providers free-flag propagation failed:", e);
      }
    }

    return { success: true };
  });

/**
 * Returns whether the currently logged-in client has the `is_free`
 * attribute set against the given provider. Used by the builder to
 * swap the Purchase button label.
 */
export const getClientFreeStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { providerId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows } = await supabase.rpc("resolve_studio_access", {
      _provider_id: data.providerId,
    });
    const row = Array.isArray(rows) ? rows[0] : null;
    return { isFree: row?.is_free === true };
  });

/**
 * Authoritative entitlement resolver for the Studio. Returns one payload
 * combining link status, invitation state, free/paid eligibility, and
 * MSP pricing/payout readiness. Auto-heals stale links from accepted
 * invitations on the server.
 */
export interface StudioAccessState {
  linked: boolean;
  invitationStatus: "pending" | "accepted" | "expired" | "declined" | null;
  isFree: boolean;
  pricingConfigured: boolean;
  payoutsReady: boolean;
  providerBrandName: string;
  viewerRole: "client" | "provider" | "admin" | "unknown";
  viewerMatchesProvider: boolean;
}

export const getStudioAccessState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { providerId: string }) => d)
  .handler(async ({ data, context }): Promise<StudioAccessState> => {
    const { supabase } = context;
    const { data: rows, error } = await supabase.rpc("resolve_studio_access", {
      _provider_id: data.providerId,
    });
    if (error) {
      console.error("getStudioAccessState rpc failed:", error);
      // Surface the failure to the caller instead of returning a fake "all-false"
      // payload that the UI would mistake for "pricing unavailable".
      throw new Error(
        `Failed to resolve Studio access: ${error.message ?? "unknown error"}`,
      );
    }
    const row = Array.isArray(rows) ? rows[0] : null;
    const rawRole = String(row?.viewer_role ?? "unknown");
    const viewerRole: StudioAccessState["viewerRole"] =
      rawRole === "client" || rawRole === "provider" || rawRole === "admin"
        ? rawRole
        : "unknown";
    return {
      linked: row?.linked === true,
      invitationStatus:
        (row?.invitation_status as StudioAccessState["invitationStatus"]) ?? null,
      isFree: row?.is_free === true,
      pricingConfigured: row?.pricing_configured === true,
      payoutsReady: row?.payouts_ready === true,
      providerBrandName: String(row?.provider_brand_name ?? ""),
      viewerRole,
      viewerMatchesProvider: row?.viewer_matches_provider === true,
    };
  });

// ============================================================================
// Public invitation acceptance (token-based) — used by /invite/$token route
// ============================================================================

interface InvitationDetails {
  email: string;
  status: "pending" | "accepted" | "expired" | "declined";
  isFree: boolean;
  expiresAt: string;
  providerId: string;
  brand: {
    brandName: string;
    accentColor: string;
    hudBgColor: string;
    logoUrl: string | null;
    faviconUrl: string | null;
    slug: string | null;
  } | null;
}

const INVITATION_TOKEN_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Public lookup of invitation by token. No auth required — the token
 * itself is the bearer credential. Returns the safe subset plus the
 * inviting MSP's branding so the acceptance page can match their look.
 */
export const getInvitationByToken = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data }): Promise<{
    found: boolean;
    invitation?: InvitationDetails;
    error?: string;
  }> => {
    if (!data.token || !INVITATION_TOKEN_RE.test(data.token)) {
      return { found: false, error: "Invalid invitation token format" };
    }

    const { data: rows, error } = await supabaseAdmin.rpc(
      "get_invitation_by_token",
      { _token: data.token },
    );
    if (error) {
      console.error("get_invitation_by_token failed:", error);
      return { found: false, error: "Failed to look up invitation" };
    }
    const inv = Array.isArray(rows) ? rows[0] : null;
    if (!inv) return { found: false };

    const { data: brand } = await supabaseAdmin
      .from("branding_settings")
      .select("brand_name, accent_color, hud_bg_color, logo_url, favicon_url, slug")
      .eq("provider_id", inv.provider_id)
      .maybeSingle();

    return {
      found: true,
      invitation: {
        email: inv.email,
        status: inv.status,
        isFree: inv.is_free,
        expiresAt: inv.expires_at,
        providerId: inv.provider_id,
        brand: brand
          ? {
              brandName: brand.brand_name || "",
              accentColor: brand.accent_color || "#3B82F6",
              hudBgColor: brand.hud_bg_color || "#1a1a2e",
              logoUrl: brand.logo_url,
              faviconUrl: brand.favicon_url,
              slug: brand.slug,
            }
          : null,
      },
    };
  });

/**
 * Accept invitation as the currently logged-in user. Returns providerSlug
 * for redirect to /p/{slug}.
 */
export const acceptInvitationForUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase.rpc("accept_invitation_self", {
      _token: data.token,
    });
    if (error) {
      throw new Error(error.message || "Failed to accept invitation");
    }
    const providerId = Array.isArray(rows) ? rows[0]?.provider_id : null;
    let slug: string | null = null;
    if (providerId) {
      const { data: brand } = await supabaseAdmin
        .from("branding_settings")
        .select("slug")
        .eq("provider_id", providerId)
        .maybeSingle();
      slug = brand?.slug ?? null;
    }
    return { success: true, providerId, slug };
  });

/**
 * Decline invitation. Public — invitee may not have an account.
 */
export const declineInvitationByToken = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    if (!data.token || !INVITATION_TOKEN_RE.test(data.token)) {
      throw new Error("Invalid invitation token");
    }
    const { data: ok, error } = await supabaseAdmin.rpc("decline_invitation", {
      _token: data.token,
    });
    if (error) {
      console.error("decline_invitation failed:", error);
      throw new Error("Failed to decline invitation");
    }
    return { success: ok === true };
  });

