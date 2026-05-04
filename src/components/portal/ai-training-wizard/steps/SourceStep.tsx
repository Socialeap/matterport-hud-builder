import { useRef, useState } from "react";
import { ChevronDown, FileText, Library, Link2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAvailablePropertyDocs } from "@/hooks/useAvailablePropertyDocs";
import {
  checkUploadSize,
  uploadKindForMime,
  uploadLimitDescription,
} from "@/lib/limits";

import { PropertyInfoSheetTipsDialog } from "@/components/portal/PropertyInfoSheetTipsDialog";

import type { WizardSource } from "../types";

interface Props {
  source: WizardSource;
  onChange: (source: WizardSource) => void;
  onBack: () => void;
  onContinue: () => void;
}

const ACCEPT =
  ".pdf,.txt,.rtf,.doc,.docx,application/pdf,text/plain,text/rtf,application/rtf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Step 2 — single drop-zone that accepts a file OR a public URL, plus a
 * collapsible "Use a document already in your library" expander.
 *
 * No Label field — the wizard auto-names assets `{Property} — {ISO date}`
 * downstream so the user never has to invent one.
 */
export function SourceStep({ source, onChange, onBack, onContinue }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [urlText, setUrlText] = useState(
    source?.kind === "url" ? source.url : "",
  );
  const [urlError, setUrlError] = useState<string | null>(null);

  const { docs, loading } = useAvailablePropertyDocs();

  const setFile = (file: File | null) => {
    if (!file) {
      onChange(null);
      return;
    }
    // Map the dropped file to a known UploadKind so the limit applied
    // here matches the one the edge function will enforce. Unknown
    // MIME types fall back to the strictest applicable cap (PDF) so
    // we never accept a file the server would reject.
    const kind = uploadKindForMime(file.type) ?? "pdf_bytes";
    const check = checkUploadSize(file.size, kind);
    if (!check.ok) {
      toast.error(check.message);
      onChange(null);
      // Clear the input so the same file can be re-picked after the
      // user shrinks it.
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    onChange({ kind: "file", file });
    setUrlText("");
  };

  const handleUrl = (val: string) => {
    setUrlText(val);
    if (!val.trim()) {
      onChange(source?.kind === "url" ? null : source);
      setUrlError(null);
      return;
    }
    try {
      const u = new URL(val.trim());
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        setUrlError("URL must start with http:// or https://");
        return;
      }
      setUrlError(null);
      onChange({ kind: "url", url: u.toString() });
    } catch {
      setUrlError("Enter a valid URL (e.g. https://...)");
    }
  };

  const pickedFile = source?.kind === "file" ? source.file : null;
  const pickedVaultId = source?.kind === "vault" ? source.assetId : null;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">
          What should the AI read?
        </h3>
        <p className="text-xs leading-snug text-muted-foreground">
          Drop a brochure, datasheet, or floorplan. PDF works best.
        </p>
      </header>

      {/* Drop zone */}
      <label
        htmlFor="ai-wizard-file"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0] ?? null;
          if (f) setFile(f);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
          dragOver
            ? "border-primary bg-primary/10"
            : pickedFile
              ? "border-primary/40 bg-primary/5"
              : "border-border bg-muted/20 hover:border-primary/40 hover:bg-primary/5",
        )}
      >
        {pickedFile ? (
          <>
            <FileText className="size-6 text-primary" />
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">
                {pickedFile.name}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {(pickedFile.size / 1024).toFixed(0)} KB · click to change
              </p>
            </div>
          </>
        ) : (
          <>
            <Upload className="size-6 text-muted-foreground" />
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">
                Drop a document here, or click to browse
              </p>
              <p className="text-[11px] text-muted-foreground">
                PDF, DOCX, TXT or RTF · {uploadLimitDescription("pdf_bytes")}
              </p>
            </div>
          </>
        )}
        <input
          ref={inputRef}
          id="ai-wizard-file"
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>

      {/* OR url */}
      <div className="space-y-1.5">
        <label
          htmlFor="ai-wizard-url"
          className="flex items-center gap-1.5 text-xs font-medium text-foreground"
        >
          <Link2 className="size-3" />
          …or paste a public listing URL
        </label>
        <input
          id="ai-wizard-url"
          type="url"
          value={urlText}
          onChange={(e) => handleUrl(e.target.value)}
          disabled={!!pickedFile}
          placeholder="https://www.zillow.com/homedetails/..."
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
        />
        {urlError && (
          <p className="text-[11px] text-destructive">{urlError}</p>
        )}
      </div>

      {/* Library expander */}
      <div className="rounded-md border border-border/60 bg-muted/10">
        <button
          type="button"
          onClick={() => setLibraryOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 p-2.5 text-left text-xs font-medium text-foreground hover:bg-muted/30"
          aria-expanded={libraryOpen}
        >
          <span className="flex items-center gap-1.5">
            <Library className="size-3.5 text-muted-foreground" />
            Use a document already in your library
            {docs.length > 0 && (
              <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                {docs.length}
              </span>
            )}
          </span>
          <ChevronDown
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              libraryOpen && "rotate-180",
            )}
          />
        </button>
        {libraryOpen && (
          <div className="border-t border-border/60 p-2">
            {loading ? (
              <p className="px-1 py-2 text-[11px] text-muted-foreground">
                Loading…
              </p>
            ) : docs.length === 0 ? (
              <p className="px-1 py-2 text-[11px] text-muted-foreground">
                No documents in your library yet — upload one above.
              </p>
            ) : (
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {docs.map((doc) => {
                  const isPicked = pickedVaultId === doc.id;
                  return (
                    <li key={doc.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setFile(null);
                          setUrlText("");
                          setUrlError(null);
                          onChange({
                            kind: "vault",
                            assetId: doc.id,
                            label: doc.label,
                          });
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors",
                          isPicked
                            ? "bg-primary/10 text-primary"
                            : "text-foreground hover:bg-muted/40",
                        )}
                      >
                        <FileText className="size-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{doc.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onContinue} disabled={!source}>
          Continue
        </Button>
      </div>
    </div>
  );
}
