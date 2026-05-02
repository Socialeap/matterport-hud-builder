import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assembleAskRuntimeJS } from "./portal/ask-runtime-assembler";
import { getLiveSessionRuntimeJS } from "./portal/live-session-source";
import {
  encryptConfigForExport,
  PROTECTED_MIN_PASSWORD_LEN,
  PROTECTED_PBKDF2_ITERATIONS,
  type ProtectedConfigBlob,
} from "./portal/protected-export";

// Assembled Ask AI runtime JS — built once per process from the three
// .mjs modules (intents, property-brain, logic). Injected verbatim into
// the outer IIFE of the generated presentation, where all symbols
// become locals. See src/lib/portal/ask-runtime-assembler.ts.
const ASK_RUNTIME_JS = assembleAskRuntimeJS();

// Live Guided Tour PeerJS controller, same injection pattern: read the
// vanilla .mjs verbatim (?raw), strip the trailing export, scan for
// browser-unsafe tokens, then interpolate inside the runtime IIFE so
// `createLiveSession` becomes a local symbol.
const LIVE_SESSION_RUNTIME_JS = getLiveSessionRuntimeJS();

interface SavePresentationMediaAsset {
  id: string;
  kind: "video" | "photo" | "gif";
  visible: boolean;
  label?: string;
  filename?: string;
  proxyUrl?: string;
  embedUrl?: string;
}

interface SavePresentationLiveTourStop {
  id: string;
  name: string;
  ss: string;
  sr: string;
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
    liveTourStops?: SavePresentationLiveTourStop[];
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
  /**
   * Optional password-gate metadata. The plaintext password itself is
   * NEVER part of this payload — it travels exclusively on
   * `generatePresentation` as a transient field and is never persisted
   * (see `GeneratePresentationInput.password`).
   */
  access?: {
    passwordProtected: boolean;
    passwordHint: string;
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

    // Block self-checkout: an MSP (or admin viewing as the provider) must
    // not purchase their own presentation through the client checkout.
    if (access?.viewer_matches_provider) {
      return {
        success: false,
        error: "You are signed in as the Studio owner. Sign in with a client account to purchase.",
      };
    }

    // Free invitees (linked with is_free=true) skip pricing/payouts checks
    // because the charge is bypassed downstream in create-connect-checkout.
    // Everyone else (any signed-in client/agent) is welcome to build & pay,
    // but only if the MSP has finished pricing + Stripe Connect onboarding.
    const isFree = access?.is_free === true;
    if (!isFree) {
      if (!access?.pricing_configured) {
        return {
          success: false,
          error: "This Studio has not finished setting up pricing yet. Please contact the provider.",
        };
      }
      if (!access?.payouts_ready) {
        return {
          success: false,
          error: "This Studio has not finished setting up payments yet. Please contact the provider.",
        };
      }
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
          // Password-gate metadata only — the plaintext password is NEVER
          // included here. Hint text is shown on the gate before unlock,
          // so it stays plaintext.
          access: data.access
            ? {
                passwordProtected: !!data.access.passwordProtected,
                passwordHint: String(data.access.passwordHint || "").slice(0, 120),
              }
            : { passwordProtected: false, passwordHint: "" },
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

/**
 * Refresh the persisted config for an existing saved_model so the next
 * `generatePresentation` call sees the latest builder state (properties,
 * behaviors, agent, branding overrides, enhancements). Caller must own
 * the row (RLS enforces this via client_id).
 *
 * This exists because clients sometimes change Sound Library / agent /
 * branding selections AFTER first save and before re-generating their
 * HTML — without this refresh, those changes never reach the generator.
 */
export const refreshPresentationConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: SavePresentationInput & { modelId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("saved_models")
      .update({
        properties: data.properties as unknown as import("@/integrations/supabase/types").Json,
        tour_config: {
          behaviors: data.tourConfig,
          agent: data.agent,
          brandingOverrides: data.brandingOverrides,
          enhancements: data.enhancements ?? {},
          access: data.access
            ? {
                passwordProtected: !!data.access.passwordProtected,
                passwordHint: String(data.access.passwordHint || "").slice(0, 120),
              }
            : { passwordProtected: false, passwordHint: "" },
        } as unknown as import("@/integrations/supabase/types").Json,
        model_count: data.properties.filter((p) => p.matterportId.trim()).length,
      })
      .eq("id", data.modelId)
      .eq("client_id", userId);
    if (error) {
      console.error("refreshPresentationConfig failed:", error);
      return { success: false, error: "Could not refresh saved presentation" };
    }
    return { success: true };
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

export const getApprovedFreePresentationDownload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { providerId: string }) => data)
  .handler(async ({ data, context }): Promise<{ modelId: string | null; error: string | null }> => {
    const { supabase, userId } = context;

    const { data: model, error } = await supabase
      .from("saved_models")
      .select("id")
      .eq("client_id", userId)
      .eq("provider_id", data.providerId)
      .eq("status", "paid")
      .eq("is_released", true)
      .eq("amount_cents", 0)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return { modelId: null, error: error.message };
    }

    return { modelId: model?.id ?? null, error: null };
  });

interface PropertyMediaAsset {
  id: string;
  kind: "video" | "photo" | "gif";
  visible: boolean;
  label?: string;
  proxyUrl?: string;
  embedUrl?: string;
}

interface PropertyLiveTourStop {
  id: string;
  name: string;
  ss: string;
  sr: string;
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
  liveTourStops?: PropertyLiveTourStop[];
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
  /**
   * Password-gate metadata persisted in saved_models.tour_config.
   * Plaintext password is NEVER stored here — only the on/off flag and
   * the publicly-displayed hint string. The actual password is supplied
   * fresh on each `generatePresentation` call by the Builder.
   */
  access?: {
    passwordProtected?: boolean;
    passwordHint?: string;
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

function normalizeEmailForMailto(value: unknown): string {
  const email = String(value ?? "")
    .trim()
    .replace(/^mailto:/i, "")
    .split("?")[0]
    .trim();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email) ? email : "";
}

// Encryption helpers + iteration count come from
// ./portal/protected-export. Keeping them in their own module lets the
// round-trip test exercise the AES-GCM/PBKDF2 plumbing without dragging
// in TanStack Start server-fn imports.
void PROTECTED_PBKDF2_ITERATIONS;

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
.ask-inquiry-send{background:${escapeHtml(accentColor)};border:none;color:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}
.ask-inquiry-send[aria-disabled="true"]{opacity:0.5;cursor:not-allowed;pointer-events:none}
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
  .inputValidator(
    (data: {
      modelId: string;
      qaDatabase?: QADatabaseEntry[];
      // Transient password supplied per-request when the agent has armed
      // the password gate. Never logged, never persisted, never echoed
      // back to the client. Stays in memory only for the duration of
      // this handler invocation.
      password?: string;
    }) => data,
  )
  .handler(async ({ data, context }): Promise<{ success: boolean; html?: string; error?: string; askAiWarning?: string }> => {
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

        // Sanitize Live Guided Tour bookmarks: keep only entries that have a
        // non-empty `ss` (sweep id is required to teleport). Empty array is
        // emitted as `[]` so the runtime can branch on `.length` cheaply.
        const liveTourStops = (p.liveTourStops ?? [])
          .filter(
            (s): s is PropertyLiveTourStop =>
              !!s && typeof s.ss === "string" && s.ss.trim().length > 0,
          )
          .map((s) => ({
            id: String(s.id || ""),
            name: String(s.name || "").trim() || "Untitled stop",
            ss: String(s.ss).trim(),
            sr: String(s.sr || "").trim(),
          }));

        return {
          name: p.name || "Untitled",
          propertyName: p.propertyName || "",
          location: p.location || "",
          iframeUrl: buildMatterportUrlServer(p.matterportId, behavior),
          musicUrl: resolvedMusicUrl,
          cinematicVideoUrl: p.cinematicVideoUrl || "",
          enableNeighborhoodMap: !!(p.enableNeighborhoodMap && (p.location || "").trim()),
          multimedia,
          liveTourStops,
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

    // ── Password-gate state resolution ───────────────────────────────
    // The toggle + hint travel via tour_config.access; the plaintext
    // password is supplied per-request and is never persisted. Treat
    // protection as ARMED only when both the toggle is on AND the
    // request carried a long-enough password. Defense in depth: the
    // Builder applies the same rule client-side, but we re-check here
    // so a malformed request can never silently produce an unprotected
    // file when the agent thought one was protected.
    const accessConfig = (tourConfig.access || {}) as TourConfigData["access"];
    const wantsProtection = !!accessConfig?.passwordProtected;
    const passwordHint = String(accessConfig?.passwordHint || "").slice(0, 120);
    const submittedPassword = typeof data.password === "string" ? data.password : "";
    if (wantsProtection && submittedPassword.length < PROTECTED_MIN_PASSWORD_LEN) {
      return {
        success: false,
        error: `Enter a password of at least ${PROTECTED_MIN_PASSWORD_LEN} characters to protect this download.`,
      };
    }
    const protectionArmed = wantsProtection && submittedPassword.length >= PROTECTED_MIN_PASSWORD_LEN;

    // Base64-encode config for obfuscation
    const gaTrackingId = typeof agent.gaTrackingId === "string" ? agent.gaTrackingId.trim() : "";
    const agentAvatarUrl = typeof agent.avatarUrl === "string" ? agent.avatarUrl.trim() : "";

    // Public preamble vs. secret config split. The preamble is what the
    // visitor's browser sees BEFORE unlocking — strictly the brand chrome
    // needed to render the gate. Everything else (property data, agent
    // contact, multimedia URLs, propertyUuidByIndex, GA tracking ID,
    // studioId) sits inside `secretConfig` and is encrypted when
    // protection is armed. Unprotected exports merge both halves into a
    // single base64 blob — byte-for-byte identical to the pre-feature
    // shape, so existing tours stay binary-stable.
    const publicPreamble = {
      brandName,
      accentColor,
      hudBgColor,
      gateLabel,
      logoUrl,
    };
    const secretConfig = {
      properties: propertyEntries,
      agent,
      propertyUuidByIndex,
      gaTrackingId,
      agentAvatarUrl,
      studioId,
    };

    let configB64 = "";
    let protectedBlob: ProtectedConfigBlob | null = null;
    if (protectionArmed) {
      // Encrypted path: the runtime's __configReady gate consumes the
      // blob alongside the public preamble at unlock time. configB64
      // emits as the empty string so a view-source on the file shows
      // only ciphertext + preamble — no leakage of property data.
      try {
        protectedBlob = await encryptConfigForExport(secretConfig, submittedPassword);
      } catch (err) {
        console.error(
          "[generatePresentation] password encryption failed:",
          err instanceof Error ? err.message : err,
        );
        return {
          success: false,
          error: "Could not encrypt this presentation. Please try again or contact support.",
        };
      }
    } else {
      // Unprotected path — historical shape: a single base64 blob with
      // the merged public + secret config. The runtime decoder treats
      // this as the canonical "C" object.
      const configObj = { ...publicPreamble, ...secretConfig };
      configB64 = Buffer.from(JSON.stringify(configObj)).toString("base64");
    }
    // Base64 of the public preamble — used in both branches by the
    // pre-bootstrap script so the gate can render brand chrome before
    // (or instead of) decryption.
    const publicPreambleB64 = Buffer.from(JSON.stringify(publicPreamble)).toString("base64");

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

    // Token-mint policy. Three states, and each ships a working HTML:
    //   1. Token env not configured (no PRESENTATION_TOKEN_SECRET or no
    //      service-role key) → skip mint, ship in deterministic-only
    //      mode (no __SYNTHESIS_URL__, no __PRESENTATION_TOKEN__). The
    //      visitor's Ask AI panel uses the local canonical/curated/chunk
    //      ladder — same path the runtime used before the synthesis
    //      bridge existed. Operator gets a non-blocking warning toast.
    //   2. Token env configured + mint succeeds → full Ask AI with the
    //      Gemini synthesis path.
    //   3. Token env configured + mint throws (DB / network failure)
    //      → throw with a friendly message. This is an operational bug
    //      the operator needs to see, not a silent degradation.
    //
    // The conditional injection of __SYNTHESIS_URL__ alongside the token
    // (further below) keeps the runtime's `canSynthesize` flag in sync:
    // synthesis is only attempted when both the URL and the token are
    // present, so we never ship an HTML that 401-loops on every query.
    const tokenSecret = (process.env.PRESENTATION_TOKEN_SECRET ?? "").trim();
    const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
    const tokenEnvReady = tokenSecret.length >= 32 && serviceRole.length > 0;

    let presentationToken = "";
    let askAiWarning: string | null = null;
    if (_supabaseOrigin && tokenEnvReady) {
      try {
        const { ensurePresentationToken } = await import(
          "./presentation-token-server"
        );
        const issued = await ensurePresentationToken(model.id);
        presentationToken = issued.value;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          "[generatePresentation] token mint failed despite env being set:",
          msg,
        );
        throw new Error(
          "Ask AI couldn't be set up for this export. Please contact support and reference: token issuance failed.",
        );
      }
    } else if (_supabaseOrigin) {
      // Env missing — log once at the server, surface a soft warning to
      // the builder UI. This is the path that lets exports keep flowing
      // for operators who haven't yet configured Ask AI auth.
      console.warn(
        "[generatePresentation] Ask AI token env not configured " +
          "(PRESENTATION_TOKEN_SECRET / SUPABASE_SERVICE_ROLE_KEY missing). " +
          "Shipping HTML in deterministic-ladder-only mode.",
      );
      askAiWarning =
        "Ask AI is in limited mode for this export — visitor questions will be answered from the local Q&A database only. Configure Ask AI in your environment to enable smart answers.";
    }

    // Synthesis URL is gated on the token: when no token was minted,
    // omit the URL too so the runtime's `canSynthesize` flag is false
    // and the deterministic ladder runs end-to-end (instead of every
    // query 401-looping through synthesize-answer).
    const synthesisUrl = (_supabaseOrigin && presentationToken)
      ? `${_supabaseOrigin}/functions/v1/synthesize-answer`
      : "";

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

    const agentEmailForMailto = normalizeEmailForMailto(agent.email);
    const agentHasEmail = agentEmailForMailto.length > 0;
    const agentFirstName = (String(agent.name || "").trim().split(/\s+/)[0]) || "agent";
    const hasAgentContact = Boolean(agent.phone || agentHasEmail || agent.name);

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
.gate-btn-primary:disabled{opacity:0.55;cursor:wait;transform:none}
.gate-btn-secondary{padding:11px 28px;font-size:14px;font-weight:500;border:1px solid rgba(255,255,255,0.25);border-radius:10px;cursor:pointer;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.8);transition:opacity 0.2s,background 0.2s}
.gate-btn-secondary:hover{background:rgba(255,255,255,0.14)}
/* ── Password gate (only rendered when the export was protected) ─ */
#gate-password-form{display:flex;flex-direction:column;gap:10px;width:100%}
#gate-password-input{width:100%;padding:12px 14px;font-size:15px;border-radius:10px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;outline:none;font-family:inherit}
#gate-password-input:focus{border-color:${escapeHtml(accentColor)}}
#gate-password-input::placeholder{color:rgba(255,255,255,0.4)}
#gate-password-hint{font-size:12px;color:rgba(255,255,255,0.55);line-height:1.4;margin:-2px 2px 0;text-align:left;white-space:pre-wrap}
#gate-password-error{font-size:12px;color:#ff8a8a;min-height:14px;text-align:left;margin:-2px 2px 0}
#gate-password-spinner{font-size:12px;color:rgba(255,255,255,0.65);text-align:center;margin-top:4px}
#gate-unsupported{font-size:13px;color:rgba(255,255,255,0.85);background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:14px 16px;line-height:1.5;text-align:left;margin-top:10px}

/* ── Viewer (full-screen iframe) ──────────────────────────────────── */
#viewer{position:fixed;inset:0;bottom:0}
#viewer iframe{width:100%;height:100%;border:none}

/* ── HUD header (top glassmorphism overlay) ──────────────────────── */
#hud-header{position:fixed;top:0;left:0;right:0;z-index:1200;transform:translateY(-100%);opacity:0;pointer-events:none;transition:transform 0.3s ease,opacity 0.3s ease;will-change:transform,opacity;isolation:isolate;-webkit-backface-visibility:hidden;backface-visibility:hidden}
#hud-header.visible{transform:translateY(0);opacity:1;pointer-events:auto}
#hud-inner{display:grid;grid-template-columns:220px minmax(0,1fr) auto;align-items:center;gap:12px;padding:10px 16px;background:${escapeHtml(hudBgColor)}99;backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border-bottom:1px solid rgba(255,255,255,0.08);box-shadow:0 4px 24px rgba(0,0,0,0.15),inset 0 1px 0 rgba(255,255,255,0.06)}
#hud-left-spacer{min-width:0}
#hud-center{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-width:0;gap:2px}
#hud-logo{height:30px;max-width:160px;object-fit:contain;flex-shrink:0;margin-bottom:2px}
#hud-brand{font-size:13px;font-weight:600;color:#fff;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 3px rgba(0,0,0,0.4)}
#hud-prop-loc{font-size:11px;color:rgba(255,255,255,0.75);max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#hud-right{display:flex;align-items:center;gap:6px;flex-shrink:0;margin-right:32px;justify-self:end}
@media(max-width:720px){#hud-inner{grid-template-columns:0 minmax(0,1fr) auto;gap:8px}#hud-left-spacer{display:none}#hud-logo{height:26px;max-width:120px}}
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
#hud-toggle{position:fixed;top:8px;right:8px;z-index:1300;width:24px;height:24px;border-radius:50%;background:rgba(255,255,255,0.18);border:none;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background 0.2s;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
#hud-toggle:hover{background:rgba(255,255,255,0.28)}
#hud-toggle svg{width:12px;height:12px}
/* ── Leave-session pill (live tour only; hidden until connected) ─── */
#hud-leave-btn{position:fixed;top:8px;right:40px;z-index:1300;height:24px;padding:0 10px;border-radius:999px;background:rgba(255,255,255,0.18);border:none;color:#fff;font:600 11px/1 system-ui,-apple-system,sans-serif;letter-spacing:0.02em;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background 0.2s,color 0.2s;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
#hud-leave-btn:hover{background:rgba(220,38,38,0.85);color:#fff}
#hud-leave-btn[hidden]{display:none}

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
.drawer-action-button{width:100%;border:none;font-family:inherit;text-align:left;cursor:pointer}
.drawer-action-copy{justify-content:center;border:1px solid rgba(255,255,255,0.14);background:transparent;color:rgba(255,255,255,0.82);font-size:11px;padding:7px 10px}
.drawer-action-copy:hover{background:rgba(255,255,255,0.1)}
.drawer-social-label{font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.4);margin-bottom:6px}
.drawer-social-pills{display:flex;flex-wrap:wrap;gap:6px}
.social-pill{display:inline-flex;align-items:center;border-radius:999px;background:rgba(255,255,255,0.1);padding:4px 10px;font-size:11px;font-weight:500;color:#fff;text-decoration:none;transition:background 0.2s}
.social-pill:hover{background:rgba(255,255,255,0.18)}
/* ── Quick-message (Ask a question) section in contact drawer ─── */
.drawer-quickmsg{margin-top:14px;border-top:1px solid rgba(255,255,255,0.08);padding-top:12px;margin-bottom:14px}
.drawer-quickmsg-label{font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.4);margin-bottom:6px}
.drawer-qchips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.drawer-qchip{border:none;cursor:pointer;border-radius:999px;background:rgba(255,255,255,0.1);color:#fff;padding:5px 10px;font-size:11px;font-weight:500;transition:background 0.2s,opacity 0.2s}
.drawer-qchip:hover{background:rgba(255,255,255,0.18)}
.drawer-qchip.active{background:${escapeHtml(accentColor)}}
.drawer-qfield{width:100%;box-sizing:border-box;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#fff;padding:8px 10px;font-size:12px;margin-bottom:6px;font-family:inherit;outline:none}
.drawer-qfield::placeholder{color:rgba(255,255,255,0.4)}
.drawer-qfield:focus{border-color:${escapeHtml(accentColor)}}
.drawer-qtextarea{min-height:72px;resize:vertical}
.drawer-qsend-row{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}
.drawer-qsend{flex:1 1 auto;min-width:110px;border:none;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:600;color:#fff;cursor:pointer;text-decoration:none;text-align:center;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:opacity 0.2s,background 0.2s}
.drawer-qsend.primary{background:${escapeHtml(accentColor)}}
.drawer-qsend.secondary{background:rgba(255,255,255,0.15)}
.drawer-qsend.secondary:hover{background:rgba(255,255,255,0.25)}
.drawer-qsend:hover{opacity:0.9}
.drawer-qsend[aria-disabled="true"]{opacity:0.45;pointer-events:none}
.drawer-qcopy{background:transparent;border:1px solid rgba(255,255,255,0.18);color:rgba(255,255,255,0.85);border-radius:8px;padding:7px 10px;font-size:11px;font-weight:500;cursor:pointer;transition:background 0.2s}
.drawer-qcopy:hover{background:rgba(255,255,255,0.1)}
.drawer-qstatus{font-size:11px;color:rgba(255,255,255,0.55);margin-top:6px;min-height:14px}

/* ── Live Guided Tour drawer section ──────────────────────────────── */
.drawer-live-guide{margin-top:14px;border-top:1px solid rgba(255,255,255,0.08);padding-top:12px;margin-bottom:14px}
.drawer-live-guide-label{font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.4);margin-bottom:8px}
.lg-row{display:flex;gap:6px;margin-bottom:6px}
.lg-input{flex:1;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:rgba(255,255,255,0.08);color:#fff;padding:7px 10px;font-size:13px;outline:none;font-family:inherit;letter-spacing:0.18em;text-align:center;font-variant-numeric:tabular-nums}
.lg-input:focus{border-color:${escapeHtml(accentColor)}}
.lg-input::placeholder{color:rgba(255,255,255,0.4);letter-spacing:normal}
.lg-btn{border:none;cursor:pointer;border-radius:6px;padding:7px 12px;font-size:12px;font-weight:600;color:#fff;transition:opacity 0.2s,background 0.2s;font-family:inherit;white-space:nowrap}
.lg-btn.primary{background:${escapeHtml(accentColor)}}
.lg-btn.primary:hover{opacity:0.85}
.lg-btn:disabled{opacity:0.45;cursor:not-allowed}
.lg-status{font-size:11px;color:rgba(255,255,255,0.6);margin:6px 0 8px;min-height:14px;line-height:1.4}
.lg-link{background:transparent;border:none;color:rgba(255,255,255,0.55);font-size:11px;cursor:pointer;padding:4px 0;font-family:inherit;text-decoration:underline}
.lg-link:hover{color:rgba(255,255,255,0.85)}
.lg-pin-display{background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;text-align:center;margin-bottom:8px}
.lg-pin-label{font-size:10px;color:rgba(255,255,255,0.55);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px}
.lg-pin-value{font-size:26px;font-weight:700;color:#fff;letter-spacing:0.2em;font-variant-numeric:tabular-nums}
.lg-stops-label{font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.4);margin:8px 0 6px}
.lg-stops{display:flex;flex-direction:column;gap:4px}
.lg-stop-btn{border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#fff;border-radius:6px;padding:8px 10px;font-size:12px;font-weight:500;cursor:pointer;text-align:left;transition:background 0.2s;font-family:inherit}
.lg-stop-btn:hover:not(:disabled){background:rgba(255,255,255,0.14)}
.lg-stop-btn:disabled{opacity:0.45;cursor:not-allowed}
.lg-stops-empty{font-size:11px;color:rgba(255,255,255,0.5);font-style:italic}

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
<!-- PeerJS UMD bundle (loaded via CDN). Loaded with the defer
     attribute so it is available before the main IIFE runs but does
     not block initial HTML parsing. The exposed Peer global is
     consumed by the Live Guided Tour controller interpolated below.
     Failure to load (network, blocked CDN) is tolerated:
     createLiveSession returns a friendly error state instead of
     throwing, and the rest of the tour still works. -->
<script src="https://unpkg.com/peerjs@1.5/dist/peerjs.min.js" crossorigin="anonymous" defer></script>
</head>
<body>

<!-- ── Welcome / sound gate ─────────────────────────────────────── -->
<div id="gate">
  <div id="gate-inner">
    ${logoUrl ? `<img class="gate-logo" src="${escapeHtml(logoUrl)}" alt="Logo">` : ""}
    <h1>${escapeHtml(brandName)}</h1>
    <div class="gate-subtitle">${escapeHtml(model.name || "")}</div>
    ${protectionArmed ? `<form id="gate-password-form" autocomplete="off">
      <input type="password" id="gate-password-input" name="presentation-access" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Password" aria-label="Presentation password" required>
      ${passwordHint ? `<div id="gate-password-hint">${escapeHtml(passwordHint)}</div>` : ""}
      <button type="submit" class="gate-btn-primary" id="gate-password-submit">${escapeHtml(gateLabel || "Unlock")}</button>
      <div id="gate-password-error" role="alert" aria-live="polite"></div>
      <div id="gate-password-spinner" hidden>Unlocking…</div>
    </form>
    <div id="gate-unsupported" hidden>This protected presentation requires a modern browser (Chrome, Firefox, Safari 11+, Edge).</div>` : `<div class="gate-actions">
      <button class="gate-btn-primary" id="gate-sound-btn">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
        Start with Sound
      </button>
      <button class="gate-btn-secondary" id="gate-silent-btn">${escapeHtml(gateLabel)} (No Sound)</button>
    </div>`}
  </div>
</div>

<!-- ── Matterport iframe ─────────────────────────────────────────── -->
<div id="viewer"><iframe id="matterport-frame" allowfullscreen allow="xr-spatial-tracking; fullscreen"></iframe></div>

<!-- ── HUD toggle button ─────────────────────────────────────────── -->
<button id="hud-leave-btn" hidden aria-label="Leave live tour" title="Leave Live Tour">Leave</button>
<button id="hud-toggle" aria-label="Toggle header">
  <svg id="hud-chevron-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:none"><polyline points="18 15 12 9 6 15"/></svg>
  <svg id="hud-chevron-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
</button>

<!-- ── HUD top header ─────────────────────────────────────────────── -->
<div id="hud-header">
  <div id="hud-inner">
    <div id="hud-left-spacer" aria-hidden="true"></div>
    <div id="hud-center">
      ${logoUrl ? `<img id="hud-logo" src="${escapeHtml(logoUrl)}" alt="Logo">` : ""}
      <div id="hud-brand">${escapeHtml(brandName)}</div>
      <div id="hud-prop-loc"></div>
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
      ${hasAgentContact ? `<button class="hud-contact-btn" onclick="window.__openContact&&window.__openContact()">Contact</button>` : ""}
    </div>
  </div>
</div>

<!-- ── Property tabs (top-left, shown only when >1 property) ─────── -->
<div id="tabs"></div>

<!-- (Bottom toolbar removed: Ask AI / Ask docs are now in the HUD header to keep the Matterport logo unobstructed.) -->

<!-- ── Agent contact panel ───────────────────────────────────────── -->
${hasAgentContact ? `<div id="agent-drawer">
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
    ${agent.phone ? `<div class="drawer-actions">
      ${agent.phone ? `<a href="tel:${escapeHtml(String(agent.phone))}" class="drawer-action-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.61a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 16l.19.92z"/></svg>Call ${escapeHtml(String(agent.phone))}</a>` : ""}
      ${agent.phone ? `<a href="sms:${escapeHtml(String(agent.phone))}" class="drawer-action-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Text ${escapeHtml(String(agent.phone))}</a>` : ""}
    </div>` : ""}
    ${(agentHasEmail || agent.phone) ? `<div class="drawer-quickmsg" id="drawer-quickmsg">
      <div class="drawer-quickmsg-label">Ask a quick question</div>
      <div class="drawer-qchips" id="drawer-qchips" role="group" aria-label="Question templates"></div>
      <textarea class="drawer-qfield drawer-qtextarea" id="drawer-qmsg" rows="4" placeholder="Type your question, or pick a topic above…" aria-label="Your message"></textarea>
      <input type="email" class="drawer-qfield" id="drawer-qemail" placeholder="Your email (so we can reply)" autocomplete="email" aria-label="Your email">
      <div class="drawer-qsend-row">
        ${agentHasEmail ? `<a id="drawer-qsend-email" class="drawer-qsend primary" href="#" aria-disabled="true" role="button" target="_blank" rel="noopener">Email ${escapeHtml(agentFirstName)}</a>` : ""}
        ${agent.phone ? `<a id="drawer-qsend-sms" class="drawer-qsend secondary" href="#" aria-disabled="true" role="button">Text ${escapeHtml(agentFirstName)}</a>` : ""}
        <button type="button" id="drawer-qcopy" class="drawer-qcopy" aria-disabled="true">Copy</button>
      </div>
      <div class="drawer-qstatus" id="drawer-qstatus" aria-live="polite"></div>
    </div>` : ""}
    <!-- ── Live Guided Tour ───────────────────────────────────────
         Visitor pane is the default. Agents click the "I'm the agent"
         link to flip into the agent pane. Both panes share the same
         underlying createLiveSession() controller — only one role can
         be active at a time per device. -->
    <div class="drawer-live-guide" id="drawer-live-guide">
      <div class="drawer-live-guide-label">Live Guided Tour</div>
      <div id="lg-visitor">
        <div class="lg-row">
          <input type="text" id="lg-pin-input" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="PIN" class="lg-input" aria-label="Live tour PIN" autocomplete="off">
          <button type="button" id="lg-join-btn" class="lg-btn primary">Join Live Tour</button>
        </div>
        <div class="lg-status" id="lg-visitor-status" aria-live="polite"></div>
        <button type="button" id="lg-toggle-agent" class="lg-link">I&rsquo;m the agent &rarr;</button>
      </div>
      <div id="lg-agent" hidden>
        <div id="lg-agent-prejoin">
          <button type="button" id="lg-start-btn" class="lg-btn primary" style="width:100%">Start as Agent</button>
          <div class="lg-status">Generates a 4-digit PIN for your visitor.</div>
          <button type="button" id="lg-toggle-visitor" class="lg-link">&larr; Back to visitor view</button>
        </div>
        <div id="lg-agent-active" hidden>
          <div class="lg-pin-display">
            <div class="lg-pin-label">Share this PIN with your visitor</div>
            <div class="lg-pin-value" id="lg-pin-value">&mdash;&mdash;&mdash;&mdash;</div>
          </div>
          <div class="lg-status" id="lg-agent-status" aria-live="polite"></div>
          <div class="lg-stops-label">Tour Stops</div>
          <div class="lg-stops" id="lg-stops"></div>
        </div>
      </div>
    </div>
    ${socialLinksHtml ? `<div class="drawer-social-label">Social</div><div class="drawer-social-pills">${socialLinksHtml}</div>` : ""}
  </div>
</div>
<!-- Hidden audio sink for the Live Guided Tour voice channel. Lives
     outside the drawer so the offscreen translateX transform on the
     drawer can never inadvertently mute playback in any browser. -->
<audio id="lg-audio" autoplay style="display:none"></audio>` : ""}

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
${protectionArmed ? `<script>window.__PROTECTED__=true;window.__PROTECTED_BLOB__=${safeJsonScriptLiteral(protectedBlob)};${passwordHint ? `window.__PROTECTED_HINT__=${JSON.stringify(passwordHint)};` : ""}</script>` : ""}
${askAssets.moduleScript}
<!-- ── Pre-bootstrap safety net ────────────────────────────────────────
     This tiny script runs BEFORE the main IIFE. If the main IIFE later
     fails to parse (e.g. a future template-literal bug), the gate
     buttons still dismiss the overlay and the Matterport iframe still
     loads its first property, so the 3D tour is never dead-on-arrival.
     The main IIFE re-binds the same handlers; addEventListener stacks
     them harmlessly.

     When window.__PROTECTED__ is true, this bootstrap also defers
     iframe loading until the visitor unlocks the gate with the correct
     password. window.__configReady is the rendezvous: it resolves with
     the merged config object the moment decryption succeeds, and the
     main IIFE awaits it before touching any property data. -->
<script>
(function(){
  try {
    var preambleB64=${JSON.stringify(publicPreambleB64)};
    var preamble=JSON.parse(atob(preambleB64));
    var isProtected=!!window.__PROTECTED__;
    var configResolve;
    var configReject;
    window.__configReady=new Promise(function(res,rej){configResolve=res;configReject=rej;});

    var frame=document.getElementById("matterport-frame");

    var cfg=null;
    var hasAnyAudio=false;
    if(!isProtected){
      var raw=${JSON.stringify(configB64)};
      cfg=JSON.parse(atob(raw));
      var first=(cfg.properties&&cfg.properties[0])||null;
      if(frame&&first&&first.iframeUrl){ frame.src=first.iframeUrl; }
      try {
        var pp=(cfg&&cfg.properties)||[];
        for(var i=0;i<pp.length;i++){
          var u=String(pp[i]&&pp[i].musicUrl||"").trim();
          if(u){ hasAnyAudio=true; break; }
        }
      } catch(_e){}
      // Resolve immediately so the main IIFE can run synchronously
      // through its .then() callback (microtask).
      configResolve(cfg);
    }

    // Early HUD wiring — independent of the heavy main IIFE so the
    // toggle and chevrons always work, even if Ask AI / extraction
    // bundles fail to load. The main IIFE replaces these handlers
    // additively (addEventListener stacks).
    var hudHeader=document.getElementById("hud-header");
    var hudToggle=document.getElementById("hud-toggle");
    var chevUp=document.getElementById("hud-chevron-up");
    var chevDown=document.getElementById("hud-chevron-down");
    var hudVisible=false;
    function setHudVisible(v){
      hudVisible=!!v;
      if(hudHeader){
        hudHeader.classList.toggle("visible",hudVisible);
        // Inline-style fallback in case the .visible class rule is
        // overridden by an unexpected stylesheet ordering issue.
        hudHeader.style.transform=hudVisible?"translateY(0)":"translateY(-100%)";
        hudHeader.style.opacity=hudVisible?"1":"0";
        hudHeader.style.pointerEvents=hudVisible?"auto":"none";
      }
      if(chevUp) chevUp.style.display=hudVisible?"":"none";
      if(chevDown) chevDown.style.display=hudVisible?"none":"";
    }
    // Expose globally so the main IIFE can reuse it instead of shadowing.
    window.__setHudVisible=setHudVisible;
    window.__isHudVisible=function(){return hudVisible;};
    if(hudToggle){
      hudToggle.addEventListener("click",function(){ setHudVisible(!hudVisible); });
    }

    function hideGate(openHud){
      var g=document.getElementById("gate");
      if(g){ g.classList.add("hidden"); setTimeout(function(){g.style.display="none";},500); }
      if(openHud!==false) setHudVisible(true);
    }

    if(isProtected){
      // Password gate path. Defer all property data, iframe src, and
      // audio bootstrap until the visitor's password successfully
      // decrypts window.__PROTECTED_BLOB__. The main IIFE awaits
      // window.__configReady before reading any of that.
      var formEl=document.getElementById("gate-password-form");
      var inputEl=document.getElementById("gate-password-input");
      var submitEl=document.getElementById("gate-password-submit");
      var errorEl=document.getElementById("gate-password-error");
      var spinnerEl=document.getElementById("gate-password-spinner");
      var unsupportedEl=document.getElementById("gate-unsupported");
      var subtle=(window.crypto&&window.crypto.subtle)||null;
      if(!subtle){
        if(formEl) formEl.style.display="none";
        if(unsupportedEl) unsupportedEl.hidden=false;
        configReject(new Error("Web Crypto Subtle unavailable in this browser."));
      } else if(formEl){
        function b64ToBytes(b64){
          var bin=atob(b64);
          var out=new Uint8Array(bin.length);
          for(var i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
          return out;
        }
        async function unlock(password){
          var blob=window.__PROTECTED_BLOB__||{};
          var enc=new TextEncoder();
          var baseKey=await subtle.importKey(
            "raw", enc.encode(password), {name:"PBKDF2"}, false, ["deriveKey"]
          );
          var aesKey=await subtle.deriveKey(
            {name:"PBKDF2",salt:b64ToBytes(blob.salt||""),iterations:blob.iter|0||600000,hash:"SHA-256"},
            baseKey,
            {name:"AES-GCM",length:256},
            false,
            ["decrypt"]
          );
          var plaintext=await subtle.decrypt(
            {name:"AES-GCM",iv:b64ToBytes(blob.iv||"")},
            aesKey,
            b64ToBytes(blob.ct||"")
          );
          var json=new TextDecoder().decode(plaintext);
          var secret=JSON.parse(json);
          var merged={};
          for(var k1 in preamble){ if(Object.prototype.hasOwnProperty.call(preamble,k1)) merged[k1]=preamble[k1]; }
          for(var k2 in secret){ if(Object.prototype.hasOwnProperty.call(secret,k2)) merged[k2]=secret[k2]; }
          return merged;
        }
        formEl.addEventListener("submit",function(ev){
          ev.preventDefault();
          var password=String((inputEl&&inputEl.value)||"");
          if(!password){
            if(errorEl) errorEl.textContent="Enter the password to continue.";
            return;
          }
          if(errorEl) errorEl.textContent="";
          if(submitEl) submitEl.disabled=true;
          if(inputEl) inputEl.disabled=true;
          if(spinnerEl) spinnerEl.hidden=false;
          unlock(password).then(function(C){
            if(spinnerEl) spinnerEl.hidden=true;
            // Wire iframe + audio AFTER decrypt: every protected-mode
            // bootstrap path runs through here so the IIFE doesn't have
            // to know it was gated.
            try {
              var first2=(C&&C.properties&&C.properties[0])||null;
              if(frame&&first2&&first2.iframeUrl){ frame.src=first2.iframeUrl; }
            } catch(_e){}
            configResolve(C);
            hideGate(false);
          }).catch(function(err){
            if(spinnerEl) spinnerEl.hidden=true;
            if(submitEl) submitEl.disabled=false;
            if(inputEl){ inputEl.disabled=false; inputEl.value=""; inputEl.focus(); }
            if(errorEl){
              // OperationError = GCM auth tag mismatch = wrong password.
              // Anything else is shown as a generic failure with the
              // raw message in the console for debugging.
              errorEl.textContent=(err&&err.name==="OperationError")
                ?"Incorrect password. Please try again."
                :"Couldn't unlock this presentation. Try a different browser or contact support.";
              if(!(err&&err.name==="OperationError")) console.error("[presentation] unlock failed",err);
            }
          });
        });
        if(inputEl){
          // Clear inline error as the visitor types so the message
          // doesn't linger from the previous wrong attempt.
          inputEl.addEventListener("input",function(){ if(errorEl) errorEl.textContent=""; });
          // Autofocus once the gate is visible.
          setTimeout(function(){ try{ inputEl.focus(); }catch(_e){} },50);
        }
      }
    } else {
      // Unprotected path — same wiring shipped before the password
      // feature: gate buttons + audio CTA labels.
      if(!hasAnyAudio){
        var soundBtn=document.getElementById("gate-sound-btn");
        if(soundBtn){ soundBtn.innerHTML='Enter Tour'; }
        var silentBtn=document.getElementById("gate-silent-btn");
        if(silentBtn){ silentBtn.style.display="none"; }
      }
      var s=document.getElementById("gate-sound-btn");
      var q=document.getElementById("gate-silent-btn");
      if(s) s.addEventListener("click",function(){ hideGate(false); });
      if(q) q.addEventListener("click",function(){ hideGate(false); });
    }
  } catch(err){ console.error("[presentation] safety bootstrap failed",err); }
})();
</script>
<script>
(function(){
// Wait for the safety bootstrap's __configReady promise to resolve. It
// resolves immediately in unprotected mode and on successful unlock in
// protected mode. Either way, the rest of this IIFE runs against a
// fully-formed config object — never partial preamble data.
var __ready=window.__configReady||Promise.resolve(null);
__ready.then(function(C){
if(!C){
  console.error("[presentation] config unavailable — runtime aborted.");
  return;
}
var props=C.properties||[];
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
  var elLoc=document.getElementById("hud-prop-loc");
  var elAgent=document.getElementById("hud-agent-name");
  if(elLoc){
    // Compose "{property name} \u2014 {address} \u2014 {city/state}" but
    // skip any segment that already duplicates the brand name shown above
    // or repeats text already included in another segment.
    var brand=((C&&C.brandName)||"").trim().toLowerCase();
    var pname=(p.propertyName||"").trim();
    var addr=(p.name||"").trim();
    var loc=(p.location||"").trim();
    var parts=[];
    if(pname && pname.toLowerCase()!==brand) parts.push(pname);
    if(addr && addr.toLowerCase()!==brand && addr.toLowerCase()!==pname.toLowerCase()) parts.push(addr);
    if(loc && addr.toLowerCase().indexOf(loc.toLowerCase())===-1 && loc.toLowerCase()!==brand) parts.push(loc);
    elLoc.textContent=parts.join(" \u2014 ");
  }
  if(elAgent) elAgent.textContent=(C.agent&&C.agent.name)?C.agent.name:"";
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

// \u2500\u2500 HUD toggle — delegate to the early-bootstrap global so the
//    inline-style fallbacks and chevron toggling stay consistent even
//    when this main IIFE re-runs after a hot reload.
var hudHeader=document.getElementById("hud-header");
var hudToggle=document.getElementById("hud-toggle");
var chevUp=document.getElementById("hud-chevron-up");
var chevDown=document.getElementById("hud-chevron-down");
var hudVisible=false;
function setHudVisible(v){
  hudVisible=!!v;
  if(typeof window.__setHudVisible==="function"){
    try { window.__setHudVisible(hudVisible); return; } catch(_e){}
  }
  if(hudHeader){
    hudHeader.classList.toggle("visible",hudVisible);
    hudHeader.style.transform=hudVisible?"translateY(0)":"translateY(-100%)";
    hudHeader.style.opacity=hudVisible?"1":"0";
    hudHeader.style.pointerEvents=hudVisible?"auto":"none";
  }
  if(chevUp) chevUp.style.display=hudVisible?"":"none";
  if(chevDown) chevDown.style.display=hudVisible?"none":"";
}
if(hudToggle) hudToggle.addEventListener("click",function(){setHudVisible(!hudVisible);});

// \u2500\u2500 Welcome gate
function dismissGate(){
  var gate=document.getElementById("gate");
  if(gate){gate.classList.add("hidden");setTimeout(function(){gate.style.display="none";},500);}
  setHudVisible(false);
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

// ── Edge email redirect helpers (client-only, no email backend)
var EMAIL_REDIRECTOR_URL="https://polished-sky-f30e.shakoure.workers.dev/";
function sanitizeEmailAddress(value){
  var email=String(value||"").trim().replace(/^mailto:/i,"").split("?")[0].trim();
  return /^[^\\s@<>"]+@[^\\s@<>"]+\\.[^\\s@<>"]+$/.test(email)?email:"";
}
function isValidVisitorEmail(value){
  var email=String(value||"").trim();
  return !email||/^[^\\s@<>"]+@[^\\s@<>"]+\\.[^\\s@<>"]+$/.test(email);
}
function buildEmailRedirectUrl(recipient,subject,body){
  var to=sanitizeEmailAddress(recipient);
  if(!to) return "";
  var subj=String(subject||"Inquiry").replace(/[\\r\\n]+/g," ").trim();
  var msg=String(body||"").trim();
  var url=EMAIL_REDIRECTOR_URL+"#to="+encodeURIComponent(to)+"&subject="+encodeURIComponent(subj)+"&body="+encodeURIComponent(msg);
  while(url.length>7000&&msg.length>200){
    msg=msg.slice(0,Math.max(200,msg.length-500));
    url=EMAIL_REDIRECTOR_URL+"#to="+encodeURIComponent(to)+"&subject="+encodeURIComponent(subj)+"&body="+encodeURIComponent(msg);
  }
  return url;
}
function buildVisitorEmailBody(message,visitorEmail,extraLines){
  var parts=[];
  var email=String(visitorEmail||"").trim();
  if(email) parts.push("From: "+email);
  if(extraLines&&extraLines.length) parts=parts.concat(extraLines);
  parts.push("Message:");
  parts.push(String(message||"").trim());
  return parts.filter(function(part){return String(part||"").trim().length>0;}).join("\\n\\n");
}
function prepareEmailRedirectLink(link,recipient,subject,body,statusEl){
  var url=buildEmailRedirectUrl(recipient,subject,body);
  if(link) link.setAttribute("href",url||"#");
  if(!url&&statusEl) statusEl.textContent="No email address configured.";
  return url;
}
function openEmailRedirect(recipient,subject,body,statusEl){
  var url=buildEmailRedirectUrl(recipient,subject,body);
  if(!url){
    if(statusEl) statusEl.textContent="No email address configured.";
    return false;
  }
  var opened=null;
  var popupW=520;
  var popupH=680;
  var screenLeft=typeof window.screenX==="number"?window.screenX:(window.screenLeft||0);
  var screenTop=typeof window.screenY==="number"?window.screenY:(window.screenTop||0);
  var outerW=window.outerWidth||document.documentElement.clientWidth||screen.availWidth||popupW;
  var outerH=window.outerHeight||document.documentElement.clientHeight||screen.availHeight||popupH;
  var left=Math.max(0,Math.round(screenLeft+(outerW-popupW)/2));
  var top=Math.max(0,Math.round(screenTop+(outerH-popupH)/2));
  var features=[
    "popup=yes",
    "width="+popupW,
    "height="+popupH,
    "left="+left,
    "top="+top,
    "resizable=yes",
    "scrollbars=yes",
    "toolbar=no",
    "menubar=no",
    "location=no",
    "status=no"
  ].join(",");
  try{
    opened=window.open(url,"presentationEmailHandoff",features);
    if(opened){
      try{ opened.opener=null; }catch(_e){}
      try{ opened.focus(); }catch(_e){}
    }
  }catch(_e){}
  if(statusEl) statusEl.textContent="Opening contact options...";
  if(!opened){
    setTimeout(function(){
      copyContactText(
        sanitizeEmailAddress(recipient),
        statusEl,
        "Email address copied to clipboard.",
        "Please use Copy."
      );
    },1000);
    return false;
  }
  return true;
}
async function copyContactText(text,statusEl,okMsg,failMsg){
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){
      await navigator.clipboard.writeText(text);
    }else{
      var ta=document.createElement("textarea");
      ta.value=text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
    }
    if(statusEl) statusEl.textContent=okMsg||"Copied to clipboard.";
    return true;
  }catch(_e){
    if(statusEl) statusEl.textContent=failMsg||"Couldn't copy — please select and copy manually.";
    return false;
  }
}

// ── Quick-message form inside contact drawer ─────────────────────
(function initQuickMsg(){
  var wrap=document.getElementById("drawer-quickmsg");
  if(!wrap) return;
  var chipsEl=document.getElementById("drawer-qchips");
  var msgEl=document.getElementById("drawer-qmsg");
  var emailEl=document.getElementById("drawer-qemail");
  var emailBtn=document.getElementById("drawer-qsend-email");
  var smsBtn=document.getElementById("drawer-qsend-sms");
  var copyBtn=document.getElementById("drawer-qcopy");
  var statusEl=document.getElementById("drawer-qstatus");
  var agentEmail=${JSON.stringify(agentEmailForMailto)};
  var agentPhone=${JSON.stringify(agent.phone || "")};
  var TEMPLATES=[
    {label:"Pricing", subject:"Pricing question — {P}", body:"Hi, could you share the asking price and any recent price changes for {P}?"},
    {label:"Availability", subject:"Availability — {P}", body:"Is {P} still available? When can I view it?"},
    {label:"Schedule a tour", subject:"Tour request — {P}", body:"I'd like to schedule a tour of {P}. What times work this week?"},
    {label:"HOA / fees", subject:"HOA & fees — {P}", body:"Could you share HOA dues and any other recurring fees for {P}?"},
    {label:"Square footage", subject:"Square footage — {P}", body:"Could you confirm the total square footage and room dimensions for {P}?"},
    {label:"Pet policy", subject:"Pet policy — {P}", body:"What's the pet policy for {P}?"},
    {label:"Financing", subject:"Financing — {P}", body:"Are there preferred lenders or financing options for {P}?"},
    {label:"Other", subject:"Inquiry — {P}", body:""}
  ];
  var activeIdx=-1;
  function currentPropName(){
    try{
      var p=props[current]||{};
      return ((p.propertyName||p.name||"this property")+"").trim()||"this property";
    }catch(_e){ return "this property"; }
  }
  function fillFrom(idx){
    activeIdx=idx;
    var tpl=TEMPLATES[idx];
    var pn=currentPropName();
    if(tpl.body) msgEl.value=tpl.body.split("{P}").join(pn);
    var chips=chipsEl.querySelectorAll(".drawer-qchip");
    for(var i=0;i<chips.length;i++) chips[i].classList.toggle("active",i===idx);
    refresh();
    msgEl.focus();
  }
  for(var i=0;i<TEMPLATES.length;i++){
    (function(idx){
      var b=document.createElement("button");
      b.type="button";
      b.className="drawer-qchip";
      b.textContent=TEMPLATES[idx].label;
      b.addEventListener("click",function(){ fillFrom(idx); });
      chipsEl.appendChild(b);
    })(i);
  }
  function buildSubject(){
    var pn=currentPropName();
    if(activeIdx>=0) return TEMPLATES[activeIdx].subject.split("{P}").join(pn);
    return "Inquiry — "+pn;
  }
  function buildBody(forSms){
    var msg=(msgEl.value||"").trim();
    var visitorEmail=(emailEl.value||"").trim();
    if(forSms) return msg+(visitorEmail?"\\nReply to: "+visitorEmail:"");
    return buildVisitorEmailBody(msg,visitorEmail,["Property: "+currentPropName()]);
  }
  function buildSmsUrl(){
    if(!agentPhone) return "";
    var body=buildBody(true);
    var url="sms:"+agentPhone+"?body="+encodeURIComponent(body);
    while(url.length>1900 && body.length>50){
      body=body.slice(0,Math.max(50,body.length-200));
      url="sms:"+agentPhone+"?body="+encodeURIComponent(body);
    }
    return url;
  }
  function refresh(){
    var ok=(msgEl.value||"").trim().length>0;
    var emailReady=ok&&!!agentEmail;
    var smsReady=ok&&!!agentPhone;
    if(emailBtn){
      emailBtn.setAttribute("aria-disabled", emailReady ? "false":"true");
      emailBtn.setAttribute("href", emailReady ? buildEmailRedirectUrl(agentEmail,buildSubject(),buildBody(false)) : "#");
    }
    if(smsBtn){
      smsBtn.setAttribute("aria-disabled", smsReady ? "false":"true");
      smsBtn.setAttribute("href", smsReady ? buildSmsUrl() : "#");
    }
    if(copyBtn) copyBtn.setAttribute("aria-disabled", ok ? "false":"true");
  }
  msgEl.addEventListener("input",refresh);
  emailEl.addEventListener("input",refresh);
  if(emailBtn){
    emailBtn.addEventListener("click",function(ev){
      if(emailBtn.getAttribute("aria-disabled")==="true"){
        ev.preventDefault();
        return;
      }
      if(!agentEmail){
        ev.preventDefault();
        statusEl.textContent="No email address configured.";
        return;
      }
      if(!isValidVisitorEmail(emailEl.value)){
        ev.preventDefault();
        statusEl.textContent="Please enter a valid email address or leave it blank.";
        return;
      }
      var subject=buildSubject();
      var body=buildBody(false);
      if(!prepareEmailRedirectLink(emailBtn,agentEmail,subject,body,statusEl)){
        ev.preventDefault();
        return;
      }
      ev.preventDefault();
      openEmailRedirect(agentEmail,subject,body,statusEl);
    });
  }
  if(smsBtn){
    smsBtn.addEventListener("click",function(ev){
      if(smsBtn.getAttribute("aria-disabled")==="true"){
        ev.preventDefault();
        return;
      }
      var url=buildSmsUrl();
      if(!url){
        ev.preventDefault();
        statusEl.textContent="No phone number configured.";
        return;
      }
      smsBtn.setAttribute("href",url);
      statusEl.textContent="Opening text message...";
    });
  }
  if(copyBtn){
    copyBtn.addEventListener("click",async function(){
      if(copyBtn.getAttribute("aria-disabled")==="true") return;
      var text=(agentEmail?"To: "+agentEmail+"\\n":"")+"Subject: "+buildSubject()+"\\n\\n"+buildBody(false);
      try{
        if(navigator.clipboard&&navigator.clipboard.writeText){
          await navigator.clipboard.writeText(text);
        }else{
          var ta=document.createElement("textarea");
          ta.value=text; document.body.appendChild(ta); ta.select();
          document.execCommand("copy"); document.body.removeChild(ta);
        }
        statusEl.textContent="Copied to clipboard.";
      }catch(_e){ statusEl.textContent="Couldn't copy — please select and copy manually."; }
    });
  }
  refresh();
})();

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

// ── Live Guided Tour PeerJS controller. Inlined verbatim from
//    src/lib/portal/live-session.mjs — after this point
//    createLiveSession is a local symbol. (Same caveat as above:
//    do NOT write \${LIVE_SESSION_RUNTIME_JS} or use any backticks
//    inside a comment here. Template literals evaluate \${...} and
//    end on backticks even inside // comments, which would inline
//    the whole module a second time and corrupt the script.)
${LIVE_SESSION_RUNTIME_JS}

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

function __dqaHumanSourceLabel(source){
  var s=String(source||"").trim();
  if(!s) return "";
  var parts=s.split(/\\s*(?:→|->)\\s*/);
  if(parts.length>1) s=parts[parts.length-1];
  s=s.replace(/^field:/,"").replace(/[_-]+/g," ").replace(/\\s+/g," ").trim();
  return s?s.charAt(0).toUpperCase()+s.slice(1):"";
}
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
    tag.textContent="Source: "+__dqaHumanSourceLabel(source);
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
  // tier only) and falls back to the HTTPS email redirector otherwise.
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
    +'<a class="ask-inquiry-send" href="#" role="button" target="_blank" rel="noopener">Email '+escapeText((String((C.agent&&C.agent.name)||"").trim().split(/\\s+/)[0])||"agent")+'</a>'
    +(agentPhone?'<a class="ask-inquiry-sms" href="sms:'+escapeText(agentPhone)+'?body='+encodeURIComponent("Question about "+propertyName+":\\n\\n"+(prefilledQuestion||""))+'">Text instead</a>':'')
    +'</div>'
    +'<div class="ask-inquiry-status" aria-live="polite"></div>';
  __docsQa.messages.appendChild(card);
  __docsQa.messages.scrollTop=__docsQa.messages.scrollHeight;
  var inputs=card.querySelectorAll(".ask-inquiry-input");
  var statusEl=card.querySelector(".ask-inquiry-status");
  var sendEl=card.querySelector(".ask-inquiry-send");
  sendEl.addEventListener("click",function(ev){
    var values={};
    for(var i=0;i<inputs.length;i++){
      values[inputs[i].getAttribute("data-k")]=inputs[i].value.trim();
    }
    if(!values.email||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(values.email)){
      ev.preventDefault();
      statusEl.textContent="Please enter a valid email.";
      statusEl.style.color="#b91c1c";
      return;
    }
    if(!values.message){
      ev.preventDefault();
      statusEl.textContent="Please include a message.";
      statusEl.style.color="#b91c1c";
      return;
    }
    if(!agentEmail){
      ev.preventDefault();
      statusEl.textContent="Sorry, no contact channel is configured for this listing.";
      statusEl.style.color="#b91c1c";
      return;
    }
    // Capture the Listing Launch Kit src=… tag from the URL so the agent
    // sees which marketplace/channel the visitor came from. Sanitized
    // tightly (kebab-style only, ≤32 chars) and skipped silently if the
    // URL has no src parameter — additive, never breaks the email body.
    var leadSrc="";
    try{
      var rawSrc=new URLSearchParams(window.location.search).get("src")||"";
      if(/^[a-z0-9-]{1,32}$/i.test(rawSrc)) leadSrc=rawSrc.toLowerCase();
    }catch(_e){}
    // Build the contact payload synchronously so the Worker launch remains
    // tied to the visitor's click gesture.
    var subject="Question about "+propertyName;
    var body=buildVisitorEmailBody(values.message,values.email,[
      values.name?"Name: "+values.name:"",
      values.phone?"Phone: "+values.phone:"",
      "Property: "+propertyName,
      leadSrc?"Source: "+leadSrc:""
    ]);
    if(!prepareEmailRedirectLink(sendEl,agentEmail,subject,body,statusEl)){
      ev.preventDefault();
      statusEl.style.color="#b91c1c";
      return;
    }
    ev.preventDefault();
    openEmailRedirect(agentEmail,subject,body,statusEl);
    statusEl.style.color="#047857";
    // Fire-and-forget lead-capture (Pro tier). We do NOT await — awaiting here would
    // void the user-gesture and Chromium-based browsers may block the pop-up.
    var supabaseOrigin=window.__SYNTHESIS_URL__?String(window.__SYNTHESIS_URL__).replace(/\\/functions\\/v1\\/.*$/,""):"";
    var studioId=String(C.studioId||"");
    if(supabaseOrigin&&studioId){
      try{
        fetch(supabaseOrigin+"/functions/v1/handle-lead-capture",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({studio_id:studioId,visitor_email:values.email,property_name:propertyName})
        }).catch(function(){});
      }catch(_){}
    }
    for(var j=0;j<inputs.length;j++) inputs[j].disabled=true;
    sendEl.setAttribute("aria-disabled","true");
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
      var parentId=String(ch.id||("chunk-"+e+"-"+c));
      var units=__dqaEvidenceUnits(ch.content||"");
      for(var u=0;u<units.length;u++){
        docs.push({
          id:label+"#chunk#"+parentId+"#u#"+u,
          parentId:parentId,
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
        parentId:"field:"+fkeys[k],
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
    ? {id:"string",parentId:"string",source:"string",content:"string",kind:"string",embedding:"vector[384]"}
    : {id:"string",parentId:"string",source:"string",content:"string",kind:"string"};
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
        id:doc.id,parentId:doc.parentId||doc.id,source:doc.source,content:doc.content,kind:doc.kind||"raw_chunk",embedding:emb
      });
    }else{
      await om.insert(__docsQa.db,{
        id:doc.id,parentId:doc.parentId||doc.id,source:doc.source,content:doc.content,kind:doc.kind||"raw_chunk"
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
    schema:{id:"string",question:"string",answer:"string",source_anchor_id:"string",field:"string",embedding:"vector[384]"}
  });
  for(var i=0;i<data.length;i++){
    var entry=data[i];
    await om.insert(__docsQa.qaDb,{
      id:entry.id,
      question:entry.question,
      answer:entry.answer,
      source_anchor_id:entry.source_anchor_id,
      field:entry.field||"",
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
              field:d.field||"",
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
              parentId:doc.parentId||doc.id,
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
              intent:intent||"unknown",
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
  try { if(typeof window.__lgOnPropertyChange==="function") window.__lgOnPropertyChange(i); } catch(_e){}
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

// ── Live Guided Tour wiring ─────────────────────────────────────────
//   Constructs the createLiveSession() controller (factory inlined
//   above as LIVE_SESSION_RUNTIME_JS) and binds it to the DOM. Both
//   the agent and the visitor open the same exported HTML; this IIFE
//   renders the same Live-Guide drawer section for both, but the
//   roles are mutually exclusive at runtime — whichever button is
//   clicked first locks the role for that device.
(function initLiveGuide(){
  var section=document.getElementById("drawer-live-guide");
  if(!section) return;
  if(typeof createLiveSession!=="function") return;

  var visitorPane=document.getElementById("lg-visitor");
  var agentPane=document.getElementById("lg-agent");
  var pinInput=document.getElementById("lg-pin-input");
  var joinBtn=document.getElementById("lg-join-btn");
  var visitorStatus=document.getElementById("lg-visitor-status");
  var toggleAgentLink=document.getElementById("lg-toggle-agent");
  var startBtn=document.getElementById("lg-start-btn");
  var toggleVisitorLink=document.getElementById("lg-toggle-visitor");
  var pinValue=document.getElementById("lg-pin-value");
  var agentStatus=document.getElementById("lg-agent-status");
  var stopsContainer=document.getElementById("lg-stops");
  var preJoinBlock=document.getElementById("lg-agent-prejoin");
  var activeBlock=document.getElementById("lg-agent-active");
  var audioEl=document.getElementById("lg-audio");
  var leaveBtn=document.getElementById("hud-leave-btn");

  var session=createLiveSession({});
  var lastTeleportTs=0;
  var wasConnected=false;

  // Hide the HUD header + close the contact drawer. Used after a live
  // session reaches "connected" so the 3D tour fills the screen.
  function hideOverlaysForLiveTour(){
    try { if(window.__closeContact) window.__closeContact(); } catch(_e){}
    try {
      if(typeof setHudVisible==="function") setHudVisible(false);
      else if(window.__setHudVisible) window.__setHudVisible(false);
      else {
        var hh=document.getElementById("hud-header");
        if(hh){ hh.classList.remove("visible"); hh.style.transform="translateY(-100%)"; hh.style.opacity="0"; hh.style.pointerEvents="none"; }
      }
    } catch(_e){}
  }

  // Reset the Live-Guide UI back to the idle (visitor-default) state.
  // Called after dispose() so the user can start a new session without
  // a page reload.
  function resetUiToIdle(){
    if(visitorPane) visitorPane.hidden=false;
    if(agentPane) agentPane.hidden=true;
    if(preJoinBlock) preJoinBlock.hidden=false;
    if(activeBlock) activeBlock.hidden=true;
    if(joinBtn) joinBtn.disabled=false;
    if(startBtn) startBtn.disabled=false;
    if(pinInput) pinInput.value="";
    if(pinValue) pinValue.innerHTML="&mdash;&mdash;&mdash;&mdash;";
    if(visitorStatus) visitorStatus.textContent="";
    if(agentStatus) agentStatus.textContent="";
    if(stopsContainer) stopsContainer.innerHTML="";
    if(audioEl){ try { audioEl.srcObject=null; } catch(_e){} }
  }

  function teardownSession(){
    try { session.dispose(); } catch(_e){}
    if(leaveBtn) leaveBtn.hidden=true;
    wasConnected=false;
    resetUiToIdle();
    // Re-create the controller so a fresh session can be started
    // without reloading the page. Re-attach the same subscriber.
    session=createLiveSession({});
    session.subscribe(onState);
  }

  if(leaveBtn){
    leaveBtn.addEventListener("click",function(){
      teardownSession();
    });
  }


  // Strip ss/sr/qs/play/title/brand from a Matterport URL and re-append
  // them with the supplied values. We always force qs=1 (Quick Start)
  // and play=1 so the visitor's iframe snaps to the new view without
  // the fly-in animation, and we always force title=0 & brand=0 so the
  // teleport never re-shows Matterport's centered title card or brand
  // watermark mid-tour. This override is scoped to live-tour bookmark
  // teleports only — normal viewing still respects the agent's
  // TourBehavior hideTitle / hideBranding toggles.
  function rewriteIframeForTeleport(baseUrl,ss,sr){
    if(!baseUrl) return baseUrl;
    var stripped=baseUrl.replace(/[?&](ss|sr|qs|play|title|brand)=[^&]*/g,function(m){
      return m.charAt(0)==="?"?"?":"";
    });
    // The strip above can leave a trailing "?" or "?&" sequence —
    // normalize to a clean separator.
    stripped=stripped.replace(/\\?&/g,"?").replace(/[?&]$/,"");
    var sep=stripped.indexOf("?")===-1?"?":"&";
    var qs="ss="+encodeURIComponent(ss);
    if(sr) qs+="&sr="+encodeURIComponent(sr);
    qs+="&qs=1&play=1&title=0&brand=0";
    return stripped+sep+qs;
  }

  function applyTeleport(ss,sr){
    if(!frame) return;
    var p=props[current];
    if(!p||!p.iframeUrl) return;
    try { frame.src=rewriteIframeForTeleport(p.iframeUrl,ss,sr); } catch(_e){}
  }

  function renderStops(){
    if(!stopsContainer) return;
    stopsContainer.innerHTML="";
    var p=props[current]||{};
    var stops=p.liveTourStops||[];
    if(stops.length===0){
      var empty=document.createElement("div");
      empty.className="lg-stops-empty";
      empty.textContent="No bookmarks for this property.";
      stopsContainer.appendChild(empty);
      return;
    }
    var connected=session.getState().isConnected;
    stops.forEach(function(stop){
      var btn=document.createElement("button");
      btn.type="button";
      btn.className="lg-stop-btn";
      btn.textContent=stop.name||"Stop";
      btn.disabled=!connected;
      btn.addEventListener("click",function(){
        var sent=session.teleportVisitor(stop.ss,stop.sr||"");
        // Whether or not the data channel send succeeds, the agent's
        // own iframe should follow along — they're leading the tour.
        if(sent) applyTeleport(stop.ss,stop.sr||"");
      });
      stopsContainer.appendChild(btn);
    });
  }

  // Hook called by load(i) so stops re-render when the agent flips
  // between properties mid-tour.
  window.__lgOnPropertyChange=function(){
    if(session.getState().role==="agent") renderStops();
  };

  if(toggleAgentLink){
    toggleAgentLink.addEventListener("click",function(){
      if(visitorPane) visitorPane.hidden=true;
      if(agentPane) agentPane.hidden=false;
    });
  }
  if(toggleVisitorLink){
    toggleVisitorLink.addEventListener("click",function(){
      if(visitorPane) visitorPane.hidden=false;
      if(agentPane) agentPane.hidden=true;
    });
  }

  if(joinBtn&&pinInput){
    joinBtn.addEventListener("click",function(){
      var pin=(pinInput.value||"").replace(/\\D/g,"").slice(0,4);
      if(pin.length!==4){
        if(visitorStatus) visitorStatus.textContent="Enter the 4-digit PIN from your agent.";
        return;
      }
      joinBtn.disabled=true;
      if(visitorStatus) visitorStatus.textContent="Connecting…";
      session.joinAsVisitor(pin).catch(function(){
        // error state surfaced via subscribe()
      });
    });
    pinInput.addEventListener("keydown",function(e){
      if(e.key==="Enter"){ e.preventDefault(); joinBtn.click(); }
    });
    pinInput.addEventListener("input",function(){
      // Strip non-digits live so the input always shows a clean PIN.
      pinInput.value=(pinInput.value||"").replace(/\\D/g,"").slice(0,4);
    });
  }

  if(startBtn){
    startBtn.addEventListener("click",function(){
      startBtn.disabled=true;
      if(agentStatus) agentStatus.textContent="Reserving session…";
      session.initializeAsAgent().catch(function(){
        // error surfaced via subscribe()
      });
    });
  }

  function onState(state){
    // PIN display.
    if(pinValue && state.pin) pinValue.textContent=state.pin;

    // Agent pane: swap pre-join/active visibility once we have a PIN.
    if(state.role==="agent"){
      var hasPin=!!state.pin;
      if(preJoinBlock) preJoinBlock.hidden=hasPin;
      if(activeBlock) activeBlock.hidden=!hasPin;
      if(agentStatus){
        if(state.status==="initializing") agentStatus.textContent="Reserving session…";
        else if(state.status==="waiting") agentStatus.textContent="Share the PIN with your visitor.";
        else if(state.status==="connected") agentStatus.textContent="Connected. Click a stop to teleport your visitor.";
        else if(state.status==="ended") agentStatus.textContent="Session ended.";
        else if(state.status==="error") agentStatus.textContent=state.error||"Something went wrong.";
      }
      if(state.status==="error"&&startBtn) startBtn.disabled=false;
      // Refresh stop button enabled state — render once on transition,
      // then update disabled flags on every state tick (cheap).
      if(hasPin){
        if(stopsContainer && !stopsContainer.firstChild) renderStops();
        if(stopsContainer){
          var btns=stopsContainer.querySelectorAll(".lg-stop-btn");
          for(var i=0;i<btns.length;i++) btns[i].disabled=!state.isConnected;
        }
      }
    }

    // Visitor pane status messaging.
    if(state.role==="visitor"&&visitorStatus){
      if(state.status==="connecting") visitorStatus.textContent="Connecting…";
      else if(state.status==="connected") visitorStatus.textContent="Connected to your agent.";
      else if(state.status==="ended") { visitorStatus.textContent="Session ended."; if(joinBtn) joinBtn.disabled=false; }
      else if(state.status==="error") { visitorStatus.textContent=state.error||"Couldn't connect."; if(joinBtn) joinBtn.disabled=false; }
    }

    // First transition into "connected" — reveal Leave button and
    // auto-close the contact drawer + HUD header so the 3D tour gets
    // the full screen. Latched so we only fire once per session.
    if(!wasConnected && state.isConnected && state.status==="connected"){
      wasConnected=true;
      if(leaveBtn) leaveBtn.hidden=false;
      hideOverlaysForLiveTour();
    }

    // If the session ends/errors after having been connected, return
    // both sides to a clean idle state automatically.
    if(wasConnected && (state.status==="ended"||state.status==="error")){
      // Defer to break out of the current subscriber tick before we
      // dispose + re-create the controller.
      setTimeout(teardownSession,0);
    }

    // Voice attach. srcObject is the modern API; legacy browsers fall
    // back to URL.createObjectURL but every browser PeerJS supports
    // also supports srcObject.
    if(audioEl){
      try {
        if(state.remoteStream && audioEl.srcObject!==state.remoteStream){
          audioEl.srcObject=state.remoteStream;
          var pp=audioEl.play();
          if(pp&&typeof pp.catch==="function") pp.catch(function(){});
        } else if(!state.remoteStream && audioEl.srcObject){
          audioEl.srcObject=null;
        }
      } catch(_e){}
    }

    // Visitor iframe sync. The controller patches incomingTeleportEvent
    // with a fresh ts on every inbound packet; we de-dupe on ts so the
    // same coords can be re-fired (re-teleport to the same stop) but
    // an unchanged event doesn't keep replaying.
    if(state.role==="visitor"&&state.incomingTeleportEvent&&state.incomingTeleportEvent.ts!==lastTeleportTs){
      lastTeleportTs=state.incomingTeleportEvent.ts;
      applyTeleport(state.incomingTeleportEvent.ss,state.incomingTeleportEvent.sr);
    }
  }

  session.subscribe(onState);
})();
}).catch(function(err){
  // __configReady rejected — protected mode with Subtle unavailable, or
  // a bug in the unlock pipeline. The unsupported-browser banner is
  // already shown by the safety bootstrap; nothing more to do here.
  if(err) console.warn("[presentation] runtime gated:",err&&err.message?err.message:err);
});
})();
</script>
</body>
</html>`;

    return askAiWarning
      ? { success: true, html, askAiWarning }
      : { success: true, html };
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

export interface ProviderOrderRow {
  id: string;
  modelId: string;
  clientId: string;
  clientEmail: string | null;
  clientName: string | null;
  notificationStatus: string;
  createdAt: string;
  modelName: string;
  modelStatus: "preview" | "pending_payment" | "paid";
  isReleased: boolean;
  amountCents: number | null;
  modelCount: number | null;
}

export const getProviderOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ orders: ProviderOrderRow[]; error: string | null }> => {
    const { userId } = context;

    const { data: notifications, error: notificationError } = await supabaseAdmin
      .from("order_notifications")
      .select("id, provider_id, client_id, model_id, status, created_at")
      .eq("provider_id", userId)
      .order("created_at", { ascending: false });

    if (notificationError) {
      return { orders: [], error: notificationError.message };
    }
    if (!notifications || notifications.length === 0) {
      return { orders: [], error: null };
    }

    const modelIds = notifications.map((notification) => notification.model_id);
    const clientIds = Array.from(new Set(notifications.map((notification) => notification.client_id)));

    const [{ data: models, error: modelsError }, { data: profiles }] = await Promise.all([
      supabaseAdmin
        .from("saved_models")
        .select("id, provider_id, name, status, is_released, amount_cents, model_count")
        .eq("provider_id", userId)
        .in("id", modelIds),
      supabaseAdmin
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", clientIds),
    ]);

    if (modelsError) {
      return { orders: [], error: modelsError.message };
    }

    const modelMap = new Map((models ?? []).map((model) => [model.id, model]));
    const profileMap = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
    const clientEmailEntries = await Promise.all(
      clientIds.map(async (clientId): Promise<[string, string | null]> => {
        const { data } = await supabaseAdmin.auth.admin.getUserById(clientId);
        return [clientId, data.user?.email ?? null];
      }),
    );
    const clientEmailMap = new Map(clientEmailEntries);

    const orders = notifications.map((notification): ProviderOrderRow => {
      const model = modelMap.get(notification.model_id);
      const profile = profileMap.get(notification.client_id);
      return {
        id: notification.id,
        modelId: notification.model_id,
        clientId: notification.client_id,
        clientEmail: clientEmailMap.get(notification.client_id) ?? null,
        clientName: profile?.display_name ?? null,
        notificationStatus: notification.status,
        createdAt: notification.created_at,
        modelName: model?.name || "Unknown presentation",
        modelStatus: model?.status ?? "preview",
        isReleased: model?.is_released ?? false,
        amountCents: model?.amount_cents ?? null,
        modelCount: model?.model_count ?? null,
      };
    });

    return { orders, error: null };
  });

export const grantFreePresentationDownload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { modelId: string }) => data)
  .handler(async ({ data, context }) => {
    const { userId } = context;

    const { data: model, error: modelError } = await supabaseAdmin
      .from("saved_models")
      .select("id, provider_id, status")
      .eq("id", data.modelId)
      .eq("provider_id", userId)
      .maybeSingle();

    if (modelError || !model) {
      throw new Error(modelError?.message || "Presentation order not found");
    }
    if (model.status === "paid") {
      return { success: true, alreadyPaid: true };
    }

    const { error: updateError } = await supabaseAdmin
      .from("saved_models")
      .update({
        amount_cents: 0,
        status: "paid",
        is_released: true,
      })
      .eq("id", data.modelId)
      .eq("provider_id", userId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    await supabaseAdmin
      .from("order_notifications")
      .update({ status: "paid" })
      .eq("model_id", data.modelId)
      .eq("provider_id", userId);

    return { success: true, alreadyPaid: false };
  });

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

// ============================================================================
// Studio preview token — short-lived, DB-backed, slug-bound authorization
// for the dashboard's Branding > Studio Preview iframe. The iframe is
// sandboxed without `allow-same-origin`, so the public Studio route loaded
// inside it cannot read parent auth/session storage. The dashboard (which
// IS authenticated) requests this token via the `issue_studio_preview_token`
// RPC; the public route then verifies it via `verify_studio_preview_token`.
// Both RPCs are SECURITY DEFINER and live in
// `supabase/migrations/20260501000000_studio_preview_tokens.sql`.
//
// We use a DB row id (UUID v4) as the token rather than an HMAC because
// this deployment doesn't ship a server-only HMAC secret env var, and we
// don't want the feature to fail closed in environments that haven't
// configured one. Token entropy is ~122 bits — unguessable in practice.
// ============================================================================

export const issueStudioPreviewToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ data, context }): Promise<{ token: string }> => {
    const slug = (data.slug ?? "").trim().toLowerCase();
    if (!slug) {
      throw new Error("issueStudioPreviewToken: missing slug");
    }

    const { supabase } = context;

    // The RPCs are provisioned by a server-only migration and are not in
    // the generated `Database` types yet. Use an untyped view so the TS
    // overloads resolve.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const untyped = supabase as unknown as any;
    const { data: tokenId, error } = await untyped.rpc(
      "issue_studio_preview_token",
      { _slug: slug },
    );

    if (error) {
      // Surface the underlying error to the dashboard UI so the operator
      // can act on it directly. PostgREST/Postgres errors don't contain
      // user-sensitive data — they reveal function/column names that are
      // already part of the public codebase.
      console.error("issue_studio_preview_token rpc failed:", error);
      const e = error as {
        message?: string;
        code?: string;
        details?: string;
        hint?: string;
      };
      const detail = e.message ?? "unknown error";

      // PGRST202 = "Could not find the function ... in the schema cache".
      // 42883   = Postgres "function does not exist".
      // 42P01   = Postgres "relation does not exist" (the underlying table).
      // All three mean: the studio_preview_tokens migration hasn't been
      // applied yet. Surface a clear, actionable message instead of the
      // raw Postgres text.
      if (
        e.code === "PGRST202" ||
        e.code === "42883" ||
        e.code === "42P01" ||
        /Could not find the function|does not exist/i.test(detail)
      ) {
        throw new Error(
          "Studio preview isn't provisioned on the database yet. " +
            "Apply the latest Supabase migrations " +
            "(20260501000000_studio_preview_tokens.sql) and reload this page.",
        );
      }
      throw new Error(`Studio preview authorization failed: ${detail}`);
    }
    if (!tokenId || typeof tokenId !== "string") {
      // RPC returns NULL when the caller is not the slug's owner / admin
      // or the slug doesn't exist — surface as a clear permission error.
      throw new Error(
        "Not authorized to preview this Studio. Sign in as the Studio owner.",
      );
    }

    return { token: tokenId };
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
