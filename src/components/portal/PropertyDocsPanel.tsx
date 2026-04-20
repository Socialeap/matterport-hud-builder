import { useState } from "react";
import { FileText, Loader2, Lock, Play, RefreshCw, Snowflake, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { usePropertyExtractions } from "@/hooks/usePropertyExtractions";
import { useAvailableTemplates } from "@/hooks/useAvailableTemplates";
import { useAvailablePropertyDocs } from "@/hooks/useAvailablePropertyDocs";
import { useLusFreeze } from "@/hooks/useLusFreeze";
import { useLusLicense } from "@/hooks/useLusLicense";
import type { PropertyExtraction } from "@/hooks/usePropertyExtractions";

interface PropertyDocsPanelProps {
  propertyUuid: string;
  savedModelId?: string | null;
}

/**
 * Per-property extraction control surface inside the Presentation Portal builder.
 * Works for both providers (their own vault + templates) and for
 * clients bound to a provider via client_providers (the provider's
 * active vault docs + active templates). RLS does the scoping.
 *
 * Two LUS gates apply:
 *   • Provider-wide LUS license — when inactive, the entire Smart Doc
 *     Engine surface is hidden (MSP hasn't paid for upkeep).
 *   • Per-property freeze — when this property has a freeze row,
 *     Run Extraction is disabled but existing rows still render and
 *     can be deleted (matches the DB-level safety contract).
 */
export function PropertyDocsPanel({
  propertyUuid,
  savedModelId,
}: PropertyDocsPanelProps) {
  const { extractions, loading, running, backfilling, extract, remove, reindex } =
    usePropertyExtractions(propertyUuid);
  const { templates } = useAvailableTemplates();
  const { docs } = useAvailablePropertyDocs();
  const { isFrozen, freeze: freezeRow } = useLusFreeze(propertyUuid);
  const { isActive: lusActive, loading: lusLoading } = useLusLicense();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [vaultAssetId, setVaultAssetId] = useState<string>("");
  const [templateId, setTemplateId] = useState<string>("");

  const canRun = !!vaultAssetId && !!templateId && !running && !isFrozen && lusActive;

  const handleRun = async () => {
    if (!canRun) return;
    const res = await extract({
      vault_asset_id: vaultAssetId,
      template_id: templateId,
      saved_model_id: savedModelId ?? null,
    });
    if (res) {
      setPickerOpen(false);
      setVaultAssetId("");
      setTemplateId("");
    }
  };

  const noTemplates = templates.length === 0;
  const noDocs = docs.length === 0;

  // Provider-wide LUS gate: hide the entire Smart Doc Engine surface.
  // We still render any pre-existing extractions read-only so the viewer
  // experience persists when LUS lapses (matches the "Standard Mode" spec).
  if (!lusLoading && !lusActive) {
    if (extractions.length === 0) return null;
    return (
      <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Lock className="size-3.5 text-muted-foreground" />
          <Label className="text-xs font-medium">Property Docs</Label>
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
            Read-only
          </Badge>
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Smart Doc Engine is paused. Existing extractions still render in your
          tour. Reactivate your studio license to upload, re-extract, or add
          new docs.
        </p>
        <ul className="space-y-2 pt-1">
          {extractions.map((ex) => (
            <ExtractionRow
              key={ex.id}
              extraction={ex}
              templateLabel={
                templates.find((t) => t.id === ex.template_id)?.label ?? "Template"
              }
              onDelete={() => remove(ex.id)}
            />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-primary" />
            <Label className="text-xs font-medium">Property Docs</Label>
            {extractions.length > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                {extractions.length}
              </Badge>
            )}
            {isFrozen && (
              <Badge
                variant="outline"
                className="h-5 gap-1 border-primary/40 px-1.5 text-[10px] text-primary"
                title={
                  freezeRow?.reason ??
                  "Property is frozen. New extractions are blocked; existing ones still render."
                }
              >
                <Snowflake className="size-2.5" />
                Frozen
              </Badge>
            )}
            {backfilling && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Indexing…
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {extractions.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={reindex}
                disabled={backfilling || running || isFrozen}
                title={
                  isFrozen
                    ? "Re-index disabled while frozen"
                    : "Re-index doc embeddings"
                }
              >
                <RefreshCw
                  className={`size-3 ${backfilling ? "animate-spin" : ""}`}
                />
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setPickerOpen(true)}
                    disabled={noTemplates || noDocs || isFrozen}
                  >
                    {isFrozen ? (
                      <>
                        <Snowflake className="mr-1 size-3" /> Frozen
                      </>
                    ) : (
                      <>
                        <Play className="mr-1 size-3" /> Run Extraction
                      </>
                    )}
                  </Button>
                </span>
              </TooltipTrigger>
              {isFrozen && (
                <TooltipContent>
                  This property is in a freeze. Unfreeze it to run new
                  extractions.
                </TooltipContent>
              )}
            </Tooltip>
          </div>
        </div>

        {noTemplates || noDocs ? (
          <EmptyHint noTemplates={noTemplates} noDocs={noDocs} />
        ) : loading ? (
          <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
            <Loader2 className="mr-1 size-3 animate-spin" /> Loading…
          </div>
        ) : extractions.length === 0 ? (
          <p className="text-[11px] leading-snug text-muted-foreground">
            No extractions yet. Pick a doc + template and run to populate Portal fields.
          </p>
        ) : (
          <ul className="space-y-2">
            {extractions.map((ex) => (
              <ExtractionRow
                key={ex.id}
                extraction={ex}
                templateLabel={
                  templates.find((t) => t.id === ex.template_id)?.label ?? "Template"
                }
                onDelete={() => remove(ex.id)}
              />
            ))}
          </ul>
        )}

        <Dialog
          open={pickerOpen}
          onOpenChange={(o) => {
            setPickerOpen(o);
            if (!o) {
              setVaultAssetId("");
              setTemplateId("");
            }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Run Extraction</DialogTitle>
              <DialogDescription>
                Pick a doc from your vault and a template to extract against.
                Fields will populate the Portal for this property.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Vault Doc</Label>
                <select
                  value={vaultAssetId}
                  onChange={(e) => setVaultAssetId(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select a property doc…</option>
                  {docs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Template</Label>
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select a template…</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label} ({t.doc_kind})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setPickerOpen(false)}
                disabled={running}
              >
                Cancel
              </Button>
              <Button onClick={handleRun} disabled={!canRun}>
                {running ? (
                  <>
                    <Loader2 className="mr-1 size-3.5 animate-spin" /> Extracting…
                  </>
                ) : (
                  "Run"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

function EmptyHint({
  noTemplates,
  noDocs,
}: {
  noTemplates: boolean;
  noDocs: boolean;
}) {
  // Works for both audiences: providers see deep-links into their vault,
  // clients see the copy without broken navigation to pages they can't reach.
  if (noTemplates && noDocs) {
    return (
      <p className="text-[11px] leading-snug text-muted-foreground">
        No property docs or templates available yet. Ask your provider, or
        {" "}
        <Link
          to="/dashboard/vault"
          className="underline hover:text-foreground"
        >
          manage your vault
        </Link>
        .
      </p>
    );
  }
  if (noTemplates) {
    return (
      <p className="text-[11px] leading-snug text-muted-foreground">
        No active templates available yet. Providers can
        {" "}
        <Link
          to="/dashboard/vault/templates"
          className="underline hover:text-foreground"
        >
          publish one
        </Link>
        .
      </p>
    );
  }
  return (
    <p className="text-[11px] leading-snug text-muted-foreground">
      No property docs available yet. Providers can
      {" "}
      <Link
        to="/dashboard/vault"
        className="underline hover:text-foreground"
      >
        upload one
      </Link>
      .
    </p>
  );
}

function ExtractionRow({
  extraction,
  templateLabel,
  onDelete,
}: {
  extraction: PropertyExtraction;
  templateLabel: string;
  onDelete: () => void;
}) {
  const entries = Object.entries(extraction.fields ?? {});
  return (
    <li className="rounded border border-border/50 bg-background p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">{templateLabel}</span>
            <Badge variant="outline" className="h-4 px-1 text-[9px]">
              {extraction.extractor}
            </Badge>
          </div>
          {entries.length === 0 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              No fields extracted — template may not match this doc.
            </p>
          ) : (
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
              {entries.map(([k, v]) => (
                <FieldRow key={k} name={k} value={v} />
              ))}
            </dl>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={onDelete}
          title="Delete extraction (allowed even when frozen)"
        >
          <Trash2 className="size-3 text-destructive" />
        </Button>
      </div>
    </li>
  );
}

function FieldRow({ name, value }: { name: string; value: unknown }) {
  const display =
    value === null || value === undefined
      ? "—"
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return (
    <>
      <dt className="font-mono text-muted-foreground">{name}</dt>
      <dd className="truncate" title={display}>
        {display}
      </dd>
    </>
  );
}
