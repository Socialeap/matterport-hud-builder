import { useMemo, useState } from "react";
import { FileText, Loader2, Play, Trash2 } from "lucide-react";
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

import { usePropertyExtractions } from "@/hooks/usePropertyExtractions";
import { useVaultTemplates } from "@/hooks/useVaultTemplates";
import { useProviderVaultDocs } from "@/hooks/useProviderVaultDocs";
import type { PropertyExtraction } from "@/hooks/usePropertyExtractions";

interface PropertyDocsPanelProps {
  propertyUuid: string;
  savedModelId?: string | null;
}

/**
 * Per-property extraction control surface inside the HUD builder.
 * MSPs pick a vault doc + template and run extraction; extracted
 * fields are rendered inline so they can preview what end-viewers
 * will see.
 */
export function PropertyDocsPanel({
  propertyUuid,
  savedModelId,
}: PropertyDocsPanelProps) {
  const { extractions, loading, running, extract, remove } =
    usePropertyExtractions(propertyUuid);
  const { templates } = useVaultTemplates();
  const { docs } = useProviderVaultDocs();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [vaultAssetId, setVaultAssetId] = useState<string>("");
  const [templateId, setTemplateId] = useState<string>("");

  const activeTemplates = useMemo(
    () => templates.filter((t) => t.is_active),
    [templates],
  );

  const canRun = !!vaultAssetId && !!templateId && !running;

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

  const noTemplates = activeTemplates.length === 0;
  const noDocs = docs.length === 0;

  return (
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
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => setPickerOpen(true)}
          disabled={noTemplates || noDocs}
        >
          <Play className="mr-1 size-3" /> Run Extraction
        </Button>
      </div>

      {noTemplates || noDocs ? (
        <EmptyHint noTemplates={noTemplates} noDocs={noDocs} />
      ) : loading ? (
        <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
          <Loader2 className="mr-1 size-3 animate-spin" /> Loading…
        </div>
      ) : extractions.length === 0 ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          No extractions yet. Pick a doc + template and run to populate HUD fields.
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
              Fields will populate the HUD for this property.
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
                {activeTemplates.map((t) => (
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
  );
}

function EmptyHint({
  noTemplates,
  noDocs,
}: {
  noTemplates: boolean;
  noDocs: boolean;
}) {
  return (
    <p className="text-[11px] leading-snug text-muted-foreground">
      {noTemplates && noDocs
        ? "Add a property doc to your vault and create a template first."
        : noTemplates
          ? (
            <>
              No active templates yet —{" "}
              <Link
                to="/dashboard/vault/templates"
                className="underline hover:text-foreground"
              >
                create one
              </Link>
              .
            </>
          )
          : (
            <>
              No property docs in your vault yet —{" "}
              <Link
                to="/dashboard/vault"
                className="underline hover:text-foreground"
              >
                upload one
              </Link>
              .
            </>
          )}
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
          title="Delete extraction"
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
