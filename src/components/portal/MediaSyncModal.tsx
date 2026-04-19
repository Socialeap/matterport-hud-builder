import { useCallback, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Info, UploadCloud, FileText, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { parseMatterportMhtml, mergeAssets, type ParsedMhtml } from "@/lib/matterport-mhtml";
import type { MediaAsset } from "./types";

const MAX_FILE_BYTES = 60 * 1024 * 1024; // 60 MB safety cap

interface MediaSyncModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current matterportId on the property form (used to flag mismatches). */
  currentMatterportId: string;
  /** Existing multimedia for this property (used for deduping). */
  existing: MediaAsset[];
  /**
   * Called when user confirms. Returns merged list + parsed model id
   * so the parent can optionally backfill the matterportId field.
   */
  onConfirm: (merged: MediaAsset[], parsedModelId: string | null) => void;
}

export function MediaSyncModal({
  open,
  onOpenChange,
  currentMatterportId,
  existing,
  onConfirm,
}: MediaSyncModalProps) {
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedMhtml | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const reset = useCallback(() => {
    setParsed(null);
    setFileName(null);
    setParsing(false);
    setDragOver(false);
  }, []);

  const handleClose = useCallback(
    (next: boolean) => {
      if (!next) reset();
      onOpenChange(next);
    },
    [onOpenChange, reset]
  );

  const handleFile = useCallback(async (file: File) => {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".mhtml") && !lower.endsWith(".mht")) {
      toast.error("Please upload a .mhtml or .mht file");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error(`File too large (max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB)`);
      return;
    }
    setParsing(true);
    setFileName(file.name);
    try {
      const text = await file.text();
      const result = parseMatterportMhtml(text);
      setParsed(result);
      const total = result.videos.length + result.photos.length + result.gifs.length;
      if (total === 0) {
        toast.warning("No media assets detected. Make sure you saved as Single-File MHTML from the Media tab.");
      }
    } catch (err) {
      console.error("MHTML parse failed:", err);
      toast.error("Could not read that file. Please try again.");
      setParsed(null);
      setFileName(null);
    } finally {
      setParsing(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile]
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
      // Reset input so the same file can be re-picked.
      e.target.value = "";
    },
    [handleFile]
  );

  const handleConfirm = useCallback(() => {
    if (!parsed) return;
    const incoming: MediaAsset[] = [...parsed.videos, ...parsed.photos, ...parsed.gifs];
    const merged = mergeAssets(existing, incoming);
    onConfirm(merged, parsed.modelId);
    const added = merged.length - existing.length;
    toast.success(
      added > 0
        ? `Added ${added} new asset${added === 1 ? "" : "s"}`
        : "No new assets — already in sync"
    );
    handleClose(false);
  }, [parsed, existing, onConfirm, handleClose]);

  const modelMismatch =
    parsed?.modelId &&
    currentMatterportId.trim() &&
    parsed.modelId !== currentMatterportId.trim();

  const total = parsed
    ? parsed.videos.length + parsed.photos.length + parsed.gifs.length
    : 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Sync from Matterport</DialogTitle>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="How to sync from Matterport"
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Info className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="right" className="w-80 text-sm">
                <p className="font-semibold text-foreground">Quick Guide</p>
                <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
                  <li>
                    Open your property in Matterport Cloud and click the <strong>Media</strong> tab.
                  </li>
                  <li>
                    Press <kbd className="rounded border bg-muted px-1 text-[10px]">Ctrl</kbd>+<kbd className="rounded border bg-muted px-1 text-[10px]">S</kbd>{" "}
                    (Win) or <kbd className="rounded border bg-muted px-1 text-[10px]">⌘</kbd>+<kbd className="rounded border bg-muted px-1 text-[10px]">S</kbd>{" "}
                    (Mac), or right-click → <em>Save as</em>.
                  </li>
                  <li>
                    In the save dialog, choose <strong>Webpage, Single File (MHTML)</strong>.
                  </li>
                  <li>Drop the saved <code className="text-[11px]">.mhtml</code> file below.</li>
                </ol>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Files never leave your browser — parsing happens locally.
                </p>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  <strong className="text-foreground">Note:</strong> Matterport signs photo URLs with short-lived tokens.
                  Re-sync every ~7 days, or whenever images stop loading. Videos always open in Matterport in a new tab (their CDN blocks embedding).
                </p>
              </PopoverContent>
            </Popover>
          </div>
          <DialogDescription>
            Upload your saved Matterport Media page to import all videos, photos, and GIFs at once.
          </DialogDescription>
        </DialogHeader>

        {!parsed && !parsing && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/20"
            }`}
          >
            <UploadCloud className="mb-3 size-10 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              Drag & drop your <code className="text-xs">.mhtml</code> file
            </p>
            <p className="mt-1 text-xs text-muted-foreground">or</p>
            <label className="mt-2 inline-flex">
              <span>
                <Button type="button" size="sm" variant="outline" asChild>
                  <span className="cursor-pointer">Browse files</span>
                </Button>
              </span>
              <input
                type="file"
                accept=".mhtml,.mht,message/rfc822,multipart/related"
                className="hidden"
                onChange={onPick}
              />
            </label>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Max {Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB · processed locally in your browser
            </p>
          </div>
        )}

        {parsing && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-muted/20 p-8">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Parsing {fileName}…</p>
          </div>
        )}

        {parsed && !parsing && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 size-5 shrink-0 text-primary" />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{fileName}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="text-[11px]">
                      {parsed.videos.length} video{parsed.videos.length === 1 ? "" : "s"}
                    </Badge>
                    <Badge variant="secondary" className="text-[11px]">
                      {parsed.photos.length} photo{parsed.photos.length === 1 ? "" : "s"}
                    </Badge>
                    <Badge variant="secondary" className="text-[11px]">
                      {parsed.gifs.length} GIF{parsed.gifs.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  {parsed.modelId && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Detected Model ID: <code className="rounded bg-muted px-1">{parsed.modelId}</code>
                    </p>
                  )}
                  {!parsed.modelId && (
                    <p className="mt-2 text-[11px] text-destructive">
                      Could not detect a Model ID in this file.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {modelMismatch && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <div>
                  <p className="font-medium text-foreground">Model ID mismatch</p>
                  <p className="mt-0.5 text-muted-foreground">
                    The current property is <code className="rounded bg-muted px-1">{currentMatterportId}</code>{" "}
                    but this file is for <code className="rounded bg-muted px-1">{parsed.modelId}</code>. Confirm
                    only if you intended to add these assets to this property.
                  </p>
                </div>
              </div>
            )}

            {!currentMatterportId.trim() && parsed.modelId && (
              <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                <p className="text-muted-foreground">
                  We'll auto-fill the Matterport Model ID with{" "}
                  <code className="rounded bg-muted px-1">{parsed.modelId}</code>.
                </p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={reset}>
                Choose different file
              </Button>
              <Button size="sm" onClick={handleConfirm} disabled={total === 0}>
                Add {total} asset{total === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
