import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Brain,
  CheckCircle2,
  Loader2,
  Sparkles,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

import { useAuth } from "@/hooks/use-auth";
import { useAvailableTemplates } from "@/hooks/useAvailableTemplates";
import { useAvailablePropertyDocs } from "@/hooks/useAvailablePropertyDocs";
import { usePropertyExtractions } from "@/hooks/usePropertyExtractions";
import { useIndexing } from "@/lib/rag/indexing-context";
import { supabase } from "@/integrations/supabase/client";
import { uploadVaultAsset } from "@/lib/storage";
import { induceSchema } from "@/lib/extraction/induce";
import type { JsonSchema, JsonSchemaField } from "@/lib/extraction/provider";

import { friendlyError } from "../friendly-errors";
import { resolveProfileTemplate, getCategory } from "../profiles";
import type {
  TrainingPhase,
  TrainingResult,
  WizardSource,
  WizardState,
} from "../types";

interface Props {
  state: WizardState;
  propertyUuid: string;
  propertyName: string;
  savedModelId: string | null;
  onPhaseChange: (phase: TrainingPhase, errorCopy?: string | null) => void;
  onComplete: (result: TrainingResult) => void;
  onBack: () => void;
}

const PHASES: { key: TrainingPhase; label: string; sublabel: string }[] = [
  {
    key: "reading",
    label: "Reading document…",
    sublabel: "Loading and preparing your source material.",
  },
  {
    key: "extracting",
    label: "Extracting key facts…",
    sublabel: "Pulling structured details the AI can answer about.",
  },
  {
    key: "optimizing",
    label: "Optimizing chat responses…",
    sublabel: "Indexing context so questions return fast, accurate answers.",
  },
];

const PHASE_PROGRESS: Record<TrainingPhase, number> = {
  idle: 0,
  reading: 25,
  extracting: 60,
  optimizing: 90,
  ready: 100,
  error: 100,
};

/**
 * Step 3 — the heart of the wizard. Runs the full training pipeline:
 *
 *   resolve profile → upload/register source →
 *   (PDF only) induce extra fields → extract → wait for indexing
 *
 * Phase changes drive both the UI (animated chips + progress bar) and the
 * parent state (`onPhaseChange`) so the modal header reflects progress.
 *
 * The pipeline is idempotent within a single mount: if the user re-clicks
 * "Activate AI Learning" after a transient failure, we restart cleanly.
 */
export function TrainingStep({
  state,
  propertyUuid,
  propertyName,
  savedModelId,
  onPhaseChange,
  onComplete,
  onBack,
}: Props) {
  const { user } = useAuth();
  const { templates, refresh: refreshTemplates } = useAvailableTemplates();
  const { refresh: refreshDocs } = useAvailablePropertyDocs();
  const { extract, extractFromUrl } = usePropertyExtractions(propertyUuid);
  const indexing = useIndexing();

  const [activated, setActivated] = useState(false);
  // Guard against double-fires from React-strict-mode-style remounts.
  const ranRef = useRef(false);

  const phase = state.trainingPhase;
  const error = state.errorCopy;
  const isWorking =
    phase === "reading" || phase === "extracting" || phase === "optimizing";

  // Kick off the pipeline once the user clicks "Activate AI Learning".
  useEffect(() => {
    if (!activated || ranRef.current || !user || !state.profileCategory || !state.source) return;
    ranRef.current = true;

    const cat = getCategory(state.profileCategory);
    if (!cat) {
      onPhaseChange("error", "Couldn't load the selected profile. Try again.");
      ranRef.current = false;
      return;
    }

    const run = async () => {
      try {
        // ── Resolve template (curated or cloned starter) ────────────────
        onPhaseChange("reading", null);
        const { templateId, cloned } = await resolveProfileTemplate({
          providerId: user.id,
          category: state.profileCategory!,
          availableTemplates: templates,
        });
        if (cloned) refreshTemplates();

        // ── Stage source: upload file, register URL, or reuse vault id ──
        const { vaultAssetId, isUrl, file } = await ensureVaultAsset({
          source: state.source!,
          providerId: user.id,
          propertyName,
        });
        await refreshDocs();

        // ── Optional field induction (PDF only) ─────────────────────────
        // We DON'T mutate the saved profile; if induce-schema returns
        // properties not already in the profile, the merged schema is
        // attached as a one-shot override via a transient template clone.
        let effectiveTemplateId = templateId;
        if (file && file.type === "application/pdf") {
          try {
            const induced = await induceSchema(file);
            if (induced?.schema?.properties) {
              const merged = mergeSchemas(
                getTemplateSchema(templates, templateId),
                induced.schema,
              );
              if (merged) {
                const overrideId = await createOverrideTemplate({
                  providerId: user.id,
                  baseLabel: cat.label,
                  schema: merged,
                  docKind: cat.docKind,
                });
                if (overrideId) effectiveTemplateId = overrideId;
              }
            }
          } catch (err) {
            // Best-effort — silently fall back to the profile schema.
            console.warn("[ai-wizard] induce-schema skipped:", err);
          }
        }

        // ── Extraction ──────────────────────────────────────────────────
        onPhaseChange("extracting", null);
        const extractRes = isUrl
          ? await extractFromUrl({
              vault_asset_id: vaultAssetId,
              url: (state.source as { kind: "url"; url: string }).url,
              template_id: null,
              saved_model_id: savedModelId,
            })
          : await extract({
              vault_asset_id: vaultAssetId,
              template_id: effectiveTemplateId,
              saved_model_id: savedModelId,
            });

        if (!extractRes) {
          // Hook surfaced its own toast; map to friendly copy.
          onPhaseChange(
            "error",
            "Training stopped during extraction. Try again or use a different document.",
          );
          ranRef.current = false;
          return;
        }

        // ── Indexing wait (with timeout escape hatch) ───────────────────
        onPhaseChange("optimizing", null);
        const indexed = await waitForIndexing(propertyUuid, indexing);
        if (!indexed) {
          // Optimization continues in background; still consider success.
          console.info("[ai-wizard] indexing did not complete in time; advancing anyway");
        }

        const fields = extractRes.fields ?? {};
        onComplete({
          vaultAssetId,
          templateId: effectiveTemplateId,
          fields,
          chunkCount: extractRes.chunks_indexed,
        });
        onPhaseChange("ready", null);
      } catch (err) {
        console.error("[ai-wizard] training pipeline failed:", err);
        onPhaseChange("error", friendlyError(err));
        ranRef.current = false;
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activated]);

  // Initial pre-activation view
  if (phase === "idle" && !activated) {
    return (
      <div className="space-y-4">
        <header className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">
            Ready to train your AI Chat Assistant
          </h3>
          <p className="text-xs leading-snug text-muted-foreground">
            We'll process your source and teach the AI to answer questions
            about <strong className="text-foreground">{propertyName}</strong>.
            This usually takes 10–30 seconds.
          </p>
        </header>

        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Brain className="size-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-foreground">
                What happens next
              </p>
              <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                <li>• Read your document or page</li>
                <li>• Extract structured facts (price, size, amenities…)</li>
                <li>• Index everything for instant Q&amp;A</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button onClick={() => setActivated(true)} className="gap-2">
            <Wand2 className="size-4" />
            Activate AI Learning
          </Button>
        </div>
      </div>
    );
  }

  // Working / done / error view
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">
          {phase === "ready"
            ? "Training complete"
            : phase === "error"
              ? "Training paused"
              : "Training your AI Chat Assistant…"}
        </h3>
        <p className="text-xs leading-snug text-muted-foreground">
          {phase === "ready"
            ? "Your AI is now familiar with this property."
            : phase === "error"
              ? "Don't worry — nothing is lost. You can try again or pick a different document."
              : `Working on ${propertyName}.`}
        </p>
      </header>

      <Progress
        value={PHASE_PROGRESS[phase]}
        className={cn(
          "h-2 transition-all",
          isWorking && "animate-pulse",
          phase === "error" && "[&>div]:bg-destructive",
        )}
      />

      <ul className="space-y-2">
        {PHASES.map((p) => {
          const isCurrent = p.key === phase;
          const isPast =
            (phase === "extracting" && p.key === "reading") ||
            (phase === "optimizing" && (p.key === "reading" || p.key === "extracting")) ||
            phase === "ready";
          const isFuture = !isCurrent && !isPast;
          return (
            <li
              key={p.key}
              className={cn(
                "flex items-start gap-2.5 rounded-md border p-2.5 transition-colors",
                isCurrent && "border-primary/40 bg-primary/5",
                isPast && "border-emerald-500/30 bg-emerald-500/5",
                isFuture && "border-border bg-muted/10 opacity-60",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                  isPast && "bg-emerald-500 text-white",
                  isCurrent && "bg-primary text-primary-foreground",
                  isFuture && "bg-muted text-muted-foreground",
                )}
              >
                {isPast ? (
                  <CheckCircle2 className="size-3" />
                ) : isCurrent ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" />
                )}
              </span>
              <div className="min-w-0 flex-1 space-y-0.5">
                <p
                  className={cn(
                    "text-xs font-medium",
                    isFuture ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {p.label}
                </p>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {p.sublabel}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      {phase === "error" && error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <p className="leading-snug">{error}</p>
        </div>
      )}

      {phase === "ready" && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-300">
          <Sparkles className="mt-0.5 size-3.5 shrink-0" />
          <p className="leading-snug">
            Continuing to the verification step…
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={isWorking}
        >
          Back
        </Button>
        {phase === "error" && (
          <Button
            onClick={() => {
              ranRef.current = false;
              onPhaseChange("idle", null);
              setActivated(false);
            }}
            className="gap-2"
          >
            <BookOpen className="size-4" />
            Try Again
          </Button>
        )}
      </div>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

async function ensureVaultAsset(args: {
  source: WizardSource;
  providerId: string;
  propertyName: string;
}): Promise<{ vaultAssetId: string; isUrl: boolean; file: File | null }> {
  const { source, providerId, propertyName } = args;
  if (!source) throw new Error("No source selected.");

  const today = new Date().toISOString().slice(0, 10);
  const autoLabel = `${propertyName} — ${today}`;

  if (source.kind === "vault") {
    return { vaultAssetId: source.assetId, isUrl: false, file: null };
  }

  if (source.kind === "url") {
    const u = new URL(source.url);
    const { data, error } = await supabase
      .from("vault_assets")
      .insert({
        provider_id: providerId,
        category_type: "property_doc" as const,
        label: autoLabel || u.hostname,
        asset_url: u.toString(),
        storage_path: null,
        mime_type: "text/uri-list",
        file_size_bytes: 0,
        is_active: true,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error("Couldn't register that URL. Try again.");
    return { vaultAssetId: data.id, isUrl: true, file: null };
  }

  // file
  const file = source.file;
  const uploaded = await uploadVaultAsset(providerId, "property_doc", file);
  if (!uploaded) throw new Error("Upload failed — check your connection.");
  const { data, error } = await supabase
    .from("vault_assets")
    .insert({
      provider_id: providerId,
      category_type: "property_doc" as const,
      label: autoLabel,
      asset_url: uploaded.url,
      storage_path: uploaded.path,
      mime_type: file.type || "application/pdf",
      file_size_bytes: file.size,
      is_active: true,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("Couldn't register the document. Try again.");
  return { vaultAssetId: data.id, isUrl: false, file };
}

function getTemplateSchema(
  templates: ReturnType<typeof useAvailableTemplates>["templates"],
  templateId: string,
): JsonSchema | null {
  const t = templates.find((x) => x.id === templateId);
  return (t?.field_schema as JsonSchema | undefined) ?? null;
}

/**
 * Returns a merged JsonSchema if `induced` adds at least one property the
 * profile doesn't already cover. Returns null if no merge is needed.
 */
function mergeSchemas(
  base: JsonSchema | null,
  induced: JsonSchema | null,
): JsonSchema | null {
  if (!base || !induced?.properties) return null;
  const baseProps = base.properties ?? {};
  const indProps = induced.properties ?? {};
  const newKeys = Object.keys(indProps).filter((k) => !(k in baseProps));
  if (newKeys.length === 0) return null;
  const mergedProps: Record<string, JsonSchemaField> = { ...baseProps };
  for (const k of newKeys) mergedProps[k] = indProps[k];
  return {
    type: "object",
    properties: mergedProps,
    required: base.required ?? [],
  };
}

async function createOverrideTemplate(args: {
  providerId: string;
  baseLabel: string;
  schema: JsonSchema;
  docKind: string;
}): Promise<string | null> {
  const { data, error } = await supabase
    .from("vault_templates")
    .insert({
      provider_id: args.providerId,
      label: `Auto-detected: ${args.baseLabel} (${new Date().toISOString().slice(0, 10)})`,
      doc_kind: args.docKind,
      field_schema: args.schema as unknown as never,
      extractor: "pdfjs_heuristic",
      is_active: false, // hidden — only used for this run
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return data.id;
}

async function waitForIndexing(
  propertyUuid: string,
  indexing: ReturnType<typeof useIndexing>,
): Promise<boolean> {
  // Kick off (or join) the shared job.
  indexing.requestForce(propertyUuid).catch(() => {
    /* swallow — we observe via subscribe */
  });

  // 25-second soft cap; if still pending we hand off to the background.
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try {
        unsub();
      } catch {
        /* ignore */
      }
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 25_000);
    const unsub = indexing.subscribe(propertyUuid, (s) => {
      if (s.phase === "ready") finish(true);
      if (s.phase === "failed") finish(false);
    });
    // Edge: already ready when we attached.
    const initial = indexing.statusFor(propertyUuid);
    if (initial.phase === "ready") finish(true);
  });
}
