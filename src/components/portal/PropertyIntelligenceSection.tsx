import { useEffect, useMemo, useRef, useState } from "react";
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
  const { refresh: refreshDocs } = useAvailablePropertyDocs();
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

  const hasTemplates = templates.length > 0;
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

        await refreshDocs();
        closeDialog();

        setBusyMessage("Fetching & indexing URL…");
        const res = await extractFromUrl({
          vault_asset_id: newAsset.id,
          url: parsedUrl.toString(),
          template_id: templateId || null,
          saved_model_id: savedModelId,
        });
        if (res) {
          toast.success(
            `Indexed ${res.chunks_indexed} chunks from ${parsedUrl.hostname}`,
          );
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
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Upload failed: ${msg}`);
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
          {extractions.length > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {extractions.length} doc{extractions.length === 1 ? "" : "s"}
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
      ) : extractions.length === 0 ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          No documents attached yet. Upload a datasheet to enable Ask.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {extractions.map((ex) => (
            <DocRow key={ex.id} extraction={ex} onDelete={() => remove(ex.id)} />
          ))}
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

function DocRow({
  extraction,
  onDelete,
}: {
  extraction: PropertyExtraction;
  onDelete: () => void;
}) {
  const fieldCount = Object.keys(extraction.fields ?? {}).length;
  const chunkCount = Array.isArray(extraction.chunks)
    ? extraction.chunks.length
    : 0;
  return (
    <li className="flex items-center justify-between gap-2 rounded-md bg-background/60 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">
          {fieldCount} field{fieldCount === 1 ? "" : "s"} · {chunkCount} chunks
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {new Date(extraction.extracted_at).toLocaleDateString()}
        </span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
        onClick={onDelete}
        title="Remove this extraction"
      >
        <Trash2 className="size-3" />
      </Button>
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
