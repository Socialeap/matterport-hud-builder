import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  RefreshCw,
  Snowflake,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { useAuth } from "@/hooks/use-auth";
import { usePropertyExtractions } from "@/hooks/usePropertyExtractions";
import { useLusFreeze } from "@/hooks/useLusFreeze";
import { useLusLicense } from "@/hooks/useLusLicense";
import type { PropertyExtraction } from "@/hooks/usePropertyExtractions";
import { supabase } from "@/integrations/supabase/client";
import { useIndexing } from "@/lib/rag/indexing-context";
import { IndexingStatusBadge } from "@/components/portal/IndexingStatusBadge";
import { AiTrainingWizard } from "@/components/portal/ai-training-wizard/AiTrainingWizard";
import { PropertyInfoSheetTipsDialog } from "@/components/portal/PropertyInfoSheetTipsDialog";
import type { PropertyModel } from "./types";

interface Props {
  models: PropertyModel[];
  savedModelId?: string | null;
  /** Fired only when a training run completes successfully. */
  onExtractionSuccess?: () => void;
}

/**
 * Per-property surface that shows the trained AI Chat Assistant status
 * and a single entry point to (re-)train it via the new 4-step wizard.
 *
 * All upload / vault-pick / template-config UI from the previous version
 * has been collapsed into <AiTrainingWizard />.
 */
export function PropertyIntelligenceSection({
  models,
  savedModelId,
  onExtractionSuccess,
}: Props) {
  const { isActive: lusActive, loading: lusLoading } = useLusLicense();
  const indexing = useIndexing();

  const readyCount = models.filter(
    (m) => indexing.statusFor(m.id).phase === "ready",
  ).length;
  const indexingCount = models.filter(
    (m) => indexing.statusFor(m.id).phase === "indexing",
  ).length;

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-snug text-foreground/80">
        <div className="flex items-start justify-between gap-2">
          <p className="flex items-start gap-2">
            <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>
              Set up an <strong>AI Chat Assistant</strong> for each property.
              We'll guide you through teaching it from a brochure, datasheet,
              or public listing — visitors can then ask questions on the
              published tour.
            </span>
          </p>
          <PropertyInfoSheetTipsDialog />
        </div>
      </div>

      {models.length > 0 && lusActive && (
        <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/60 px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            AI Chat is{" "}
            <strong className="text-foreground">
              ready for {readyCount} of {models.length}
            </strong>{" "}
            propert{models.length === 1 ? "y" : "ies"}.
          </span>
          {indexingCount > 0 && (
            <span className="inline-flex items-center gap-1 text-primary">
              <Loader2 className="size-3 animate-spin" />
              {indexingCount} training…
            </span>
          )}
        </div>
      )}

      {!lusLoading && !lusActive ? (
        <div className="rounded-md border border-border/60 bg-muted/20 p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="size-3.5" />
            AI Chat Assistant is paused. Reactivate your studio license to
            train new properties.
          </div>
        </div>
      ) : models.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 bg-muted/10 p-4 text-center text-xs text-muted-foreground">
          Add a property model first to set up its AI Chat Assistant.
        </p>
      ) : (
        <ul className="space-y-2">
          {models.map((m, idx) => (
            <ModelRow
              key={m.id}
              index={idx}
              model={m}
              savedModelId={savedModelId ?? null}
              onExtractionSuccess={onExtractionSuccess}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface ModelRowProps {
  index: number;
  model: PropertyModel;
  savedModelId: string | null;
  onExtractionSuccess?: () => void;
}

interface AssetMeta {
  id: string;
  label: string;
  asset_url: string;
  mime_type: string | null;
}

function ModelRow({
  index,
  model,
  savedModelId,
  onExtractionSuccess,
}: ModelRowProps) {
  const { user } = useAuth();
  const {
    extractions,
    loading,
    running,
    failuresByAsset,
    extractFromUrl,
    remove,
  } = usePropertyExtractions(model.id);
  const { isFrozen, freeze: freezeRow } = useLusFreeze(model.id);

  const [trackedAssets, setTrackedAssets] = useState<AssetMeta[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Hydrate trackedAssets from existing extractions for this property.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const ids = Array.from(
        new Set(extractions.map((e) => e.vault_asset_id)),
      );
      if (ids.length === 0) return;
      const { data } = await supabase
        .from("vault_assets")
        .select("id, label, asset_url, mime_type")
        .in("id", ids);
      if (cancelled || !data) return;
      setTrackedAssets((prev) => {
        const next = [...prev];
        for (const a of data) {
          if (!next.some((p) => p.id === a.id)) {
            next.push({
              id: a.id,
              label: a.label,
              asset_url: a.asset_url,
              mime_type: a.mime_type,
            });
          }
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [user, extractions]);

  const displayName =
    model.propertyName?.trim() ||
    model.name?.trim() ||
    `Property ${index + 1}`;

  const assetById = useMemo(() => {
    const m = new Map<string, AssetMeta>();
    for (const a of trackedAssets) m.set(a.id, a);
    for (const ex of extractions) {
      if (!m.has(ex.vault_asset_id)) {
        m.set(ex.vault_asset_id, {
          id: ex.vault_asset_id,
          label: "Document",
          asset_url: "",
          mime_type: null,
        });
      }
    }
    return m;
  }, [trackedAssets, extractions]);

  const extractionByAsset = useMemo(() => {
    const m = new Map<string, PropertyExtraction>();
    for (const ex of extractions) m.set(ex.vault_asset_id, ex);
    return m;
  }, [extractions]);

  const mergedAssets = useMemo(
    () => Array.from(assetById.values()),
    [assetById],
  );

  const indexedCount = extractions.filter(
    (e) => Array.isArray(e.chunks) && e.chunks.length > 0,
  ).length;

  const handleReindex = async (asset: AssetMeta) => {
    if (!asset.asset_url) {
      toast.error("Cannot re-train: source missing.");
      return;
    }
    const isUrl = /^https?:\/\//i.test(asset.asset_url);
    if (!isUrl) {
      toast.message(
        "Re-training from a file isn't supported yet — re-train via the wizard instead.",
      );
      return;
    }
    setBusy(true);
    try {
      const res = await extractFromUrl({
        vault_asset_id: asset.id,
        url: asset.asset_url,
        template_id: null,
        saved_model_id: savedModelId,
      });
      if (res) {
        toast.success(`Re-trained on ${res.chunks_indexed} chunks`);
        onExtractionSuccess?.();
      }
    } finally {
      setBusy(false);
    }
  };

  const ctaLabel = mergedAssets.length === 0 ? "Set Up AI Chat Assistant" : "Train Again";

  return (
    <li className="rounded-md border border-border/60 bg-muted/10 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <BookOpen className="size-4 shrink-0 text-primary" />
          <span className="truncate text-sm font-medium">{displayName}</span>
          {mergedAssets.length > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {mergedAssets.length} doc{mergedAssets.length === 1 ? "" : "s"}
              {indexedCount > 0 && ` · ${indexedCount} ready`}
            </Badge>
          )}
          {isFrozen && (
            <Badge
              variant="outline"
              className="h-5 gap-1 border-primary/40 px-1.5 text-[10px] text-primary"
              title={
                freezeRow?.reason ??
                "Property is paused. New training is blocked."
              }
            >
              <Snowflake className="size-2.5" />
              Paused
            </Badge>
          )}
          <IndexingStatusBadge
            propertyUuid={model.id}
            disableRetry={busy || running || isFrozen}
            compact
          />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant={mergedAssets.length === 0 ? "default" : "outline"}
            className="h-7 gap-1 text-xs"
            onClick={() => setWizardOpen(true)}
            disabled={isFrozen || busy || running || !user}
          >
            <Wand2 className="size-3" />
            {ctaLabel}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-2 text-xs text-muted-foreground">
          <Loader2 className="mr-1 size-3 animate-spin" /> Loading…
        </div>
      ) : mergedAssets.length === 0 ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          No training yet. Click <strong>Set Up AI Chat Assistant</strong> to
          guide the AI through your property.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {mergedAssets.map((asset) => {
            const ex = extractionByAsset.get(asset.id) ?? null;
            const failure = failuresByAsset[asset.id] ?? null;
            return (
              <AssetStatusRow
                key={asset.id}
                asset={asset}
                extraction={ex}
                failure={failure}
                running={running && busy}
                onReindex={() => handleReindex(asset)}
                onDelete={ex ? () => remove(ex.id) : undefined}
              />
            );
          })}
        </ul>
      )}

      <AiTrainingWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        propertyUuid={model.id}
        propertyName={displayName}
        savedModelId={savedModelId}
        onComplete={onExtractionSuccess}
      />
    </li>
  );
}

function AssetStatusRow({
  asset,
  extraction,
  failure,
  running,
  onReindex,
  onDelete,
}: {
  asset: AssetMeta;
  extraction: PropertyExtraction | null;
  failure: { stage: string; detail: string; status: number; at: number } | null;
  running: boolean;
  onReindex: () => void;
  onDelete?: () => void;
}) {
  const isUrl = /^https?:\/\//i.test(asset.asset_url);
  const fieldCount = extraction
    ? Object.keys(extraction.fields ?? {}).length
    : 0;
  const chunkCount =
    extraction && Array.isArray(extraction.chunks)
      ? extraction.chunks.length
      : 0;

  // Drive the row status from intelligence_health, NOT from chunkCount
  // alone. A row with chunks but zero structured fields used to mark
  // itself "Ready" — that is the visible bug we are eliminating.
  const health = extraction?.intelligence_health ?? null;
  type RowStatus =
    | "ready"
    | "failed"
    | "pending"
    | "context_only"
    | "needs_review";
  let status: RowStatus;
  if (failure) {
    status = "failed";
  } else if (!extraction) {
    status = "pending";
  } else if (health) {
    if (health.status === "ready") status = "ready";
    else if (health.status === "context_only_degraded")
      status = "context_only";
    else if (health.status === "failed") status = "needs_review";
    else status = "pending"; // degraded — indexing in flight
  } else {
    // Legacy row without intelligence_health: treat as pending until
    // re-extraction populates the column.
    status = "pending";
  }

  return (
    <li className="flex items-center justify-between gap-2 rounded-md bg-background/60 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate" title={asset.label}>
          {asset.label}
        </span>

        {status === "ready" && (
          <Badge
            variant="outline"
            className="h-5 shrink-0 gap-1 border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-700 dark:text-emerald-300"
            title={`${fieldCount} field${fieldCount === 1 ? "" : "s"} · ${chunkCount} chunks`}
          >
            <CheckCircle2 className="size-2.5" />
            Ready
          </Badge>
        )}
        {status === "context_only" && (
          <Badge
            variant="outline"
            className="h-5 shrink-0 gap-1 border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] text-amber-700 dark:text-amber-300"
            title={`${chunkCount} chunk${chunkCount === 1 ? "" : "s"} indexed but no structured fields extracted`}
          >
            <AlertTriangle className="size-2.5" />
            Context only
          </Badge>
        )}
        {status === "needs_review" && (
          <Badge
            variant="outline"
            className="h-5 shrink-0 gap-1 border-destructive/40 bg-destructive/10 px-1.5 text-[10px] text-destructive"
            title={
              health?.blocking_errors[0] ??
              "Training did not produce usable intelligence"
            }
          >
            <AlertTriangle className="size-2.5" />
            Needs review
          </Badge>
        )}
        {status === "pending" && (
          <Badge
            variant="outline"
            className="h-5 shrink-0 gap-1 border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] text-amber-700 dark:text-amber-300"
            title="Training in progress…"
          >
            <Loader2 className="size-2.5 animate-spin" />
            Training
          </Badge>
        )}
        {status === "failed" && failure && (
          <Badge
            variant="outline"
            className="h-5 shrink-0 gap-1 border-destructive/40 bg-destructive/10 px-1.5 text-[10px] text-destructive"
            title={`${failure.stage}: ${failure.detail}`}
          >
            <AlertTriangle className="size-2.5" />
            Needs attention
          </Badge>
        )}

        {extraction && (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {new Date(extraction.extracted_at).toLocaleDateString()}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {(status === "failed" ||
          status === "needs_review" ||
          status === "context_only") && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={onReindex}
            disabled={running}
            title="Re-run training"
          >
            <RefreshCw className={`size-3 ${running ? "animate-spin" : ""}`} />
          </Button>
        )}
        {onDelete && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={onDelete}
            title="Remove training data"
          >
            <Trash2 className="size-3 text-destructive" />
          </Button>
        )}
      </div>
    </li>
  );
}
