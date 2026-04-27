import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assembleAskRuntimeJS } from "./portal/ask-runtime-assembler";

// Assembled Ask AI runtime JS — built once per process from the three
// .mjs modules (intents, property-brain, logic). Injected verbatim into
// the outer IIFE of the generated presentation, where all symbols
// become locals. See src/lib/portal/ask-runtime-assembler.ts.
const ASK_RUNTIME_JS = assembleAskRuntimeJS();

interface SavePresentationMediaAsset {
  id: string;
  kind: "video" | "photo" | "gif";
  visible: boolean;
  label?: string;
  filename?: string;
  proxyUrl?: string;
  embedUrl?: string;
}

interface SavePresentationInput {
  providerId: string;
  name: string;
  properties: Array<{
    id: string;
    name: string;
    propertyName?: string;
    location: string;
    matterportId: string;
    musicUrl: string;
    cinematicVideoUrl?: string;
    enableNeighborhoodMap?: boolean;
    multimedia?: SavePresentationMediaAsset[];
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
  /**
   * Per-property Vault asset selections from the Enhancements panel.
   * Persisted as `tour_config.enhancements`. Today only `spatial_audio`
   * affects the generated tour (overrides per-property musicUrl); the rest
   * are stored for forward compatibility.
   */
  enhancements?: Record<
    string,
    {
      spatial_audio?: string | null;
      visual_hud_filter?: string[];
      interactive_widget?: string[];
      custom_iconography?: string[];
      external_link?: string[];
    }
  >;
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
          // Per-property Vault asset selections (Enhancements panel).
          // Forward-compatible: keys for future categories ride along
          // even though only `spatial_audio` affects the runtime today.
          enhancements: data.enhancements ?? {},
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

interface PropertyMediaAsset {
  id: string;
  kind: "video" | "photo" | "gif";
  visible: boolean;
  label?: string;
  proxyUrl?: string;
  embedUrl?: string;
}

interface PropertyData {
  id: string;
  name: string;
  propertyName?: string;
  location: string;
  matterportId: string;
  musicUrl: string;
  cinematicVideoUrl?: string;
  enableNeighborhoodMap?: boolean;
  multimedia?: PropertyMediaAsset[];
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
  /** Per-property Vault asset selections (see SavePresentationInput). */
  enhancements?: Record<
    string,
    {
      spatial_audio?: string | null;
      visual_hud_filter?: string[];
      interactive_widget?: string[];
      custom_iconography?: string[];
      external_link?: string[];
    }
  >;
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
        "template_id, property_uuid, fields, chunks, canonical_qas, candidate_fields, field_provenance, extracted_at",
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
              visibility?: unknown;
            } =>
              !!c &&
              typeof c === "object" &&
              typeof (c as { content?: unknown }).content === "string",
          )
          // Phase A — drop private chunks at the injection boundary.
          // Default visibility is `public`, so legacy rows persisted
          // before metadata was introduced ride along unchanged.
          .filter((c) => {
            const v = (c as { visibility?: unknown }).visibility;
            return v !== "private";
          })
          .map((c) => ({
            id: String(c.id ?? ""),
            section: String(c.section ?? ""),
            content: String(c.content ?? ""),
            embedding: normalizeEmbedding(c.embedding),
            kind:
              (c as { kind?: unknown }).kind === "raw_chunk" ||
              (c as { kind?: unknown }).kind === "field_chunk"
                ? ((c as unknown as { kind: "raw_chunk" | "field_chunk" }).kind)
                : undefined,
            source:
              typeof (c as { source?: unknown }).source === "string"
                ? String((c as unknown as { source: string }).source)
                : undefined,
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
        candidate_fields: Array.isArray((row as { candidate_fields?: unknown }).candidate_fields)
          ? ((row as { candidate_fields: unknown[] }).candidate_fields as Array<Record<string, unknown>>)
          : [],
        field_provenance: Array.isArray((row as { field_provenance?: unknown }).field_provenance)
          ? ((row as { field_provenance: unknown[] }).field_provenance as Array<Record<string, unknown>>)
          : [],
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
    kind?: "raw_chunk" | "field_chunk";
    source?: string;
  }>;
  canonical_qas: Array<{
    id: string;
    field: string;
    question: string;
    answer: string;
    source_anchor_id: string;
    embedding: number[] | null;
  }>;
  candidate_fields: Array<Record<string, unknown>>;
  field_provenance: Array<Record<string, unknown>>;
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
 * Unified "Ask" panel — single chat surface that fans out across both
 * the host-curated qaDatabase (anchor-link answers) and per-property doc
 * extractions (canonical QAs + chunks). Emits CSS, the DOM shell, the
 * toggle button, and the runtime module script. The runtime initialises
 * lazily on first open and re-indexes per-property docs on tab change
 * via the `load(i)` hook in the main IIFE. Empty when neither knowledge
 * source is available.
 */
function buildAskAssets(
  extractionsByProperty: ExtractionsByProperty,
  hudBgColor: string,
  accentColor: string,
  hasQA: boolean,
): { css: string; toggleBtn: string; panelHtml: string; moduleScript: string; enabled: boolean } {
  const anyDocs = Object.values(extractionsByProperty).some((arr) =>
    arr.some(
      (e) =>
        (e.chunks && e.chunks.length > 0) ||
        Object.keys(e.fields ?? {}).length > 0,
    ),
  );
  const docsEnabled = anyDocs;
  const enabled = hasQA || docsEnabled;
  if (!enabled) {
    return { css: "", toggleBtn: "", panelHtml: "", moduleScript: "", enabled: false };
  }

  const css = `
#ask-toggle{padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;background:${escapeHtml(accentColor)};border:none;color:#fff;display:inline-flex;align-items:center;gap:5px;flex-shrink:0}
#ask-toggle svg{width:14px;height:14px}
#ask-panel{display:none;position:fixed;top:72px;right:16px;width:380px;max-width:calc(100vw - 32px);height:480px;max-height:calc(100vh - 96px);background:${escapeHtml(hudBgColor)};border:1px solid #333;border-radius:12px;z-index:1500;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.5);overflow:hidden}
#ask-panel.open{display:flex}
#ask-header{padding:12px 16px;border-bottom:1px solid #333;display:flex;align-items:center;justify-content:space-between}
#ask-header h4{font-size:14px;font-weight:600;color:#fff;margin:0}
#ask-close{background:none;border:none;color:#999;font-size:18px;cursor:pointer;padding:0 4px}
#ask-messages{flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px}
.ask-msg{max-width:88%;padding:8px 12px;border-radius:10px;font-size:13px;line-height:1.5;word-wrap:break-word;white-space:pre-wrap}
.ask-msg.user{align-self:flex-end;background:${escapeHtml(accentColor)};color:#fff;border-bottom-right-radius:4px}
.ask-msg.assistant{align-self:flex-start;background:#2a2a3e;color:#ddd;border-bottom-left-radius:4px}
.ask-msg.loading{color:#999;font-style:italic}
.ask-msg .source-link{display:inline-block;margin-top:6px;padding:2px 8px;font-size:11px;background:${escapeHtml(accentColor)}33;color:${escapeHtml(accentColor)};border-radius:4px;cursor:pointer;border:1px solid ${escapeHtml(accentColor)}55;text-decoration:none}
.ask-msg .source-link:hover{background:${escapeHtml(accentColor)}55}
.ask-src{display:inline-block;margin-top:6px;padding:2px 8px;font-size:11px;color:#aaa;font-style:italic}
#ask-input-row{padding:10px 12px;border-top:1px solid #333;display:flex;gap:8px;align-items:center}
#ask-input{flex:1;background:#1e1e30;border:1px solid #444;border-radius:8px;padding:8px 12px;color:#fff;font-size:13px;outline:none}
#ask-input:focus{border-color:${escapeHtml(accentColor)}}
#ask-input:disabled{opacity:0.5;cursor:not-allowed}
#ask-send{background:${escapeHtml(accentColor)};border:none;color:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:13px;font-weight:600}
#ask-send:disabled{opacity:0.4;cursor:not-allowed}
@keyframes ask-pulse{0%,100%{opacity:0.4}50%{opacity:1}}
.ask-loading-dots span{animation:ask-pulse 1.4s infinite;animation-delay:calc(var(--i)*0.2s)}
/* Lead-capture downgrade form (rendered when Gemini subsidy is exhausted) */
.ask-inquiry-card{display:flex;flex-direction:column;gap:8px;background:#22223a;border:1px solid #444;padding:10px 12px;border-radius:10px;max-width:96%}
.ask-inquiry-head strong{color:#fff;font-size:13px}
.ask-inquiry-sub{color:#aaa;font-size:11px;margin-top:2px}
.ask-inquiry-fields{display:flex;flex-direction:column;gap:6px}
.ask-inquiry-input{background:#1e1e30;border:1px solid #444;border-radius:6px;padding:6px 10px;color:#fff;font-size:12px;outline:none}
.ask-inquiry-input:focus{border-color:${escapeHtml(accentColor)}}
.ask-inquiry-input:disabled{opacity:0.5}
.ask-inquiry-textarea{resize:vertical;min-height:60px;font-family:inherit}
.ask-inquiry-actions{display:flex;gap:8px;align-items:center}
.ask-inquiry-send{background:${escapeHtml(accentColor)};border:none;color:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600}
.ask-inquiry-send:disabled{opacity:0.5;cursor:not-allowed}
.ask-inquiry-sms{color:#bbb;text-decoration:underline;font-size:12px}
.ask-inquiry-status{font-size:11px;color:#888;margin-top:2px}
`;

  const toggleBtn = `<button id="ask-toggle" onclick="window.__openAsk&&window.__openAsk()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>Ask</button>`;

  const panelHtml = `
<div id="ask-panel">
  <div id="ask-header"><h4>Ask about this property</h4><button id="ask-close" onclick="document.getElementById('ask-panel').classList.remove('open')">&times;</button></div>
  <div id="ask-messages"><div class="ask-msg assistant" id="ask-welcome">Hi! Ask me anything about this property.</div></div>
  <div id="ask-input-row"><input id="ask-input" type="text" placeholder="Initializing AI Assistant..." disabled /><button id="ask-send" disabled>Send</button></div>
</div>`;

  // Flags consumed by the unified runtime in the main IIFE. The qaDatabase
  // payload itself is injected separately by the caller (so we don't have
  // to thread it through this builder's signature).
  const moduleScript = `<script>window.__ASK_HAS_QA__=${hasQA ? "true" : "false"};window.__ASK_HAS_DOCS__=${docsEnabled ? "true" : "false"};</script>`;

  return { css, toggleBtn, panelHtml, moduleScript, enabled: true };
}

/** Renders a per-property-extraction block as trusted HTML. All dynamic
 *  values are escaped. Returned string is safe to interpolate into the
 *  <body>. Empty string when there are no extractions for any property. */
function buildPropertyDocsPanel(
  _extractionsByProperty: ExtractionsByProperty,
  _hudBgColor: string,
  _accentColor: string,
): string {
  // Overlay removed by design. Extraction data still flows to Ask AI via
  // window.__PROPERTY_EXTRACTIONS__; this surface is no longer rendered.
  return "";
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
    const enhancements = tourConfig.enhancements ?? {};

    const brandName = overrides.brandName || brandingData?.brand_name || "Property Tours";
    const accentColor = overrides.accentColor || brandingData?.accent_color || "#3B82F6";
    const hudBgColor = overrides.hudBgColor || brandingData?.hud_bg_color || "#1a1a2e";
    const gateLabel = overrides.gateLabel || brandingData?.gate_label || "Enter";
    const isPro = brandingData?.tier === "pro";
    // Prefer client-uploaded brand assets (in overrides) over the MSP defaults.
    // Empty/missing overrides cleanly fall back to no logo/favicon — we do NOT
    // bake in the MSP's brand assets behind the client's back.
    const logoUrl = overrides.logoUrl || "";
    const faviconUrl = overrides.faviconUrl || "";

    // Resolve any per-property spatial_audio vault asset selections to their
    // public asset_url. Failure to load the catalog must NOT block the build —
    // we silently fall back to the manual musicUrl on each property.
    const audioAssetIds = Array.from(
      new Set(
        Object.values(enhancements)
          .map((e) => e?.spatial_audio)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    );
    const audioUrlById = new Map<string, string>();
    if (audioAssetIds.length > 0) {
      const { data: audioRows } = await supabase
        .from("vault_assets")
        .select("id, asset_url, is_active, category_type")
        .in("id", audioAssetIds);
      for (const row of audioRows ?? []) {
        if (row.is_active && row.category_type === "spatial_audio" && row.asset_url) {
          audioUrlById.set(row.id, row.asset_url);
        }
      }
    }

    // Build iframe URLs for each property
    const propertyEntries = properties
      .filter((p) => p.matterportId?.trim())
      .map((p) => {
        const behavior = behaviors[p.id] || {};
        // Resolve canonical image URLs for media assets so they never expire
        const multimedia = (p.multimedia ?? [])
          .filter((m) => m.visible)
          .map((m) => {
            let proxyUrl = m.proxyUrl;
            if (
              proxyUrl &&
              !proxyUrl.includes("/resources/model/") &&
              p.matterportId &&
              /^[A-Za-z0-9]{11}$/.test(p.matterportId) &&
              /^[A-Za-z0-9]{11}$/.test(m.id)
            ) {
              proxyUrl = `https://my.matterport.com/resources/model/${p.matterportId}/image/${m.id}`;
            }
            return {
              id: m.id,
              kind: m.kind,
              label: m.label ?? "",
              proxyUrl: proxyUrl ?? "",
              embedUrl: m.embedUrl ?? "",
            };
          });

        // Sound Library override → falls back to manual musicUrl when unset
        // or when the asset is no longer active / readable.
        const enhAudioId = enhancements[p.id]?.spatial_audio;
        const overrideMusicUrl =
          enhAudioId && audioUrlById.has(enhAudioId) ? audioUrlById.get(enhAudioId)! : "";
        const resolvedMusicUrl = overrideMusicUrl || p.musicUrl || "";

        return {
          name: p.name || "Untitled",
          propertyName: p.propertyName || "",
          location: p.location || "",
          iframeUrl: buildMatterportUrlServer(p.matterportId, behavior),
          musicUrl: resolvedMusicUrl,
          cinematicVideoUrl: p.cinematicVideoUrl || "",
          enableNeighborhoodMap: !!(p.enableNeighborhoodMap && (p.location || "").trim()),
          multimedia,
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

    // Resolve the provider's studio_id so the runtime can call
    // handle-lead-capture as the primary lead path on quota
    // exhaustion. Public-grade identifier (already exposed in the
    // contact-form flow); never a secret.
    let studioId: string | null = null;
    try {
      const { data: licenseRow } = await supabase
        .from("licenses")
        .select("studio_id")
        .eq("user_id", model.provider_id)
        .maybeSingle();
      studioId = licenseRow?.studio_id ?? null;
    } catch (err) {
      console.warn(
        "[generatePresentation] studio_id lookup skipped:",
        err instanceof Error ? err.message : err,
      );
    }

    // Base64-encode config for obfuscation
    const gaTrackingId = typeof agent.gaTrackingId === "string" ? agent.gaTrackingId.trim() : "";
    const agentAvatarUrl = typeof agent.avatarUrl === "string" ? agent.avatarUrl.trim() : "";
    const configObj = {
      properties: propertyEntries,
      agent,
      brandName,
      accentColor,
      hudBgColor,
      gateLabel,
      logoUrl,
      propertyUuidByIndex,
      gaTrackingId,
      agentAvatarUrl,
      studioId,
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

    const askAssets = buildAskAssets(
      extractionsByProperty,
      hudBgColor,
      accentColor,
      hasQA,
    );

    const poweredByFooter = isPro
      ? ""
      : `<footer id="powered-by">Powered by Transcendence Media</footer>`;

    // Derive the Synthesis Bridge URL from the Supabase project URL.
    // VITE_SUPABASE_URL is inlined by Vite at build time for both client and
    // SSR bundles; SUPABASE_URL is the plain process.env fallback for local dev.
    const _supabaseOrigin = (
      process.env.VITE_SUPABASE_URL ??
      process.env.SUPABASE_URL ??
      ""
    ).replace(/\/$/, "");
    const synthesisUrl = _supabaseOrigin
      ? `${_supabaseOrigin}/functions/v1/synthesize-answer`
      : "";

    // Issue (rotate) a signed presentation token. The token value is
    // embedded in the exported HTML and replayed by synthesize-answer
    // verifier server-side. Only the token HASH is stored in the DB,
    // so a DB read alone cannot replay tokens. Issuance is best-effort:
    // if the env or table isn't ready (older deploys), we still build
    // the HTML but with an empty token, and synthesize-answer will
    // reject those requests with a 401 — no Ask AI fallback breaks.
    let presentationToken = "";
    try {
      const { ensurePresentationToken } = await import(
        "./presentation-token-server"
      );
      const issued = await ensurePresentationToken(model.id);
      presentationToken = issued.value;
    } catch (err) {
      console.warn(
        "[generatePresentation] token issuance skipped:",
        err instanceof Error ? err.message : err,
      );
    }

    // Build social links HTML for the contact panel
    const socialDefs: Array<{ key: string; label: string }> = [
      { key: "linkedin", label: "LinkedIn" },
      { key: "twitter", label: "X / Twitter" },
      { key: "instagram", label: "Instagram" },
      { key: "facebook", label: "Facebook" },
      { key: "tiktok", label: "TikTok" },
      { key: "website", label: "Website" },
      { key: "other", label: "Other" },
    ];
    const socialLinksHtml = socialDefs
      .filter((s) => agent[s.key as keyof typeof agent])
      .map((s) => {
        const url = String(agent[s.key as keyof typeof agent] || "");
        const href = url.startsWith("http") ? url : `https://${url}`;
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="social-pill">${escapeHtml(s.label)}</a>`;
      })
      .join("");

    const avatarHtml = agent.avatarUrl
      ? `<img src="${escapeHtml(String(agent.avatarUrl))}" alt="${escapeHtml(String(agent.name || "Agent"))}" class="agent-avatar-img">`
      : `<div class="agent-avatar-init">${escapeHtml((String(agent.name || "?")).charAt(0).toUpperCase())}</div>`;


    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${faviconUrl ? `<link rel="icon" href="${escapeHtml(faviconUrl)}">` : ""}
<title>${escapeHtml(model.name || "3D Presentation")}</title>
${gaTrackingId ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${escapeHtml(gaTrackingId)}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${escapeHtml(gaTrackingId)}');</script>` : ""}
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#000;color:#fff}

/* ── Welcome gate ─────────────────────────────────────────────────── */
#gate{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:3000;background:${escapeHtml(hudBgColor)}40;backdrop-filter:blur(8px) saturate(140%);-webkit-backdrop-filter:blur(8px) saturate(140%);transition:opacity 0.5s ease}
#gate.hidden{opacity:0;pointer-events:none}
#gate-inner{display:flex;flex-direction:column;align-items:center;text-align:center;padding:40px 32px;max-width:480px;width:90%;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.08);border-radius:18px;backdrop-filter:blur(10px) saturate(160%);-webkit-backdrop-filter:blur(10px) saturate(160%);box-shadow:0 12px 48px rgba(0,0,0,0.35)}
#gate-inner .gate-logo{max-height:72px;max-width:200px;object-fit:contain;margin-bottom:20px}
#gate-inner h1{font-size:clamp(22px,4vw,32px);font-weight:700;margin-bottom:8px;letter-spacing:-0.02em}
#gate-inner .gate-subtitle{color:rgba(255,255,255,0.65);font-size:14px;margin-bottom:32px;line-height:1.5}
.gate-actions{display:flex;flex-direction:column;gap:12px;width:100%}
.gate-btn-primary{padding:13px 28px;font-size:15px;font-weight:600;border:none;border-radius:10px;cursor:pointer;background:${escapeHtml(accentColor)};color:#fff;transition:opacity 0.2s,transform 0.15s;display:flex;align-items:center;justify-content:center;gap:8px}
.gate-btn-primary:hover{opacity:0.88;transform:translateY(-1px)}
.gate-btn-secondary{padding:11px 28px;font-size:14px;font-weight:500;border:1px solid rgba(255,255,255,0.25);border-radius:10px;cursor:pointer;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.8);transition:opacity 0.2s,background 0.2s}
.gate-btn-secondary:hover{background:rgba(255,255,255,0.14)}

/* ── Viewer (full-screen iframe) ──────────────────────────────────── */
#viewer{position:fixed;inset:0;bottom:0}
#viewer iframe{width:100%;height:100%;border:none}

/* ── HUD header (top glassmorphism overlay) ──────────────────────── */
#hud-header{position:fixed;top:0;left:0;right:0;z-index:500;transform:translateY(-100%);opacity:0;pointer-events:none;transition:transform 0.3s ease,opacity 0.3s ease}
#hud-header.visible{transform:translateY(0);opacity:1;pointer-events:auto}
#hud-inner{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:${escapeHtml(hudBgColor)}99;backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border-bottom:1px solid rgba(255,255,255,0.08);box-shadow:0 4px 24px rgba(0,0,0,0.15),inset 0 1px 0 rgba(255,255,255,0.06)}
#hud-left{display:flex;align-items:center;gap:10px;min-width:0}
#hud-logo{height:32px;object-fit:contain;flex-shrink:0}
#hud-text{min-width:0}
#hud-brand{font-size:13px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 3px rgba(0,0,0,0.4)}
#hud-prop-name{font-size:11px;font-weight:500;color:rgba(255,255,255,0.9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#hud-prop-loc{font-size:11px;color:rgba(255,255,255,0.65);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#hud-right{display:flex;align-items:center;gap:6px;flex-shrink:0;margin-right:32px}
.hud-icon-btn{width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.12);border:none;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background 0.2s;flex-shrink:0;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.hud-icon-btn:hover{background:rgba(255,255,255,0.22)}
.hud-icon-btn svg{width:14px;height:14px}
#hud-agent-name{font-size:12px;color:rgba(255,255,255,0.75);white-space:nowrap;display:none}
@media(min-width:520px){#hud-agent-name{display:block}}
.hud-contact-btn{padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;border:none;color:#fff;cursor:pointer;background:${escapeHtml(accentColor)};transition:opacity 0.2s}
.hud-contact-btn:hover{opacity:0.85}
#hud-mute-btn{display:none}
#hud-mute-btn.visible{display:flex}

/* ── HUD toggle chevron ───────────────────────────────────────────── */
#hud-toggle{position:fixed;top:8px;right:8px;z-index:501;width:24px;height:24px;border-radius:50%;background:rgba(255,255,255,0.18);border:none;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background 0.2s;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
#hud-toggle:hover{background:rgba(255,255,255,0.28)}
#hud-toggle svg{width:12px;height:12px}

/* ── Property tabs (top-left overlay) ────────────────────────────── */
#tabs{position:fixed;top:8px;left:8px;z-index:600;display:none;gap:4px;background:rgba(0,0,0,0.35);padding:4px 6px;border-radius:999px;border:1px solid rgba(255,255,255,0.08);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
#tabs.multi{display:flex}
.tab{padding:4px 12px;border-radius:999px;cursor:pointer;font-size:12px;font-weight:500;background:transparent;border:none;color:rgba(255,255,255,0.65);transition:background 0.2s,color 0.2s}
.tab.active{background:${escapeHtml(accentColor)};color:#fff}

/* (Bottom toolbar removed — Ask AI / Ask docs buttons now live in the HUD header to keep the Matterport logo unobstructed.) */

/* ── Agent contact panel (slide from right) ──────────────────────── */
#agent-drawer{position:fixed;top:0;right:0;width:min(300px,88vw);height:100%;z-index:2000;overflow-y:auto;transform:translateX(100%);transition:transform 0.3s ease;background:${escapeHtml(hudBgColor)}cc;backdrop-filter:blur(24px) saturate(180%);-webkit-backdrop-filter:blur(24px) saturate(180%);border-left:1px solid rgba(255,255,255,0.08);box-shadow:-8px 0 32px rgba(0,0,0,0.25)}
#agent-drawer.open{transform:translateX(0)}
#drawer-inner{padding:16px}
#drawer-close{position:absolute;top:10px;right:10px;width:24px;height:24px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;color:rgba(255,255,255,0.7);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s}
#drawer-close:hover{background:rgba(255,255,255,0.2)}
#drawer-title{font-size:13px;font-weight:600;color:#fff;margin-bottom:14px}
.drawer-agent-row{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.agent-avatar-img{width:48px;height:48px;border-radius:50%;object-fit:cover;border:1px solid rgba(255,255,255,0.18);flex-shrink:0}
.agent-avatar-init{width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#fff;flex-shrink:0;background:${escapeHtml(accentColor)};border:1px solid rgba(255,255,255,0.18)}
.drawer-agent-name{font-size:13px;font-weight:600;color:#fff}
.drawer-agent-role{font-size:11px;color:rgba(255,255,255,0.55);margin-top:2px}
.drawer-welcome{border-radius:8px;background:rgba(255,255,255,0.08);padding:10px 12px;margin-bottom:14px}
.drawer-welcome p{font-size:12px;color:rgba(255,255,255,0.85);line-height:1.55;white-space:pre-wrap}
.drawer-actions{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.drawer-action-link{display:flex;align-items:center;gap:8px;border-radius:8px;background:rgba(255,255,255,0.08);padding:9px 11px;font-size:12px;font-weight:500;color:#fff;text-decoration:none;transition:background 0.2s}
.drawer-action-link:hover{background:rgba(255,255,255,0.15)}
.drawer-action-link svg{width:14px;height:14px;color:rgba(255,255,255,0.6);flex-shrink:0}
.drawer-social-label{font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.4);margin-bottom:6px}
.drawer-social-pills{display:flex;flex-wrap:wrap;gap:6px}
.social-pill{display:inline-flex;align-items:center;border-radius:999px;background:rgba(255,255,255,0.1);padding:4px 10px;font-size:11px;font-weight:500;color:#fff;text-decoration:none;transition:background 0.2s}
.social-pill:hover{background:rgba(255,255,255,0.18)}

/* ── Shared modal backdrop ────────────────────────────────────────── */
.modal-backdrop{position:fixed;inset:0;z-index:2500;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.65);backdrop-filter:blur(14px) brightness(0.55);-webkit-backdrop-filter:blur(14px) brightness(0.55);padding:16px}
.modal-backdrop.open{display:flex}
.modal-box{position:relative;width:min(60vw,900px);background:rgba(18,18,32,0.92);border-radius:16px;overflow:hidden;box-shadow:0 25px 80px -15px rgba(0,0,0,0.75)}
@media(max-width:768px){.modal-box{width:94vw}}
.modal-top-bar{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.08)}
.modal-title{font-size:14px;font-weight:600;color:#fff}
.modal-close-btn{width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;color:rgba(255,255,255,0.7);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s}
.modal-close-btn:hover{background:rgba(255,255,255,0.2)}
.modal-body{padding:16px}

/* ── Carousel-specific ────────────────────────────────────────────── */
#carousel-media-stage{position:relative;aspect-ratio:16/9;width:100%;background:#000;border-radius:10px;overflow:hidden}
#carousel-media-stage img,#carousel-media-stage video,#carousel-media-stage iframe{width:100%;height:100%;object-fit:contain}
#carousel-counter{font-size:12px;color:rgba(255,255,255,0.7)}
.carousel-arrow{position:absolute;top:50%;transform:translateY(-50%);width:40px;height:40px;border-radius:50%;background:rgba(0,0,0,0.5);border:none;color:#fff;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:5;transition:background 0.2s;backdrop-filter:blur(8px)}
.carousel-arrow:hover{background:rgba(0,0,0,0.75)}
#carousel-prev{left:10px}
#carousel-next{right:10px}
.carousel-thumbs{display:flex;gap:6px;overflow-x:auto;padding:10px 0 2px;scrollbar-width:thin}
.carousel-thumb{width:72px;height:48px;border-radius:6px;overflow:hidden;border:2px solid transparent;cursor:pointer;flex-shrink:0;background:#222;transition:border-color 0.2s}
.carousel-thumb.active{border-color:#fff}
.carousel-thumb img{width:100%;height:100%;object-fit:cover}
.carousel-thumb-play{width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#333}

/* ── Powered-by footer ────────────────────────────────────────────── */
#powered-by{position:fixed;bottom:0;left:0;right:0;height:34px;display:flex;align-items:center;justify-content:center;font-size:11px;color:rgba(255,255,255,0.4);border-top:1px solid rgba(255,255,255,0.06);background:${escapeHtml(hudBgColor)}cc;z-index:499}
${isPro ? "" : `/* Viewer above powered-by footer */
#viewer{bottom:34px}`}

/* ── Panel z-index overrides ───────────────────────────────────── */
#ask-panel,#property-docs{z-index:1500}
/* Property-docs panel still anchored bottom-left; clear powered-by footer when present */
#property-docs{bottom:${isPro ? "16" : "50"}px}

${askAssets.css}
</style>
</head>
<body>

<!-- ── Welcome / sound gate ─────────────────────────────────────── -->
<div id="gate">
  <div id="gate-inner">
    ${logoUrl ? `<img class="gate-logo" src="${escapeHtml(logoUrl)}" alt="Logo">` : ""}
    <h1>${escapeHtml(brandName)}</h1>
    <div class="gate-subtitle">${escapeHtml(model.name || "")}</div>
    <div class="gate-actions">
      <button class="gate-btn-primary" id="gate-sound-btn">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
        Start with Sound
      </button>
      <button class="gate-btn-secondary" id="gate-silent-btn">${escapeHtml(gateLabel)} (No Sound)</button>
    </div>
  </div>
</div>

<!-- ── Matterport iframe ─────────────────────────────────────────── -->
<div id="viewer"><iframe id="matterport-frame" allowfullscreen allow="xr-spatial-tracking; fullscreen"></iframe></div>

<!-- ── HUD toggle button ─────────────────────────────────────────── -->
<button id="hud-toggle" aria-label="Toggle header">
  <svg id="hud-chevron-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:none"><polyline points="18 15 12 9 6 15"/></svg>
  <svg id="hud-chevron-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
</button>

<!-- ── HUD top header ─────────────────────────────────────────────── -->
<div id="hud-header">
  <div id="hud-inner">
    <div id="hud-left">
      ${logoUrl ? `<img id="hud-logo" src="${escapeHtml(logoUrl)}" alt="Logo">` : ""}
      <div id="hud-text">
        <div id="hud-brand">${escapeHtml(brandName)}</div>
        <div id="hud-prop-name"></div>
        <div id="hud-prop-loc"></div>
      </div>
    </div>
    <div id="hud-right">
      <button id="hud-mute-btn" class="hud-icon-btn" aria-label="Toggle sound" title="Toggle sound">
        <svg id="mute-icon-on" viewBox="0 0 24 24" fill="currentColor" style="display:none"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
        <svg id="mute-icon-off" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06A9.0 9.0 0 0 0 17.73 18l1.73 1.73L21 18.46 5.54 3 4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
      </button>
      <button id="hud-map-btn" class="hud-icon-btn" style="display:none" aria-label="Neighborhood map" title="Neighborhood Map" onclick="window.__openModal&&window.__openModal('map')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
      </button>
      <button id="hud-cinema-btn" class="hud-icon-btn" style="display:none" aria-label="Cinematic video" title="Watch Cinematic Video" onclick="window.__openModal&&window.__openModal('cinema')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 3l-4 4-4-4"/></svg>
      </button>
      <button id="hud-media-btn" class="hud-icon-btn" style="display:none" aria-label="Media gallery" title="View Media Gallery" onclick="window.__openModal&&window.__openModal('carousel',0)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
      </button>
      ${askAssets.toggleBtn}
      <span id="hud-agent-name"></span>
      ${(agent.phone || agent.email || agent.name) ? `<button class="hud-contact-btn" onclick="window.__openContact&&window.__openContact()">Contact</button>` : ""}
    </div>
  </div>
</div>

<!-- ── Property tabs (top-left, shown only when >1 property) ─────── -->
<div id="tabs"></div>

<!-- (Bottom toolbar removed: Ask AI / Ask docs are now in the HUD header to keep the Matterport logo unobstructed.) -->

<!-- ── Agent contact panel ───────────────────────────────────────── -->
${(agent.phone || agent.email || agent.name) ? `<div id="agent-drawer">
  <div id="drawer-inner">
    <button id="drawer-close" onclick="window.__closeContact&&window.__closeContact()" aria-label="Close">&times;</button>
    <div id="drawer-title">Get in Touch</div>
    <div class="drawer-agent-row">
      ${avatarHtml}
      <div>
        <div class="drawer-agent-name">${escapeHtml(String(agent.name || ""))}</div>
        ${agent.titleRole ? `<div class="drawer-agent-role">${escapeHtml(String(agent.titleRole))}</div>` : agent.name ? `<div class="drawer-agent-role">${escapeHtml(brandName)}</div>` : ""}
      </div>
    </div>
    ${agent.welcomeNote ? `<div class="drawer-welcome"><p>${escapeHtml(String(agent.welcomeNote))}</p></div>` : ""}
    <div class="drawer-actions">
      ${agent.phone ? `<a href="tel:${escapeHtml(String(agent.phone))}" class="drawer-action-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.61a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 16l.19.92z"/></svg>Call ${escapeHtml(String(agent.phone))}</a>` : ""}
      ${agent.phone ? `<a href="sms:${escapeHtml(String(agent.phone))}" class="drawer-action-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Text ${escapeHtml(String(agent.phone))}</a>` : ""}
      ${agent.email ? `<a href="mailto:${escapeHtml(String(agent.email))}" class="drawer-action-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>${escapeHtml(String(agent.email))}</a>` : ""}
    </div>
    ${socialLinksHtml ? `<div class="drawer-social-label">Social</div><div class="drawer-social-pills">${socialLinksHtml}</div>` : ""}
  </div>
</div>` : ""}

<!-- ── Neighborhood Map modal ─────────────────────────────────────── -->
<div id="map-modal" class="modal-backdrop" onclick="if(event.target===this)window.__closeModal('map')">
  <div class="modal-box" onclick="event.stopPropagation()">
    <div class="modal-top-bar">
      <span class="modal-title" id="map-modal-title">Neighborhood</span>
      <button class="modal-close-btn" onclick="window.__closeModal('map')">&times;</button>
    </div>
    <div class="modal-body" style="padding:12px">
      <div style="position:relative;padding-top:56.25%;border-radius:10px;overflow:hidden;background:#111">
        <iframe id="map-frame" src="" title="Neighborhood Map" style="position:absolute;inset:0;width:100%;height:100%;border:none" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>
      </div>
    </div>
  </div>
</div>

<!-- ── Cinematic video modal ─────────────────────────────────────── -->
<div id="cinema-modal" class="modal-backdrop" onclick="if(event.target===this)window.__closeModal('cinema')">
  <div class="modal-box" onclick="event.stopPropagation()">
    <div class="modal-top-bar">
      <span class="modal-title">Cinematic Video</span>
      <button class="modal-close-btn" onclick="window.__closeModal('cinema')">&times;</button>
    </div>
    <div class="modal-body" style="padding:12px">
      <div style="position:relative;padding-top:56.25%;border-radius:10px;overflow:hidden;background:#000">
        <div id="cinema-content" style="position:absolute;inset:0"></div>
      </div>
    </div>
  </div>
</div>

<!-- ── Media carousel modal ──────────────────────────────────────── -->
<div id="carousel-modal" class="modal-backdrop" onclick="if(event.target===this)window.__closeModal('carousel')">
  <div class="modal-box" onclick="event.stopPropagation()">
    <div class="modal-top-bar">
      <span class="modal-title">Media Gallery &nbsp;<span id="carousel-counter" style="font-weight:400;font-size:11px;color:rgba(255,255,255,0.5)"></span></span>
      <button class="modal-close-btn" onclick="window.__closeModal('carousel')">&times;</button>
    </div>
    <div class="modal-body" style="padding:12px">
      <div id="carousel-media-stage">
        <button class="carousel-arrow" id="carousel-prev" onclick="window.__carouselNav(-1)">&#8249;</button>
        <button class="carousel-arrow" id="carousel-next" onclick="window.__carouselNav(1)">&#8250;</button>
      </div>
      <div class="carousel-thumbs" id="carousel-thumbs"></div>
    </div>
  </div>
</div>

${askAssets.panelHtml}
${propertyDocsPanelHtml}
${poweredByFooter}
${
  propertyDocsData
    ? `<script>window.__PROPERTY_EXTRACTIONS__=${safeJsonScriptLiteral(propertyDocsData)};</script>`
    : ""
}
${hasQA ? `<script>window.__QA_DATABASE__=${safeJsonScriptLiteral(qaDatabase)};</script>` : ""}
${synthesisUrl ? `<script>window.__SYNTHESIS_URL__=${JSON.stringify(synthesisUrl)};</script>` : ""}
${presentationToken ? `<script>window.__PRESENTATION_TOKEN__=${JSON.stringify(presentationToken)};window.__SAVED_MODEL_ID__=${JSON.stringify(model.id)};</script>` : ""}
${askAssets.moduleScript}
<!-- ── Pre-bootstrap safety net ────────────────────────────────────────
     This tiny script runs BEFORE the main IIFE. If the main IIFE later
     fails to parse (e.g. a future template-literal bug), the gate
     buttons still dismiss the overlay and the Matterport iframe still
     loads its first property, so the 3D tour is never dead-on-arrival.
     The main IIFE re-binds the same handlers; addEventListener stacks
     them harmlessly. -->
<script>
(function(){
  try {
    var raw=${JSON.stringify(configB64)};
    var cfg=JSON.parse(atob(raw));
    var first=(cfg.properties&&cfg.properties[0])||null;
    var frame=document.getElementById("matterport-frame");
    if(frame&&first&&first.iframeUrl){ frame.src=first.iframeUrl; }
    function hideGate(){
      var g=document.getElementById("gate");
      if(g){ g.classList.add("hidden"); setTimeout(function(){g.style.display="none";},500); }
    }
    var s=document.getElementById("gate-sound-btn");
    var q=document.getElementById("gate-silent-btn");
    if(s) s.addEventListener("click",hideGate);
    if(q) q.addEventListener("click",hideGate);
  } catch(err){ console.error("[presentation] safety bootstrap failed",err); }
})();
</script>
<script>
(function(){
var C=JSON.parse(atob("${configB64}"));
var props=C.properties;
var uuidByIndex=C.propertyUuidByIndex||[];
var frame=document.getElementById("matterport-frame");
var tabsEl=document.getElementById("tabs");
var current=0;
var soundEnabled=false;
var audioEl=null;
var carouselIndex=0;
var carouselMedia=[];

function escapeText(s){
  return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function formatFieldValue(v){
  if(v==null) return "\u2014";
  if(typeof v==="object") return JSON.stringify(v);
  return String(v);
}

// \u2500\u2500 Cinematic video URL parser
function parseCinematicUrl(url){
  try{
    if(!url) return null;
    url=url.trim();
    if(/\\.mp4(\\?.*)?$/i.test(url)) return {kind:"mp4",src:url};
    var yt=url.match(/youtu\\.be\\/([\\w-]{6,})/i)||url.match(/youtube\\.com\\/(?:watch\\?(?:.*&)?v=|embed\\/|shorts\\/|v\\/)([\\w-]{6,})/i);
    if(yt&&yt[1]) return {kind:"iframe",src:"https://www.youtube.com/embed/"+yt[1]+"?rel=0&modestbranding=1&autoplay=1"};
    var vi=url.match(/player\\.vimeo\\.com\\/video\\/(\\d+)/i)||url.match(/vimeo\\.com\\/(?:video\\/)?(\\d+)/i);
    if(vi&&vi[1]) return {kind:"iframe",src:"https://player.vimeo.com/video/"+vi[1]+"?title=0&byline=0&portrait=0&autoplay=1"};
    var wi=url.match(/wistia\\.com\\/medias\\/([\\w-]+)/i)||url.match(/wistia\\.net\\/(?:embed\\/iframe|medias)\\/([\\w-]+)/i);
    if(wi&&wi[1]) return {kind:"iframe",src:"https://fast.wistia.net/embed/iframe/"+wi[1]+"?autoPlay=true"};
    var lo=url.match(/loom\\.com\\/(?:share|embed)\\/([\\w-]+)/i);
    if(lo&&lo[1]) return {kind:"iframe",src:"https://www.loom.com/embed/"+lo[1]+"?autoplay=1"};
    return null;
  }catch(_e){return null;}
}

// \u2500\u2500 Ambient audio
function initAudio(musicUrl,play){
  if(!musicUrl) return;
  if(!audioEl){
    audioEl=document.createElement("audio");
    audioEl.loop=true;
    audioEl.volume=0.4;
    document.body.appendChild(audioEl);
  }
  if(audioEl.src!==musicUrl) audioEl.src=musicUrl;
  if(play){audioEl.play().catch(function(){});soundEnabled=true;}
  updateMuteBtn();
}
function toggleMute(){
  if(!audioEl) return;
  if(audioEl.paused){audioEl.play().catch(function(){});soundEnabled=true;}
  else{audioEl.pause();soundEnabled=false;}
  updateMuteBtn();
}
function updateMuteBtn(){
  var btn=document.getElementById("hud-mute-btn");
  var iconOn=document.getElementById("mute-icon-on");
  var iconOff=document.getElementById("mute-icon-off");
  if(!btn) return;
  var hasSrc=audioEl&&audioEl.src&&audioEl.src!==window.location.href;
  btn.classList.toggle("visible",!!hasSrc);
  if(iconOn) iconOn.style.display=(hasSrc&&soundEnabled)?"":"none";
  if(iconOff) iconOff.style.display=(hasSrc&&!soundEnabled)?"":"none";
}
var muteBtn=document.getElementById("hud-mute-btn");
if(muteBtn) muteBtn.addEventListener("click",toggleMute);

// \u2500\u2500 HUD header update
function updateHud(i){
  var p=props[i];
  if(!p) return;
  var elName=document.getElementById("hud-prop-name");
  var elLoc=document.getElementById("hud-prop-loc");
  var elAgent=document.getElementById("hud-agent-name");
  if(elName) elName.textContent=p.propertyName||"";
  if(elLoc) elLoc.textContent=(p.name||"")+(p.location?" \u2014 "+p.location:"");
  if(elAgent) elAgent.textContent=(C.agent&&C.agent.name)?C.agent.name:"";
  var mapBtn=document.getElementById("hud-map-btn");
  if(mapBtn) mapBtn.style.display=(p.enableNeighborhoodMap&&p.location)?"":"none";
  var cinBtn=document.getElementById("hud-cinema-btn");
  if(cinBtn) cinBtn.style.display=(p.cinematicVideoUrl&&parseCinematicUrl(p.cinematicVideoUrl))?"":"none";
  var mediaBtn=document.getElementById("hud-media-btn");
  if(mediaBtn) mediaBtn.style.display=(p.multimedia&&p.multimedia.length>0)?"":"none";
  if(p.musicUrl){initAudio(p.musicUrl,soundEnabled);}
  else if(audioEl){audioEl.pause();audioEl.src="";updateMuteBtn();}
}

// \u2500\u2500 HUD toggle
var hudHeader=document.getElementById("hud-header");
var hudToggle=document.getElementById("hud-toggle");
var chevUp=document.getElementById("hud-chevron-up");
var chevDown=document.getElementById("hud-chevron-down");
var hudVisible=false;
function setHudVisible(v){
  hudVisible=v;
  if(hudHeader){hudHeader.classList.toggle("visible",v);}
  if(chevUp) chevUp.style.display=v?"":"none";
  if(chevDown) chevDown.style.display=v?"none":"";
}
if(hudToggle) hudToggle.addEventListener("click",function(){setHudVisible(!hudVisible);});

// \u2500\u2500 Welcome gate
function dismissGate(){
  var gate=document.getElementById("gate");
  if(gate){gate.classList.add("hidden");setTimeout(function(){gate.style.display="none";},500);}
  setHudVisible(true);
}
var soundBtn=document.getElementById("gate-sound-btn");
var silentBtn=document.getElementById("gate-silent-btn");
if(soundBtn) soundBtn.addEventListener("click",function(){
  try {
    soundEnabled=true;
    var p=props[current];
    if(p&&p.musicUrl) initAudio(p.musicUrl,true);
  } catch(err){ console.warn("[presentation] sound init failed",err); }
  try { dismissGate(); } catch(_e){}
});
if(silentBtn) silentBtn.addEventListener("click",function(){
  try { soundEnabled=false; } catch(_e){}
  try { dismissGate(); } catch(_e){}
});

// \u2500\u2500 Contact panel
window.__openContact=function(){
  var d=document.getElementById("agent-drawer");
  if(d) d.classList.add("open");
};
window.__closeContact=function(){
  var d=document.getElementById("agent-drawer");
  if(d) d.classList.remove("open");
};

// \u2500\u2500 Modal helpers
window.__openModal=function(name,idx){
  var el=document.getElementById(name+"-modal");
  if(!el) return;
  if(name==="map"){
    var p=props[current];
    var mapFrame=document.getElementById("map-frame");
    var titleEl=document.getElementById("map-modal-title");
    if(mapFrame&&p&&p.location){
      mapFrame.src="https://maps.google.com/maps?q="+encodeURIComponent(p.location)+"&t=&z=15&ie=UTF8&iwloc=&output=embed";
    }
    if(titleEl&&p) titleEl.textContent=(p.propertyName||p.name||"Property")+" \u2014 Neighborhood";
  }
  if(name==="cinema"){
    var p2=props[current];
    var content=document.getElementById("cinema-content");
    if(content&&p2&&p2.cinematicVideoUrl){
      var parsed=parseCinematicUrl(p2.cinematicVideoUrl);
      if(parsed){
        content.innerHTML=parsed.kind==="mp4"
          ?'<video src="'+escapeText(parsed.src)+'" controls autoplay style="position:absolute;inset:0;width:100%;height:100%;border-radius:10px"></video>'
          :'<iframe src="'+escapeText(parsed.src)+'" style="position:absolute;inset:0;width:100%;height:100%;border:none" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture;fullscreen" allowfullscreen></iframe>';
      }
    }
  }
  if(name==="carousel"){
    var p3=props[current];
    carouselMedia=p3&&p3.multimedia?p3.multimedia:[];
    carouselIndex=typeof idx==="number"?idx:0;
    renderCarousel();
  }
  el.classList.add("open");
};
window.__closeModal=function(name){
  var el=document.getElementById(name+"-modal");
  if(!el) return;
  el.classList.remove("open");
  if(name==="map"){var mf=document.getElementById("map-frame");if(mf)mf.src="";}
  if(name==="cinema"){var cc=document.getElementById("cinema-content");if(cc)cc.innerHTML="";}
};

// \u2500\u2500 Carousel render
function renderCarousel(){
  var stage=document.getElementById("carousel-media-stage");
  var counter=document.getElementById("carousel-counter");
  var thumbsEl=document.getElementById("carousel-thumbs");
  if(!stage||!carouselMedia.length) return;
  var total=carouselMedia.length;
  var item=carouselMedia[carouselIndex];
  var kindLabel=item.kind==="video"?"Video":item.kind==="gif"?"GIF":"Photo";
  if(counter) counter.textContent=(carouselIndex+1)+" / "+total+" \u00b7 "+kindLabel+(item.label?" \u00b7 "+item.label:"");
  var prevBtn=document.getElementById("carousel-prev");
  var nextBtn=document.getElementById("carousel-next");
  var children=Array.prototype.slice.call(stage.childNodes);
  children.forEach(function(c){if(c.id!=="carousel-prev"&&c.id!=="carousel-next")stage.removeChild(c);});
  var media;
  if(item.kind==="video"&&item.embedUrl){
    media=document.createElement("video");
    media.src=item.embedUrl;media.controls=true;media.autoplay=true;media.playsInline=true;
    media.style.cssText="position:absolute;inset:0;width:100%;height:100%;object-fit:contain";
  }else{
    media=document.createElement("img");
    media.src=item.proxyUrl||"";
    media.alt=item.label||"Media";
    media.style.cssText="position:absolute;inset:0;width:100%;height:100%;object-fit:contain";
  }
  stage.insertBefore(media,stage.firstChild);
  if(prevBtn){prevBtn.style.display=total>1?"flex":"none";}
  if(nextBtn){nextBtn.style.display=total>1?"flex":"none";}
  if(thumbsEl){
    thumbsEl.innerHTML="";
    for(var t=0;t<carouselMedia.length;t++){
      (function(ti){
        var a=carouselMedia[ti];
        var btn=document.createElement("button");
        btn.className="carousel-thumb"+(ti===carouselIndex?" active":"");
        btn.setAttribute("aria-label","Go to media "+(ti+1));
        btn.addEventListener("click",function(){carouselIndex=ti;renderCarousel();});
        if(a.kind==="video"){
          btn.innerHTML='<div class="carousel-thumb-play"><svg width="14" height="14" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg></div>';
        }else if(a.proxyUrl){
          var img=document.createElement("img");
          img.src=a.proxyUrl;img.style.cssText="width:100%;height:100%;object-fit:cover";img.loading="lazy";
          btn.appendChild(img);
        }else{
          btn.innerHTML='<div class="carousel-thumb-play"></div>';
        }
        thumbsEl.appendChild(btn);
      })(t);
    }
  }
}
window.__carouselNav=function(delta){
  if(!carouselMedia.length) return;
  carouselIndex=(carouselIndex+delta+carouselMedia.length)%carouselMedia.length;
  renderCarousel();
};

// \u2500\u2500 Keyboard shortcuts
document.addEventListener("keydown",function(e){
  if(e.key!=="Escape") return;
  ["map","cinema","carousel"].forEach(function(n){
    var el=document.getElementById(n+"-modal");
    if(el&&el.classList.contains("open")) window.__closeModal(n);
  });
  var dr=document.getElementById("agent-drawer");
  if(dr&&dr.classList.contains("open")) window.__closeContact();
});

function renderPropertyDocs(_i){
  // No-op. The on-screen Property Docs overlay was removed; extraction data
  // is still injected via window.__PROPERTY_EXTRACTIONS__ for the Ask AI chat.
  return;
}

// ── Ask AI runtime modules (intent router, property brain, decision
//    ladder). Inlined verbatim from src/lib/portal/*.mjs via the
//    assembler. All exports become locals in this IIFE scope.
${ASK_RUNTIME_JS}

// ── Unified Ask pipeline: fans out across the host-curated qaDatabase
//    AND per-property doc extractions. Single panel, single button.
//    Tier 1 — canonical Q&As from doc extractions, with intent guard.
//    Tier 2 — hybrid Orama search over the host-curated qaDatabase
//             (anchor-link answers), with intent guard.
//    Tier 3 — hybrid (or BM25 fallback) over per-property doc chunks,
//             used as grounding for the synthesis bridge.
//    Strict unknown is preferred over wrong-category adjacency.
var __docsQa={
  initPromise:null,
  oramaModule:null,
  embedPipeline:null,
  MODE_HYBRID:null,
  db:null,                // per-property docs DB
  qaDb:null,              // global host-curated qaDatabase DB
  mode:null,              // "hybrid" | "bm25" (for docs DB)
  currentIndexKey:null,
  abortCtrl:null,         // AbortController for in-flight synthesis requests
  input:null,
  send:null,
  messages:null
};

// Tier-1 thresholds (0.55 soft / 0.45 floor) and the pure scoring/RRF
// helpers now live in src/lib/portal/ask-runtime-logic.mjs. They are
// injected at the top of this IIFE via the ASK_RUNTIME_JS interpolation
// above. (Do NOT write \${ASK_RUNTIME_JS} in a comment here — template
// literals always evaluate \${...}, even inside // comments, which would
// inline the entire 40 KB runtime a second time and corrupt the script.)

function __dqaAppendMsg(text,role,source,anchorId){
  if(!__docsQa.messages) return;
  var div=document.createElement("div");
  div.className="ask-msg "+role;
  div.textContent=text;
  if(role==="assistant"&&anchorId){
    // Curated qaDatabase hits — clickable scroll-to-anchor link.
    var link=document.createElement("span");
    link.className="source-link";
    link.textContent="View source: "+String(anchorId).replace(/-/g," ");
    link.onclick=function(){
      var el=document.getElementById(anchorId);
      if(el){el.scrollIntoView({behavior:"smooth",block:"center"});el.style.outline="2px solid ${accentColor}";setTimeout(function(){el.style.outline="none";},3000);}
    };
    div.appendChild(document.createElement("br"));
    div.appendChild(link);
  }else if(source){
    // Docs hits — plain source label.
    var tag=document.createElement("div");
    tag.className="ask-src";
    tag.textContent="from: "+source;
    div.appendChild(tag);
  }
  __docsQa.messages.appendChild(div);
  __docsQa.messages.scrollTop=__docsQa.messages.scrollHeight;
}
function __dqaActiveEntries(i){
  var data=window.__PROPERTY_EXTRACTIONS__||{};
  var uuid=uuidByIndex[i];
  return uuid?(data[uuid]||[]):[];
}
function __dqaRenderInquiryForm(prefilledQuestion,_propertyUuid){
  // Lead-capture downgrade: rendered when the per-property Gemini
  // subsidy is exhausted. Form-only by design — never auto-sends.
  // Submit prefers the backend lead path (handle-lead-capture, Pro
  // tier only) and falls back to a client-side mailto: link otherwise.
  var prop=(props&&props[current])||{};
  var propertyName=prop.name||"this property";
  var agentEmail=String((C.agent&&C.agent.email)||"").trim();
  var agentPhone=String((C.agent&&C.agent.phone)||"").trim();
  var card=document.createElement("div");
  card.className="ask-msg assistant ask-inquiry-card";
  card.innerHTML='<div class="ask-inquiry-head"><strong>Ask the agent directly</strong><div class="ask-inquiry-sub">Free Ask AI answers are exhausted for this property. Send your question to the listing agent.</div></div>'
    +'<div class="ask-inquiry-fields">'
    +'<input type="text" class="ask-inquiry-input" data-k="name" placeholder="Your name" autocomplete="name">'
    +'<input type="email" class="ask-inquiry-input" data-k="email" placeholder="Your email" autocomplete="email" required>'
    +'<input type="tel" class="ask-inquiry-input" data-k="phone" placeholder="Phone (optional)" autocomplete="tel">'
    +'<textarea class="ask-inquiry-input ask-inquiry-textarea" data-k="message" rows="4" required>'+escapeText(String(prefilledQuestion||""))+'</textarea>'
    +'</div>'
    +'<div class="ask-inquiry-actions">'
    +'<button class="ask-inquiry-send" type="button">Send to agent</button>'
    +(agentPhone?'<a class="ask-inquiry-sms" href="sms:'+escapeText(agentPhone)+'?body='+encodeURIComponent("Question about "+propertyName+":\n\n"+(prefilledQuestion||""))+'">Text instead</a>':'')
    +'</div>'
    +'<div class="ask-inquiry-status" aria-live="polite"></div>';
  __docsQa.messages.appendChild(card);
  __docsQa.messages.scrollTop=__docsQa.messages.scrollHeight;
  var inputs=card.querySelectorAll(".ask-inquiry-input");
  var statusEl=card.querySelector(".ask-inquiry-status");
  card.querySelector(".ask-inquiry-send").addEventListener("click",async function(){
    var values={};
    for(var i=0;i<inputs.length;i++){
      values[inputs[i].getAttribute("data-k")]=inputs[i].value.trim();
    }
    if(!values.email||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(values.email)){
      statusEl.textContent="Please enter a valid email.";
      statusEl.style.color="#b91c1c";
      return;
    }
    if(!values.message){
      statusEl.textContent="Please include a message.";
      statusEl.style.color="#b91c1c";
      return;
    }
    statusEl.textContent="Sending…";
    statusEl.style.color="";
    var sentVia=null;
    // Primary: try handle-lead-capture (Pro-tier, server-routed).
    var supabaseOrigin=window.__SYNTHESIS_URL__?String(window.__SYNTHESIS_URL__).replace(/\\/functions\\/v1\\/.*$/,""):"";
    var studioId=String(C.studioId||"");
    if(supabaseOrigin&&studioId){
      try{
        var lcResp=await fetch(supabaseOrigin+"/functions/v1/handle-lead-capture",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({studio_id:studioId,visitor_email:values.email,property_name:propertyName})
        });
        if(lcResp.ok) sentVia="backend";
      }catch(_){}
    }
    if(!sentVia){
      // Fallback: client-side mailto. The visitor's mail client
      // composes the email; nothing is sent until they confirm.
      if(!agentEmail){
        statusEl.textContent="Sorry, no contact channel is configured for this listing.";
        statusEl.style.color="#b91c1c";
        return;
      }
      var subject="Question about "+propertyName;
      var bodyLines=[
        values.message,
        "",
        "— "+(values.name||"Visitor")+(values.phone?" ("+values.phone+")":"")
      ];
      var mailto="mailto:"+encodeURIComponent(agentEmail)
        +"?subject="+encodeURIComponent(subject)
        +"&body="+encodeURIComponent(bodyLines.join("\\n"));
      window.location.href=mailto;
      sentVia="mailto";
    }
    statusEl.textContent=sentVia==="backend"
      ?"Thanks — your message was sent to the agent."
      :"Your email composer should now be open. Send the email to complete your inquiry.";
    statusEl.style.color="#047857";
    for(var j=0;j<inputs.length;j++) inputs[j].disabled=true;
    card.querySelector(".ask-inquiry-send").disabled=true;
  });
}
function __dqaEvidenceUnits(content){
  var raw=String(content||"").trim();
  if(!raw) return [];
  var normalized=raw
    .replace(/[•●]\\s*/g,". ")
    .replace(/\\s+/g," ")
    .trim();
  if(!normalized) return [];

  var units=[];
  var labelRe=/(?:^|[.;]\\s+)([A-Z][A-Za-z0-9 /&()+.'-]{2,52}):\\s*([^:]{12,420}?)(?=(?:[.;]\\s+[A-Z][A-Za-z0-9 /&()+.'-]{2,52}:\\s)|$)/g;
  var m;
  while((m=labelRe.exec(normalized))!==null){
    var label=String(m[1]||"").trim();
    var value=String(m[2]||"").trim().replace(/[.;]\\s*$/,"");
    if(label&&value) units.push((label+": "+value+".").trim());
  }

  var sentences=normalized.match(/[^.!?]+[.!?]?/g)||[];
  for(var i=0;i<sentences.length;i++){
    var s=sentences[i].replace(/^[\\s:;,.\\-–—)]+/,"").trim();
    if(s.length<24) continue;
    if(s.length>520){
      var bits=s.split(/;\\s+|,\\s+(?=(?:and|including|with|which|while)\\b)/i);
      for(var b=0;b<bits.length;b++){
        var bit=bits[b].trim();
        if(bit.length>=24&&bit.length<=520) units.push(bit);
      }
    }else{
      units.push(s);
    }
  }

  var out=[];
  var seen={};
  for(var u=0;u<units.length;u++){
    var clean=units[u].replace(/\\s+/g," ").trim();
    if(!clean) continue;
    var key=clean.toLowerCase();
    if(seen[key]) continue;
    seen[key]=true;
    out.push(clean);
    if(out.length>=32) break;
  }
  return out.length?out:[normalized.slice(0,520)];
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
      var units=__dqaEvidenceUnits(ch.content||"");
      for(var u=0;u<units.length;u++){
        docs.push({
          id:label+"#chunk#"+(ch.id||c)+"#u#"+u,
          source:label+" \u2192 "+(ch.section||"section"),
          content:units[u],
          // Evidence units inherit the parent vector. BM25 ranks the
          // unit text; vector recall still benefits from the parent
          // semantic embedding without another model pass.
          embedding:hasEmb?ch.embedding:null,
          kind:(ch.kind==="raw_chunk"||ch.kind==="field_chunk")?ch.kind:"raw_chunk"
        });
      }
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
        embedding:null,
        kind:"field_chunk"
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
  var collected=__dqaCollectChunkDocs(entries);
  var useHybrid=collected.hasEmbeddings&&!!__docsQa.embedPipeline;
  __docsQa.mode=useHybrid?"hybrid":"bm25";
  var schema=useHybrid
    ? {id:"string",source:"string",content:"string",kind:"string",embedding:"vector[384]"}
    : {id:"string",source:"string",content:"string",kind:"string"};
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
        id:doc.id,source:doc.source,content:doc.content,kind:doc.kind||"raw_chunk",embedding:emb
      });
    }else{
      await om.insert(__docsQa.db,{
        id:doc.id,source:doc.source,content:doc.content,kind:doc.kind||"raw_chunk"
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
    console.warn("ask: query embed failed:",err);
    return null;
  }
}
async function __askBuildCuratedDb(){
  // Build the host-curated qaDatabase Orama DB once. The data is the same
  // regardless of which property tab is active.
  if(__docsQa.qaDb||!window.__ASK_HAS_QA__) return;
  var om=__docsQa.oramaModule;
  if(!om) return;
  var data=window.__QA_DATABASE__||[];
  if(!data.length) return;
  __docsQa.qaDb=await om.create({
    schema:{id:"string",question:"string",answer:"string",source_anchor_id:"string",embedding:"vector[384]"}
  });
  for(var i=0;i<data.length;i++){
    var entry=data[i];
    await om.insert(__docsQa.qaDb,{
      id:entry.id,
      question:entry.question,
      answer:entry.answer,
      source_anchor_id:entry.source_anchor_id,
      embedding:entry.embedding
    });
  }
}
async function __dqaInit(){
  if(__docsQa.initPromise) return __docsQa.initPromise;
  __docsQa.input=document.getElementById("ask-input");
  __docsQa.send=document.getElementById("ask-send");
  __docsQa.messages=document.getElementById("ask-messages");
  if(!__docsQa.input||!__docsQa.send) return;
  __docsQa.initPromise=(async function(){
    // Load Orama first (tiny), then transformers.js (heavy, WASM + ONNX
    // weights). One shared download for both knowledge sources.
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
      console.warn("ask: transformers load failed, falling back to BM25:",err);
      __docsQa.embedPipeline=null;
    }
  })();
  await __docsQa.initPromise;
  // Build both indexes (whichever apply to this presentation).
  if(window.__ASK_HAS_DOCS__) await __dqaRebuildIndex(current);
  await __askBuildCuratedDb();
  __docsQa.input.placeholder="Ask a question about this property\u2026";
  __docsQa.input.disabled=false;
  __docsQa.send.disabled=false;
  async function handleAsk(){
    var q=(__docsQa.input.value||"").trim();
    if(!q) return;
    __docsQa.input.value="";
    __dqaAppendMsg(q,"user",null,null);
    __docsQa.input.disabled=true;
    __docsQa.send.disabled=true;
    try{
      // Step 0 — classify intent (rule-based, deterministic).
      var classification=classifyIntent(q);
      var intent=classification.intent;
      try{console.log("[ask] intent="+intent+" q="+q);}catch(_){}

      // Step 1 — compose Property Brain for the current property tab.
      //          Read-only projection over injected globals; rebuilt per
      //          call (cheap for typical presentation data).
      var entries=__dqaActiveEntries(current);
      var configProperty=(props&&props[current])||null;
      var brain=buildPropertyBrain({
        propertyIndex:current,
        propertyUuid:uuidByIndex[current]||null,
        configProperty:configProperty,
        agent:C.agent||{},
        brandName:C.brandName||"",
        extractionEntries:entries,
        curatedQAs:window.__QA_DATABASE__||[],
        hasDocs:!!window.__ASK_HAS_DOCS__,
        hasQA:!!window.__ASK_HAS_QA__,
        tagIntents:tagQAIntents
      });

      // Step 2 — embed query (may be null if transformers failed to load).
      var queryVec=await __dqaEmbedQuery(q);

      // Step 3 — run Orama searches (DOM-bound; live in the IIFE).
      //          These feed decideAnswer as pre-ranked hit lists.
      var curatedHits=[];
      if(__docsQa.qaDb&&queryVec){
        try{
          var qaRes=await __docsQa.oramaModule.search(__docsQa.qaDb,{
            mode:__docsQa.MODE_HYBRID,
            term:q,
            vector:{value:queryVec,property:"embedding"},
            limit:3,
            similarity:0
          });
          var qaHits=(qaRes&&qaRes.hits)||[];
          for(var qh=0;qh<qaHits.length;qh++){
            var d=qaHits[qh].document||{};
            curatedHits.push({
              id:d.id,
              question:d.question||"",
              answer:d.answer||"",
              source_anchor_id:d.source_anchor_id||"",
              field:"",
              score:qaHits[qh].score||0
            });
          }
        }catch(qaErr){
          console.warn("ask: curated qa search failed:",qaErr);
        }
      }

      var chunkHits=[];
      if(__docsQa.db){
        var searchArgs;
        if(__docsQa.mode==="hybrid"&&queryVec){
          searchArgs={
            mode:__docsQa.MODE_HYBRID,
            term:q,
            vector:{value:queryVec,property:"embedding"},
            properties:["content"],
            limit:5,
            similarity:0
          };
        }else{
          searchArgs={term:q,properties:["content"],limit:5};
        }
        try{
          var res=await __docsQa.oramaModule.search(__docsQa.db,searchArgs);
          var hits=(res&&res.hits)||[];
          for(var ch=0;ch<hits.length;ch++){
            var doc=hits[ch].document||{};
            chunkHits.push({
              id:doc.id,
              source:doc.source||"",
              section:doc.source||"",
              content:String(doc.content||""),
              templateLabel:"",
              score:hits[ch].score||0,
              kind:doc.kind||"raw_chunk"
            });
          }
        }catch(docsErr){
          console.warn("ask: docs search failed:",docsErr);
        }
      }

      // Step 4 — pure decision ladder.
      var decision=decideAnswer({
        brain:brain,
        query:q,
        queryVec:queryVec,
        intent:intent,
        intentAllows:intentAllows,
        curatedHits:curatedHits,
        chunkHits:chunkHits,
        canSynthesize:!!window.__SYNTHESIS_URL__
      });
      try{console.log("[ask] path="+decision.path+" intent="+decision.intent);}catch(_){}

      // Step 5 — render.
      if(decision.path==="synthesis"&&decision.needsSynthesis){
        // ── Synthesis Bridge ───────────────────────────────────────────
        // The runtime sends the new authenticated request shape:
        //   { presentation_token, saved_model_id, property_uuid, query,
        //     evidence_hints: { chunk_ids } }
        // The backend ignores client-supplied chunk content (only ids
        // bias selection), so this shape never lets a malicious
        // visitor inject text into the model context.
        var loadDiv=document.createElement("div");
        loadDiv.className="ask-msg assistant loading";
        loadDiv.innerHTML='<span class="ask-loading-dots"><span style="--i:0">•</span><span style="--i:1">•</span><span style="--i:2">•</span></span>';
        __docsQa.messages.appendChild(loadDiv);
        __docsQa.messages.scrollTop=__docsQa.messages.scrollHeight;
        var synthesized=false;
        try{
          var sCtrl=new AbortController();
          if(__docsQa.abortCtrl) __docsQa.abortCtrl.abort();
          __docsQa.abortCtrl=sCtrl;
          var hintIds=[];
          if(decision.synthChunks&&decision.synthChunks.length){
            for(var hi=0;hi<decision.synthChunks.length;hi++){
              if(decision.synthChunks[hi]&&decision.synthChunks[hi].id){
                hintIds.push(String(decision.synthChunks[hi].id));
              }
            }
          }
          // Pre-flight: if a previous response already declared the
          // quota exhausted for this property, skip the fetch entirely
          // and render the inquiry form. Visitor never sees a wasted
          // round-trip.
          var __pq=__docsQa.quotaByProperty&&__docsQa.quotaByProperty[uuidByIndex[current]||""];
          if(__pq&&__pq.downgrade_required){
            if(loadDiv.parentNode) loadDiv.remove();
            __dqaRenderInquiryForm(q,uuidByIndex[current]||"");
            __docsQa.input.disabled=false;
            __docsQa.send.disabled=false;
            return;
          }
          var sResp=await fetch(window.__SYNTHESIS_URL__,{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({
              presentation_token:window.__PRESENTATION_TOKEN__||"",
              saved_model_id:window.__SAVED_MODEL_ID__||"",
              property_uuid:uuidByIndex[current]||"",
              query:q,
              evidence_hints:{chunk_ids:hintIds}
            }),
            signal:sCtrl.signal
          });
          if(sResp.status===402){
            // Server says: quota exhausted for this property. Cache
            // the decision and render the lead-capture form instead.
            try{
              var qBody=await sResp.json();
              if(!__docsQa.quotaByProperty) __docsQa.quotaByProperty={};
              __docsQa.quotaByProperty[uuidByIndex[current]||""]={
                quota_state:qBody.quota_state||"exhausted",
                quota_remaining:0,
                downgrade_required:true
              };
            }catch(_){}
            if(loadDiv.parentNode) loadDiv.remove();
            __dqaRenderInquiryForm(q,uuidByIndex[current]||"");
            __docsQa.input.disabled=false;
            __docsQa.send.disabled=false;
            return;
          }
          if(sResp.ok&&sResp.body){
            var sReader=sResp.body.getReader();
            var sDecoder=new TextDecoder();
            var sBuf="";
            var ansDiv=document.createElement("div");
            ansDiv.className="ask-msg assistant";
            loadDiv.replaceWith(ansDiv);
            var accText="";
            var streamDone=false;
            while(!streamDone){
              var rr=await sReader.read();
              if(rr.done) break;
              sBuf+=sDecoder.decode(rr.value,{stream:true});
              var sLines=sBuf.split("\\n");
              sBuf=sLines.pop()||"";
              for(var sl=0;sl<sLines.length;sl++){
                var sLine=sLines[sl];
                if(!sLine.startsWith("data: ")) continue;
                var sPay=sLine.slice(6).trim();
                try{
                  var sEvt=JSON.parse(sPay);
                  if(sEvt.token){
                    accText+=sEvt.token;
                    ansDiv.textContent=accText;
                    __docsQa.messages.scrollTop=__docsQa.messages.scrollHeight;
                    synthesized=true;
                  }else if(sEvt.done){
                    streamDone=true;
                  }else if(sEvt.error){
                    throw new Error(sEvt.error);
                  }else if(sEvt.meta){
                    // Track quota state per property so subsequent
                    // sends short-circuit to the inquiry form when
                    // the cap is hit.
                    if(!__docsQa.quotaByProperty) __docsQa.quotaByProperty={};
                    var pUuid=uuidByIndex[current]||"";
                    var prev=__docsQa.quotaByProperty[pUuid]||{};
                    __docsQa.quotaByProperty[pUuid]={
                      quota_state:sEvt.meta.quota_state||prev.quota_state||"ok",
                      quota_remaining:typeof sEvt.meta.quota_remaining==="number"?sEvt.meta.quota_remaining:prev.quota_remaining,
                      downgrade_required:sEvt.meta.downgrade_required===true||prev.downgrade_required===true
                    };
                  }
                }catch(pe){if(!(pe instanceof SyntaxError)) throw pe;}
              }
            }
          }
          if(loadDiv.parentNode) loadDiv.remove();
        }catch(sErr){
          if(sErr.name!=="AbortError") console.warn("ask: synthesis failed:",sErr);
          if(loadDiv.parentNode) loadDiv.remove();
        }
        __docsQa.abortCtrl=null;
        if(!synthesized){
          // Synthesis endpoint unreachable / errored — emit strict
          // unknown rather than bleeding a wrong-category local answer.
          __dqaAppendMsg("I don't have that detail for this property yet. Try rephrasing, or contact us for more info.","assistant",null,null);
        }
      }else{
        // Deterministic path — render directly.
        var anchorId=decision.anchorId||null;
        var sourceLabel=(!anchorId&&decision.sourceLabel)?decision.sourceLabel:null;
        __dqaAppendMsg(decision.text||"","assistant",sourceLabel,anchorId);
        if(decision.href&&__docsQa.messages.lastChild){
          var chip=document.createElement("a");
          chip.className="source-link";
          chip.href=decision.href;
          chip.target="_blank";
          chip.rel="noopener noreferrer";
          chip.textContent=decision.sourceLabel||"Open link";
          __docsQa.messages.lastChild.appendChild(document.createElement("br"));
          __docsQa.messages.lastChild.appendChild(chip);
        }
      }
    }catch(err){
      console.error("ask: decision failed:",err);
      __dqaAppendMsg("Search failed. Please try again.","assistant",null,null);
    }
    __docsQa.input.disabled=false;
    __docsQa.send.disabled=false;
    __docsQa.input.focus();
  }
  __docsQa.send.addEventListener("click",handleAsk);
  __docsQa.input.addEventListener("keydown",function(e){if(e.key==="Enter") handleAsk();});
}
window.__openAsk=function(){
  var panel=document.getElementById("ask-panel");
  if(!panel) return;
  panel.classList.add("open");
  __dqaInit();
};

function load(i){
  current=i;
  try { if(frame && props[i]) frame.src=props[i].iframeUrl; } catch(_e){}
  try {
    var tabs=tabsEl?tabsEl.querySelectorAll(".tab"):[];
    tabs.forEach(function(t,j){t.classList.toggle("active",j===i)});
  } catch(_e){}
  try { renderPropertyDocs(i); } catch(_e){}
  try { updateHud(i); } catch(_e){}
  // Reset carousel context for new property
  carouselMedia=(props[i]&&props[i].multimedia)||[];
  carouselIndex=0;
  // Reset Ask state so next open re-indexes docs for this property.
  // Abort any in-progress synthesis stream for the previous property.
  try {
    if(__docsQa.abortCtrl){__docsQa.abortCtrl.abort();__docsQa.abortCtrl=null;}
    __docsQa.currentIndexKey=null;
    if(__docsQa.messages){
      __docsQa.messages.innerHTML='<div class="ask-msg assistant">Switched to '+escapeText((props[i]&&props[i].name)||"property")+'. Ask me something.</div>';
    }
    if(__docsQa.initPromise&&window.__ASK_HAS_DOCS__){ __dqaRebuildIndex(i); }
  } catch(_e){}
}
try {
  props.forEach(function(p,i){
    var btn=document.createElement("button");
    btn.className="tab"+(i===0?" active":"");
    btn.textContent=p.name;
    btn.onclick=function(){load(i)};
    if(tabsEl) tabsEl.appendChild(btn);
  });
  if(props.length>1&&tabsEl) tabsEl.classList.add("multi");
} catch(_e){}
// Critical bootstrap: ensure the Matterport iframe gets its src even if
// later HUD/Ask wiring throws. Run this BEFORE the full load(0) so the
// 3D tour is visible the moment the user dismisses the gate.
try { if(props.length>0&&frame&&props[0]) frame.src=props[0].iframeUrl; } catch(_e){}
try { if(props.length>0) load(0); } catch(_e){ console.error("[presentation] load(0) failed",_e); }

// Pre-warm the Ask pipeline after the Matterport iframe has finished
// its initial load. Gated on the panel actually existing so tours
// without QA or doc extractions skip the ~23 MB model download.
// requestIdleCallback keeps the work off the critical path; a short
// setTimeout covers browsers (Safari) that haven't shipped it yet.
function __dqaPrewarm(){
  if(!document.getElementById("ask-panel")) return;
  __dqaInit().catch(function(err){console.warn("ask prewarm failed:",err);});
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
