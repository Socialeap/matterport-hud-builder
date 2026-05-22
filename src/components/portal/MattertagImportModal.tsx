import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Tag,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
  Bookmark,
  Terminal,
  ClipboardPaste,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import type { MattertagData } from "./types";

const MAX_TAGS = 200;

const SHARED_QUERY =
  "query Get($id:ID!){model(id:$id){mattertags{id label description media anchorPosition{x y z}}}}";

interface MattertagImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 11-char Matterport model id for the property being imported. */
  matterportId: string;
  /** Friendly label for the dialog header (propertyName || name || fallback). */
  propertyLabel: string;
  /** Already-imported tags — drives the "X already synced" hint. */
  existing: MattertagData[];
  /** Called when the user confirms the parsed tags. */
  onConfirm: (tags: MattertagData[]) => void;
}

interface ParseResult {
  ok: true;
  tags: MattertagData[];
  parsedModelId: string | null;
}
interface ParseError {
  ok: false;
  error: string;
}

export function MattertagImportModal({
  open,
  onOpenChange,
  matterportId,
  propertyLabel,
  existing,
  onConfirm,
}: MattertagImportModalProps) {
  const [pasted, setPasted] = useState("");
  const [parseState, setParseState] = useState<ParseResult | ParseError | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState<"bookmarklet" | "devtools" | null>(null);

  const showUrl = matterportId
    ? `https://my.matterport.com/show/?m=${matterportId}`
    : "";

  // Bookmarklet body: works from any Matterport tour tab. Reads the
  // model id from window.location, fetches the GraphQL endpoint using
  // the user's own browser session, then copies the JSON to clipboard.
  // The user installs this ONCE by dragging it to their bookmarks bar.
  const bookmarkletHref = useMemo(() => buildBookmarklet(), []);
  const devtoolsSnippet = useMemo(() => buildDevtoolsSnippet(), []);

  const reset = useCallback(() => {
    setPasted("");
    setParseState(null);
    setCopiedSnippet(null);
  }, []);

  const handleClose = useCallback(
    (next: boolean) => {
      if (!next) reset();
      onOpenChange(next);
    },
    [onOpenChange, reset]
  );

  const tryParse = useCallback((text: string) => {
    if (!text.trim()) {
      setParseState(null);
      return;
    }
    const result = parsePastedPayload(text);
    setParseState(result);
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const txt = e.clipboardData.getData("text/plain");
      if (txt) {
        e.preventDefault();
        setPasted(txt);
        tryParse(txt);
      }
    },
    [tryParse]
  );

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      if (!navigator?.clipboard?.readText) {
        toast.error("Clipboard access not available in this browser.");
        return;
      }
      const txt = await navigator.clipboard.readText();
      if (!txt.trim()) {
        toast.message("Clipboard is empty.", {
          description: "Run the bookmarklet on your Matterport tour first.",
        });
        return;
      }
      setPasted(txt);
      tryParse(txt);
    } catch (err) {
      console.error("clipboard.readText failed:", err);
      toast.error("Could not read clipboard — paste manually below.");
    }
  }, [tryParse]);

  const handleCopy = useCallback(
    async (text: string, which: "bookmarklet" | "devtools") => {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedSnippet(which);
        setTimeout(() => setCopiedSnippet((c) => (c === which ? null : c)), 2000);
      } catch (err) {
        console.error("clipboard.writeText failed:", err);
        toast.error("Could not copy to clipboard.");
      }
    },
    []
  );

  const handleOpenTour = useCallback(() => {
    if (!showUrl) return;
    window.open(showUrl, "_blank", "noopener,noreferrer");
  }, [showUrl]);

  const handleConfirm = useCallback(() => {
    if (!parseState || !parseState.ok) return;
    onConfirm(parseState.tags);
    toast.success(
      `Imported ${parseState.tags.length} mattertag${parseState.tags.length === 1 ? "" : "s"}.`
    );
    handleClose(false);
  }, [parseState, onConfirm, handleClose]);

  // Reset transient state whenever the modal closes externally.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const parsedTags = parseState?.ok ? parseState.tags : [];
  const modelMismatch =
    parseState?.ok &&
    parseState.parsedModelId &&
    matterportId &&
    parseState.parsedModelId !== matterportId;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="size-4 text-primary" />
            Import Mattertags
          </DialogTitle>
          <DialogDescription>
            For <span className="font-medium text-foreground">{propertyLabel}</span>
            {matterportId && (
              <>
                {" · "}
                <code className="rounded bg-muted px-1 text-[11px]">{matterportId}</code>
              </>
            )}
            {existing.length > 0 && (
              <>
                {" · "}
                <span className="text-[11px]">
                  {existing.length} already synced — re-importing replaces them.
                </span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Step 1: open Matterport */}
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-start gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                1
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Open your Matterport tour
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Opens the tour in a new tab so the bookmarklet / console can
                  read your browser's Matterport session.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 text-xs"
                  onClick={handleOpenTour}
                  disabled={!showUrl}
                >
                  <ExternalLink className="mr-1 size-3.5" />
                  Open tour
                </Button>
              </div>
            </div>
          </div>

          {/* Step 2: run a script in that tab */}
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-start gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                2
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Copy the tags to your clipboard
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Pick whichever method your browser supports.
                </p>
                <Tabs defaultValue="bookmarklet" className="mt-2">
                  <TabsList className="h-7">
                    <TabsTrigger value="bookmarklet" className="text-[11px] h-6 px-2">
                      <Bookmark className="mr-1 size-3" />
                      Bookmarklet
                    </TabsTrigger>
                    <TabsTrigger value="devtools" className="text-[11px] h-6 px-2">
                      <Terminal className="mr-1 size-3" />
                      DevTools console
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="bookmarklet" className="mt-2 space-y-2">
                    <ol className="space-y-1 pl-4 text-[11px] text-muted-foreground list-decimal">
                      <li>Make sure your bookmarks bar is visible.</li>
                      <li>
                        Drag this button onto it (one-time setup):{" "}
                        <a
                          href={bookmarkletHref}
                          onClick={(e) => {
                            e.preventDefault();
                            toast.message(
                              "Drag this link to your bookmarks bar instead of clicking it.",
                            );
                          }}
                          className="ml-1 inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20"
                          draggable
                        >
                          <Bookmark className="size-3" />
                          3DPS — Copy Mattertags
                        </a>
                      </li>
                      <li>
                        On your Matterport tab, click the bookmarklet. It copies
                        the tags + shows a confirmation.
                      </li>
                    </ol>
                    <div className="flex items-start gap-1.5 rounded border border-border/40 bg-background/60 p-2 text-[10px] text-muted-foreground">
                      <Info className="mt-0.5 size-3 shrink-0" />
                      <span>
                        If your browser blocks dragging from a dialog (or you
                        use a corporate browser), use the DevTools tab instead.
                      </span>
                    </div>
                  </TabsContent>

                  <TabsContent value="devtools" className="mt-2 space-y-2">
                    <ol className="space-y-1 pl-4 text-[11px] text-muted-foreground list-decimal">
                      <li>
                        On your Matterport tab, open DevTools (
                        <kbd className="rounded border bg-muted px-1 text-[10px]">F12</kbd>{" "}
                        or{" "}
                        <kbd className="rounded border bg-muted px-1 text-[10px]">
                          ⌥⌘I
                        </kbd>
                        ).
                      </li>
                      <li>
                        Open the <strong>Console</strong> tab. If prompted, type{" "}
                        <code className="rounded bg-muted px-1 text-[10px]">
                          allow pasting
                        </code>{" "}
                        and press Enter.
                      </li>
                      <li>Paste the snippet below and press Enter.</li>
                    </ol>
                    <div className="relative rounded border border-border/60 bg-background/80">
                      <pre className="max-h-32 overflow-auto p-2 pr-10 text-[10px] leading-snug text-foreground whitespace-pre-wrap break-all">
                        {devtoolsSnippet}
                      </pre>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="absolute right-1 top-1 h-6 w-6 p-0"
                        onClick={() => handleCopy(devtoolsSnippet, "devtools")}
                        title="Copy snippet"
                      >
                        {copiedSnippet === "devtools" ? (
                          <Check className="size-3.5 text-primary" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                      </Button>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </div>

          {/* Step 3: paste the result back here */}
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-start gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                3
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">
                    Paste the copied data here
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px]"
                    onClick={handlePasteFromClipboard}
                  >
                    <ClipboardPaste className="mr-1 size-3.5" />
                    Paste
                  </Button>
                </div>
                <Textarea
                  value={pasted}
                  onChange={(e) => {
                    setPasted(e.target.value);
                    tryParse(e.target.value);
                  }}
                  onPaste={handlePaste}
                  placeholder='Paste the JSON copied by the bookmarklet (e.g. {"modelId":"...","mattertags":[...]})'
                  className="mt-2 min-h-[80px] font-mono text-[11px]"
                  spellCheck={false}
                />
              </div>
            </div>
          </div>

          {/* Parse feedback */}
          {parseState && !parseState.ok && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-foreground">Could not parse</p>
                <p className="mt-0.5 text-muted-foreground">{parseState.error}</p>
              </div>
            </div>
          )}

          {parseState?.ok && (
            <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">
                  Ready to import {parsedTags.length} mattertag
                  {parsedTags.length === 1 ? "" : "s"}
                </p>
                <Badge variant="secondary" className="text-[10px]">
                  Sorted by elevation
                </Badge>
              </div>
              {modelMismatch && (
                <div className="flex items-start gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[11px]">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-600" />
                  <span className="text-muted-foreground">
                    This payload is for model{" "}
                    <code className="rounded bg-muted px-1">{parseState.parsedModelId}</code>{" "}
                    but the current property uses{" "}
                    <code className="rounded bg-muted px-1">{matterportId}</code>.
                    Confirm only if intended.
                  </span>
                </div>
              )}
              <div className="max-h-40 overflow-auto rounded border border-border/40 bg-background/60 divide-y divide-border/40">
                {parsedTags.map((t) => (
                  <div key={t.id} className="flex items-start gap-2 p-2">
                    <Tag className="mt-0.5 size-3 shrink-0 text-primary" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-[11px] font-medium text-foreground">
                        {t.label || <em className="text-muted-foreground">(no label)</em>}
                      </p>
                      {t.description && (
                        <p className="line-clamp-1 text-[10px] text-muted-foreground">
                          {t.description}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                      y={t.anchorPosition.y.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => handleClose(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={!parseState?.ok || parsedTags.length === 0}
            >
              Save {parsedTags.length > 0 ? parsedTags.length : ""} mattertag
              {parsedTags.length === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Bookmarklet / DevTools snippet builders ─────────────────────── */

function buildBookmarklet(): string {
  // Body must stay single-statement-y to URL-encode cleanly. Reads the
  // model id from the current Matterport tab's URL so the same
  // bookmarklet works across every model the user opens.
  const body = `(function(){var m=new URL(location.href).searchParams.get('m')||(location.pathname.match(/\\/models\\/([A-Za-z0-9]{11})/)||[])[1];if(!m){alert('3DPS: Not on a Matterport tour page (no ?m= ID found).');return;}fetch('https://api.matterport.com/api/models/graph',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({query:${JSON.stringify(SHARED_QUERY)},variables:{id:m}})}).then(function(r){return r.json();}).then(function(d){var tags=(d&&d.data&&d.data.model&&d.data.model.mattertags)||[];var payload=JSON.stringify({modelId:m,mattertags:tags});return navigator.clipboard.writeText(payload).then(function(){alert('3DPS: Copied '+tags.length+' mattertag(s). Paste back in your 3DPS Builder.');});}).catch(function(e){alert('3DPS: Failed. '+(e&&e.message?e.message:e));});})();`;
  return `javascript:${encodeURIComponent(body)}`;
}

function buildDevtoolsSnippet(): string {
  return `(async()=>{const m=new URL(location.href).searchParams.get('m')||(location.pathname.match(/\\/models\\/([A-Za-z0-9]{11})/)||[])[1];if(!m){console.error('Not on a Matterport tour page');return;}const r=await fetch('https://api.matterport.com/api/models/graph',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({query:${JSON.stringify(SHARED_QUERY)},variables:{id:m}})});const d=await r.json();const tags=(d&&d.data&&d.data.model&&d.data.model.mattertags)||[];const payload=JSON.stringify({modelId:m,mattertags:tags});await navigator.clipboard.writeText(payload);console.log('3DPS: Copied '+tags.length+' mattertag(s). Paste back in your Builder.');})();`;
}

/* ─── Pasted-payload parser ───────────────────────────────────────── */

function parsePastedPayload(text: string): ParseResult | ParseError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return {
      ok: false,
      error:
        "That doesn't look like JSON. Paste the value the bookmarklet / console copied to your clipboard.",
    };
  }
  // Accept either { modelId, mattertags: [...] } (our bookmarklet shape)
  // or a bare array (if the user pulled the data themselves).
  let modelId: string | null = null;
  let rawTags: unknown;
  if (Array.isArray(parsed)) {
    rawTags = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as { modelId?: unknown; mattertags?: unknown };
    if (typeof obj.modelId === "string") modelId = obj.modelId.trim();
    rawTags = obj.mattertags;
  }
  if (!Array.isArray(rawTags)) {
    return {
      ok: false,
      error:
        "JSON parsed but didn't contain a mattertags array. Re-run the bookmarklet and paste again.",
    };
  }
  const cleaned: MattertagData[] = [];
  for (const entry of rawTags.slice(0, MAX_TAGS)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as {
      id?: unknown;
      label?: unknown;
      description?: unknown;
      media?: unknown;
      anchorPosition?: { x?: unknown; y?: unknown; z?: unknown } | null;
    };
    const id = String(e.id ?? "").slice(0, 64).trim();
    if (!id) continue;
    const mediaRaw = String(e.media ?? "").trim();
    const media = /^https?:\/\//i.test(mediaRaw) ? mediaRaw.slice(0, 2048) : "";
    const ap = e.anchorPosition || {};
    cleaned.push({
      id,
      label: String(e.label ?? "").slice(0, 200),
      description: String(e.description ?? "").slice(0, 4000),
      media,
      anchorPosition: {
        x: Number(ap.x) || 0,
        y: Number(ap.y) || 0,
        z: Number(ap.z) || 0,
      },
    });
  }
  if (cleaned.length === 0) {
    return {
      ok: false,
      error:
        "No usable mattertags in that payload. The model may be private or have no tags.",
    };
  }
  // Highest elevation first — matches the runtime drawer's display order.
  cleaned.sort((a, b) => b.anchorPosition.y - a.anchorPosition.y);
  return { ok: true, tags: cleaned, parsedModelId: modelId };
}
