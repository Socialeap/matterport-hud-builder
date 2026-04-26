import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  FileText,
  Library,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  Snowflake,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

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

import { useAuth } from "@/hooks/use-auth";
import { usePropertyExtractions } from "@/hooks/usePropertyExtractions";
import { useAvailableTemplates } from "@/hooks/useAvailableTemplates";
import { useAvailablePropertyDocs } from "@/hooks/useAvailablePropertyDocs";
import { useLusFreeze } from "@/hooks/useLusFreeze";
import { useLusLicense } from "@/hooks/useLusLicense";
import type { PropertyExtraction } from "@/hooks/usePropertyExtractions";
import { supabase } from "@/integrations/supabase/client";
import { uploadVaultAsset } from "@/lib/storage";
import { induceSchema } from "@/lib/extraction/induce";
import type { JsonSchema } from "@/lib/extraction/provider";
import { useIndexing } from "@/lib/rag/indexing-context";
import { IndexingStatusBadge } from "@/components/portal/IndexingStatusBadge";
import type { PropertyModel } from "./types";

interface Props {
  models: PropertyModel[];
  savedModelId?: string | null;
  /** Fired only when an extraction completes successfully (URL or file). */
  onExtractionSuccess?: () => void;
}

/**
 * Per-builder section that promotes the property-doc upload entrypoint to a
 * first-class surface. One row per property model. Works in two modes:
 *
 *  1. Curated templates exist — user picks a template, doc is extracted
 *     against it (matches PropertyDocsPanel behaviour).
 *  2. No templates — "Upload & Auto-Detect" runs induce-schema on PDFs to
 *     synthesise a hidden template, then extracts. Non-PDF formats use a
 *     synthetic empty schema and rely on chunk text for the Ask panel.
 */
export function PropertyIntelligenceSection({
  models,
  savedModelId,
  onExtractionSuccess,
}: Props) {
  const { templates, refresh: refreshTemplates } = useAvailableTemplates();
  const { isActive: lusActive, loading: lusLoading } = useLusLicense();
  const indexing = useIndexing();

  // Section-level "ready for Ask AI" tally — derived from the shared
  // indexing context so both panels see the same numbers.
  const readyCount = models.filter(
    (m) => indexing.statusFor(m.id).phase === "ready",
  ).length;
  const indexingCount = models.filter(
    (m) => indexing.statusFor(m.id).phase === "indexing",
  ).length;

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-snug text-foreground/80">
        <p className="flex items-start gap-2">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <span>
            Upload a property datasheet (PDF, DOCX, TXT, RTF) <em>or</em>
            paste a public listing URL for each model. Extracted text is
            indexed locally so visitors can ask questions via the{" "}
            <strong>Ask</strong> button on the published tour.
          </span>
        </p>
      </div>

      {models.length > 0 && lusActive && (
        <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/60 px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            Ask AI is{" "}
            <strong className="text-foreground">
              ready for {readyCount} of {models.length}
            </strong>{" "}
            propert{models.length === 1 ? "y" : "ies"}.
          </span>
          {indexingCount > 0 && (
            <span className="inline-flex items-center gap-1 text-primary">
              <Loader2 className="size-3 animate-spin" />
              {indexingCount} indexing…
            </span>
          )}
        </div>
      )}

      {!lusLoading && !lusActive ? (
        <div className="rounded-md border border-border/60 bg-muted/20 p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="size-3.5" />
            Smart Doc Engine is paused. Reactivate your studio license to
            upload new property documents.
          </div>
        </div>
      ) : models.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 bg-muted/10 p-4 text-center text-xs text-muted-foreground">
          Add a property model first to attach intelligence documents.
        </p>
      ) : (
        <ul className="space-y-2">
          {models.map((m, idx) => (
            <ModelRow
              key={m.id}
              index={idx}
              model={m}
              templates={templates}
              savedModelId={savedModelId ?? null}
              onTemplatesChanged={refreshTemplates}
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
  templates: ReturnType<typeof useAvailableTemplates>["templates"];
  savedModelId: string | null;
  onTemplatesChanged: () => void;
  onExtractionSuccess?: () => void;
}

/** Lightweight asset descriptor used for rendering the per-asset status list. */
interface AssetMeta {
  id: string;
  label: string;
  asset_url: string;
  mime_type: string | null;
}

function ModelRow({
  index,
  model,
  templates,
  savedModelId,
  onTemplatesChanged,
  onExtractionSuccess,
}: ModelRowProps) {
  const { user } = useAuth();
  const {
    extractions,
    loading,
    running,
    failuresByAsset,
    extract,
    extractFromUrl,
    remove,
  } = usePropertyExtractions(model.id);
  const { docs: vaultDocs, refresh: refreshDocs } = useAvailablePropertyDocs();
  const { isFrozen, freeze: freezeRow } = useLusFreeze(model.id);

  // Tracks vault_assets uploaded/registered in this session for this property.
  // Merged with extractions to render the truth: pending / failed / indexed.
  const [trackedAssets, setTrackedAssets] = useState<AssetMeta[]>([]);
  const trackAsset = (a: AssetMeta) =>
    setTrackedAssets((prev) =>
      prev.some((p) => p.id === a.id) ? prev : [a, ...prev],
    );

  // On mount, hydrate trackedAssets from already-existing extractions for this
  // property AND any provider-owned property_doc vault_assets that match the
  // ones we have extractions for. This keeps post-reload state honest.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      // 1) Pull asset metadata for any extraction rows this property has.
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

  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  // "From vault…" picker — runs a curated template against an existing
  // provider-published doc. This was the one feature only PropertyDocsPanel
  // exposed; bringing it inline here closes that gap.
  const [vaultPickerOpen, setVaultPickerOpen] = useState(false);
  const [pickedVaultAssetId, setPickedVaultAssetId] = useState<string>("");
  const [pickedTemplateId, setPickedTemplateId] = useState<string>("");

  const hasTemplates = templates.length > 0;
  const hasVaultDocs = vaultDocs.length > 0;
  const displayName =
    model.propertyName?.trim() ||
    model.name?.trim() ||
    `Property ${index + 1}`;

  const openDialog = () => {
    setFile(null);
    setSourceUrl("");
    setUrlError(null);
    setLabel("");
    setTemplateId(hasTemplates ? templates[0].id : "");
    setOpen(true);
  };

  const closeDialog = () => {
    setOpen(false);
    setFile(null);
    setSourceUrl("");
    setUrlError(null);
    setLabel("");
    setTemplateId("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const detectedMime = useMemo(() => detectMimeFromFile(file), [file]);

  const trimmedUrl = sourceUrl.trim();
  const parsedUrl = useMemo(() => {
    if (!trimmedUrl) return null;
    try {
      const u = new URL(trimmedUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u;
    } catch {
      return null;
    }
  }, [trimmedUrl]);
  const urlMode = !file && !!trimmedUrl;
  const effectiveLabel =
    label.trim() || (urlMode && parsedUrl ? parsedUrl.hostname : "");
  const submitDisabled =
    busy ||
    (!file && !trimmedUrl) ||
    (file != null && !label.trim()) ||
    (urlMode && !parsedUrl) ||
    !effectiveLabel;

  const handleUrlChange = (val: string) => {
    setSourceUrl(val);
    if (!val.trim()) {
      setUrlError(null);
      return;
    }
    try {
      const u = new URL(val.trim());
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        setUrlError("URL must start with http:// or https://");
      } else {
        setUrlError(null);
      }
    } catch {
      setUrlError("Enter a valid URL (e.g. https://...)");
    }
  };

  const handleUpload = async () => {
    if (!user) return;
    if (submitDisabled) return;
    setBusy(true);
    try {
      // ── URL-only branch ──────────────────────────────────────────────
      if (urlMode && parsedUrl) {
        setBusyMessage("Registering URL…");
        const finalLabel = effectiveLabel;
        const { data: newAsset, error: insertErr } = await supabase
          .from("vault_assets")
          .insert({
            provider_id: user.id,
            category_type: "property_doc" as const,
            label: finalLabel,
            asset_url: parsedUrl.toString(),
            storage_path: null,
            mime_type: "text/uri-list",
            file_size_bytes: 0,
            is_active: true,
          })
          .select()
          .single();
        if (insertErr || !newAsset) {
          toast.error("Failed to register URL — try again.");
          return;
        }

        // Track immediately so the row shows "Pending" while we extract.
        trackAsset({
          id: newAsset.id,
          label: finalLabel,
          asset_url: parsedUrl.toString(),
          mime_type: "text/uri-list",
        });

        await refreshDocs();
        closeDialog();

        setBusyMessage("Fetching & indexing URL…");
        // URL submissions ALWAYS use the per-host auto template the function
        // creates internally — never the curated picker (semantic mismatch).
        const res = await extractFromUrl({
          vault_asset_id: newAsset.id,
          url: parsedUrl.toString(),
          template_id: null,
          saved_model_id: savedModelId,
        });
        if (res) {
          toast.success(
            `Indexed ${res.chunks_indexed} chunks from ${parsedUrl.hostname}`,
          );
          onExtractionSuccess?.();
        }
        return;
      }

      // ── File branch (unchanged behaviour) ────────────────────────────
      if (!file || !label.trim()) return;

      // 1. Determine template — curated pick OR auto-induced for walk-ins.
      let activeTemplateId: string = templateId;

      if (!activeTemplateId) {
        setBusyMessage("Analyzing document structure…");
        const auto = await ensureAutoTemplate({
          providerId: user.id,
          file,
          label: label.trim(),
          mimeType: detectedMime,
        });
        if (!auto) {
          toast.error(
            "Could not auto-detect a template. Try a different file or contact your provider for a curated template.",
          );
          return;
        }
        activeTemplateId = auto;
        onTemplatesChanged();
      }

      // 2. Upload bytes to storage + register the vault_assets row.
      setBusyMessage("Uploading document…");
      const uploaded = await uploadVaultAsset(user.id, "property_doc", file);
      if (!uploaded) {
        toast.error("File upload failed — check your connection and try again.");
        return;
      }

      const { data: newAsset, error: insertErr } = await supabase
        .from("vault_assets")
        .insert({
          provider_id: user.id,
          category_type: "property_doc" as const,
          label: label.trim(),
          asset_url: uploaded.url,
          storage_path: uploaded.path,
          mime_type: detectedMime,
          file_size_bytes: file.size,
          is_active: true,
        })
        .select()
        .single();

      if (insertErr || !newAsset) {
        toast.error("Failed to register document — try again.");
        return;
      }

      trackAsset({
        id: newAsset.id,
        label: label.trim(),
        asset_url: uploaded.url,
        mime_type: detectedMime,
      });

      await refreshDocs();
      closeDialog();

      // 3. Run extraction.
      setBusyMessage("Extracting & indexing…");
      const res = await extract({
        vault_asset_id: newAsset.id,
        template_id: activeTemplateId,
        saved_model_id: savedModelId,
      });
      if (res) {
        toast.success(`Indexed ${res.chunks_indexed} chunks for ${displayName}`);
        onExtractionSuccess?.();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Upload failed: ${msg}`);
    } finally {
      setBusy(false);
      setBusyMessage("");
    }
  };

  // ── Build the merged asset view: union(trackedAssets, extractions) ────
  const assetById = useMemo(() => {
    const m = new Map<string, AssetMeta>();
    for (const a of trackedAssets) m.set(a.id, a);
    // Make sure every extraction has at least a stub asset entry so it
    // renders even if the metadata fetch hasn't returned yet.
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
      toast.error("Cannot re-index: source URL/path missing.");
      return;
    }
    const isUrl = /^https?:\/\//i.test(asset.asset_url);
    if (!isUrl) {
      toast.message(
        "Re-index from file is not supported yet — re-upload the file instead.",
      );
      return;
    }
    setBusy(true);
    setBusyMessage("Re-indexing…");
    try {
      const res = await extractFromUrl({
        vault_asset_id: asset.id,
        url: asset.asset_url,
        template_id: null,
        saved_model_id: savedModelId,
      });
      if (res) {
        toast.success(`Re-indexed ${res.chunks_indexed} chunks`);
        onExtractionSuccess?.();
      }
    } finally {
      setBusy(false);
      setBusyMessage("");
    }
  };

  return (
    <li className="rounded-md border border-border/60 bg-muted/10 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <BookOpen className="size-4 shrink-0 text-primary" />
          <span className="truncate text-sm font-medium">{displayName}</span>
          {mergedAssets.length > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {mergedAssets.length} doc{mergedAssets.length === 1 ? "" : "s"}
              {indexedCount > 0 && ` · ${indexedCount} indexed`}
            </Badge>
          )}
          {isFrozen && (
            <Badge
              variant="outline"
              className="h-5 gap-1 border-primary/40 px-1.5 text-[10px] text-primary"
              title={
                freezeRow?.reason ??
                "Property is frozen. New uploads are blocked."
              }
            >
              <Snowflake className="size-2.5" />
              Frozen
            </Badge>
          )}
          <IndexingStatusBadge
            propertyUuid={model.id}
            disableRetry={busy || running || isFrozen}
            compact
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={openDialog}
          disabled={isFrozen || busy || running || !user}
        >
          {busy ? (
            <>
              <Loader2 className="mr-1 size-3 animate-spin" />
              {busyMessage || "Working…"}
            </>
          ) : (
            <>
              <Upload className="mr-1 size-3" />
              {hasTemplates ? "Upload Doc" : "Upload & Auto-Detect"}
            </>
          )}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-2 text-xs text-muted-foreground">
          <Loader2 className="mr-1 size-3 animate-spin" /> Loading…
        </div>
      ) : mergedAssets.length === 0 ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          No documents attached yet. Upload a datasheet to enable Ask.
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

      <Dialog open={open} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Property Intelligence</DialogTitle>
            <DialogDescription>
              Attach a datasheet (PDF, DOCX, TXT, RTF) <em>or</em> paste a
              public listing URL for <strong>{displayName}</strong>. Legacy{" "}
              <code>.doc</code> is not supported — save as <code>.docx</code>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">File</Label>
              <label
                htmlFor={`pis-file-${model.id}`}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent"
              >
                <Upload className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm">
                  {file ? file.name : "Choose a file…"}
                </span>
                <input
                  ref={inputRef}
                  id={`pis-file-${model.id}`}
                  type="file"
                  accept=".pdf,.txt,.rtf,.doc,.docx,application/pdf,text/plain,text/rtf,application/rtf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setFile(f);
                    if (f && !label) {
                      setLabel(f.name.replace(/\.[^.]+$/, ""));
                    }
                  }}
                />
              </label>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`pis-url-${model.id}`} className="text-xs">
                Source URL <span className="text-muted-foreground">(optional)</span>
              </Label>
              <input
                id={`pis-url-${model.id}`}
                type="url"
                value={sourceUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                disabled={!!file}
                placeholder="https://www.zillow.com/homedetails/..."
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
              />
              {urlError ? (
                <p className="text-[10px] leading-snug text-destructive">
                  {urlError}
                </p>
              ) : (
                <p className="text-[10px] leading-snug text-muted-foreground">
                  {file
                    ? "URL ignored when a file is attached."
                    : "Paste a public listing page (Zillow, Realtor.com, agent site, etc.)."}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`pis-label-${model.id}`} className="text-xs">
                Label{" "}
                {urlMode && (
                  <span className="text-muted-foreground">(optional)</span>
                )}
              </Label>
              <input
                id={`pis-label-${model.id}`}
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={
                  urlMode && parsedUrl
                    ? parsedUrl.hostname
                    : "e.g. Floor Plan — Unit 4B"
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>

            {hasTemplates ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Template</Label>
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Auto-detect from document</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label} ({t.doc_kind})
                    </option>
                  ))}
                </select>
                <p className="text-[10px] leading-snug text-muted-foreground">
                  Pick a curated template or leave on auto-detect.
                </p>
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-primary/30 bg-primary/5 p-2 text-[11px] leading-snug text-foreground/80">
                <Sparkles className="mr-1 inline size-3 text-primary" />
                No curated templates available. The structure will be
                auto-detected from the document.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={submitDisabled}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                  {busyMessage || "Uploading…"}
                </>
              ) : (
                <>
                  <Upload className="mr-1 size-3.5" /> Upload & Index
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

/**
 * Row that renders the merged status for a single vault_asset:
 *   - Indexed (green) if a successful extraction exists with chunks
 *   - Failed  (red, with Re-index) if failuresByAsset has an entry
 *   - Pending (amber, animated) otherwise
 *
 * Also surfaces the diagnostics.low_content_warning chip when the function
 * indicated that the page text was thin (e.g. SPA with hydration content).
 */
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

  // Determine status. Failure beats Pending; Indexed beats both when
  // chunks are present.
  let status: "indexed" | "failed" | "pending";
  if (extraction && chunkCount > 0) status = "indexed";
  else if (failure) status = "failed";
  else status = "pending";

  // Diagnostics chip — best-effort: the function's success payload may
  // surface diagnostics.low_content_warning in the toast detail; for failed
  // rows we don't have it here, but the failure tooltip already explains.
  const lowContent =
    extraction &&
    chunkCount < 3 &&
    isUrl &&
    status === "indexed";

  return (
    <li className="flex items-center justify-between gap-2 rounded-md bg-background/60 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate" title={asset.label}>
          {asset.label}
        </span>

        {status === "indexed" && (
          <Badge
            variant="outline"
            className="h-5 shrink-0 gap-1 border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-700 dark:text-emerald-300"
            title={`${fieldCount} field${fieldCount === 1 ? "" : "s"} · ${chunkCount} chunks`}
          >
            <CheckCircle2 className="size-2.5" />
            Indexed
          </Badge>
        )}
        {status === "pending" && (
          <Badge
            variant="outline"
            className="h-5 shrink-0 gap-1 border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] text-amber-700 dark:text-amber-300"
            title="Indexing in progress…"
          >
            <Loader2 className="size-2.5 animate-spin" />
            Pending
          </Badge>
        )}
        {status === "failed" && failure && (
          <Badge
            variant="outline"
            className="h-5 shrink-0 gap-1 border-destructive/40 bg-destructive/10 px-1.5 text-[10px] text-destructive"
            title={`${failure.stage}: ${failure.detail}`}
          >
            <AlertTriangle className="size-2.5" />
            Failed
          </Badge>
        )}
        {lowContent && (
          <span
            className="shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1 text-[10px] text-amber-700 dark:text-amber-300"
            title="Page text was thin — consider uploading a PDF for better answers."
          >
            Thin page
          </span>
        )}

        {extraction && (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {new Date(extraction.extracted_at).toLocaleDateString()}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {status === "failed" && isUrl && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={onReindex}
            disabled={running}
            title={`Retry: ${failure?.stage ?? "extraction"}`}
          >
            <RefreshCw className="mr-1 size-3" />
            Re-index
          </Button>
        )}
        {onDelete && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            title="Remove this extraction"
          >
            <Trash2 className="size-3" />
          </Button>
        )}
      </div>
    </li>
  );
}

// ── helpers ────────────────────────────────────────────────────────────

function detectMimeFromFile(file: File | null): string {
  if (!file) return "application/pdf";
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "txt":
      return "text/plain";
    case "rtf":
      return "application/rtf";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}

/**
 * Creates (or returns an existing) hidden auto-template for this provider so
 * an upload can be extracted without prior MSP setup. PDFs go through
 * induce-schema for richer field detection. Other formats fall back to a
 * minimal empty schema — chunk text alone still powers the Ask panel.
 */
async function ensureAutoTemplate(args: {
  providerId: string;
  file: File;
  label: string;
  mimeType: string;
}): Promise<string | null> {
  const { providerId, file, label, mimeType } = args;
  const isPdf = mimeType === "application/pdf";

  let schema: JsonSchema = { type: "object", properties: {}, required: [] };
  if (isPdf) {
    try {
      const result = await induceSchema(file);
      if (result?.schema) schema = result.schema;
    } catch (err) {
      console.warn("[property-intelligence] induce-schema failed:", err);
      // Fall through with empty schema — chunks still get indexed.
    }
  }

  const { data, error } = await supabase
    .from("vault_templates")
    .insert({
      provider_id: providerId,
      label: `Auto: ${label}`,
      doc_kind: "property_datasheet",
      field_schema: schema as unknown as never,
      extractor: "pdfjs_heuristic",
      is_active: true,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[property-intelligence] template insert failed:", error);
    return null;
  }
  return data.id;
}
