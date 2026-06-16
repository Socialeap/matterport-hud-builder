import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState, useSyncExternalStore } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Upload,
  Download,
  RotateCcw,
  Loader2,
  ShieldCheck,
  Lock,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  FileCode2,
} from "lucide-react";
import {
  describeDisposition,
  runUpgradeSession,
  type InspectionReport,
  type DispositionDescriptor,
  type UpgradeReport,
  type DownloadPayload,
  type LegacyProfileReport,
  type LegacyBootstrapReport,
} from "@/lib/presentation-upgrade-session.mjs";
import { createUpgradeController } from "@/lib/presentation-upgrade-controller.mjs";
import type {
  UpgradeController,
  UpgradeControllerState,
} from "@/lib/presentation-upgrade-controller.mjs";
import { getBundledRuntimeSources } from "@/lib/portal/upgrade-runtime-sources";
import {
  checkPresentationHtmlSize,
  MAX_PRESENTATION_HTML_BYTES,
  MB,
} from "@/lib/limits";

export const Route = createFileRoute("/_authenticated/admin/presentation-updates")({
  component: AdminPresentationUpdates,
});

// ── Module-scoped session store ─────────────────────────────────────────────
// The upgrade session (selected file, inspection, report, download) lives at
// module scope so it survives route unmount/remount — navigating to another
// admin tab and returning preserves the user's selection and summary. The
// raw HTML stays in a module variable (never rendered, never persisted to
// disk), matching the prior in-memory-only handling. State is cleared only
// when the user presses Clear, selects a new file, or reloads the page.

type SessionSnapshot = {
  fileName: string | null;
  fileSize: number | null;
  inspection: InspectionReport | null;
  legacyProfile: LegacyProfileReport | null;
  report: UpgradeReport | LegacyBootstrapReport | null;
  download: DownloadPayload | null;
  error: string | null;
  reading: boolean;
  upgrading: boolean;
};

const initialSnapshot: SessionSnapshot = {
  fileName: null,
  fileSize: null,
  inspection: null,
  legacyProfile: null,
  report: null,
  download: null,
  error: null,
  reading: false,
  upgrading: false,
};

let moduleSnapshot: SessionSnapshot = initialSnapshot;
let moduleHtml: string | null = null;
const listeners = new Set<() => void>();

function subscribeSession(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function getSessionSnapshot() {
  return moduleSnapshot;
}
function applyModuleState(p: UpgradeControllerState) {
  if ("html" in p) moduleHtml = p.html ?? null;
  const next: SessionSnapshot = { ...moduleSnapshot };
  let changed = false;
  const keys: (keyof SessionSnapshot)[] = [
    "fileName",
    "fileSize",
    "inspection",
    "legacyProfile",
    "report",
    "download",
    "error",
    "reading",
    "upgrading",
  ];
  for (const k of keys) {
    if (k in p) {
      const raw = (p as Record<string, unknown>)[k];
      const coerced =
        k === "reading" || k === "upgrading" ? !!raw : (raw ?? null);
      if ((next as Record<string, unknown>)[k] !== coerced) {
        (next as Record<string, unknown>)[k] = coerced;
        changed = true;
      }
    }
  }
  if (changed) {
    moduleSnapshot = next;
    listeners.forEach((l) => l());
  }
}

let moduleController: UpgradeController | null = null;
function getController(): UpgradeController {
  if (moduleController === null) {
    moduleController = createUpgradeController({
      checkSize: checkPresentationHtmlSize,
      readFile: (file) => (file as File).text(),
      runUpgrade: (args) => runUpgradeSession(args),
      sink: {
        setState: applyModuleState,
        toastSuccess: (m) => toast.success(m),
        toastError: (m) => toast.error(m),
      },
    });
  }
  return moduleController;
}

// ── Small presentational helpers ────────────────────────────────────────────

const TONE = {
  action: { border: "border-primary/40", bg: "bg-primary/5", color: "text-primary", Icon: ArrowRight },
  success: { border: "border-green-500/40", bg: "bg-green-500/5", color: "text-green-600", Icon: CheckCircle2 },
  warning: { border: "border-amber-500/40", bg: "bg-amber-500/5", color: "text-amber-600", Icon: AlertTriangle },
  info: { border: "border-blue-500/40", bg: "bg-blue-500/5", color: "text-blue-600", Icon: Info },
  error: { border: "border-destructive/40", bg: "bg-destructive/5", color: "text-destructive", Icon: XCircle },
} as const;

function fmtBytes(n: number): string {
  if (n >= MB) {
    const mb = n / MB;
    return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm text-foreground">{children}</span>
    </div>
  );
}

function Swatch({ color }: { color: string | null }) {
  if (!color) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block size-4 rounded border border-border"
        style={{ backgroundColor: color }}
      />
      <span className="font-mono text-sm">{color}</span>
    </span>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

function AdminPresentationUpdates() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Subscribe to the module-scoped session store so the UI rehydrates the
  // user's selection + summary on remount (e.g. after navigating between
  // admin tabs).
  const snapshot = useSyncExternalStore(
    subscribeSession,
    getSessionSnapshot,
    getSessionSnapshot,
  );
  const {
    fileName,
    fileSize,
    inspection,
    legacyProfile,
    report,
    download,
    error,
    reading,
    upgrading,
  } = snapshot;

  const [dragActive, setDragActive] = useState(false);

  const disposition: DispositionDescriptor | null = inspection
    ? describeDisposition(inspection, legacyProfile)
    : null;

  const controller = getController();

  const handleClear = () => {
    controller.clear();
    if (inputRef.current) inputRef.current.value = "";
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (f) void controller.select(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void controller.select(f);
  };

  const handleUpgrade = () => {
    const html = moduleHtml;
    // Upgrade is allowed only when the disposition exposes it (patchable, or a
    // recognized legacy bootstrap profile). The session routes to the patcher
    // or the legacy adapter accordingly.
    if (!disposition || !disposition.canUpgrade || html === null) return;
    // Trusted runtime sources from the application bundle ONLY (resolved inside
    // the controller's guarded try); the controller binds this to its session.
    void controller.upgrade({
      html,
      filename: fileName,
      getRuntimeSources: getBundledRuntimeSources,
    });
  };

  const handleDownload = () => {
    if (!download || report?.download.available !== true) return;
    let url: string | null = null;
    try {
      const blob = new Blob([download.html], { type: download.mimeType });
      url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = download.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success(`Downloaded ${download.filename}`);
    } catch {
      toast.error("Download failed.");
    } finally {
      if (url) {
        const u = url;
        // Revoke after the download has been handed to the browser.
        setTimeout(() => URL.revokeObjectURL(u), 1000);
      }
    }
  };

  const busy = reading || upgrading;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Presentation Updates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upgrade an independently hosted Builder presentation's{" "}
          <span className="font-mono">index.html</span> to the current runtime, in
          place, and download the replacement file.
        </p>
      </div>

      {/* Upload / idle */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">1 · Select the presentation file</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDrop={onDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragActive(false);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              dragActive
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/40"
            }`}
          >
            {reading ? (
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            ) : (
              <Upload className="size-6 text-muted-foreground" />
            )}
            <div className="text-sm font-medium">
              Drop an <span className="font-mono">.html</span> file here, or click to browse
            </div>
            <div className="text-xs text-muted-foreground">
              One presentation index.html · max {fmtBytes(MAX_PRESENTATION_HTML_BYTES)} · ZIP
              packages not supported
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".html,.htm,text/html"
              className="hidden"
              onChange={onInputChange}
            />
          </div>

          <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Processing happens entirely in your browser. The file is read as inert
              text, never rendered or executed, and is <strong>never uploaded to a
              server or retained</strong>.
            </span>
          </div>

          {(fileName || error) && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
              <div className="flex min-w-0 items-center gap-2">
                <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium">{fileName ?? "—"}</span>
                {fileSize !== null && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {fmtBytes(fileSize)}
                  </span>
                )}
              </div>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleClear}>
                <RotateCcw className="size-3.5" />
                Clear
              </Button>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <XCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Inspection + disposition */}
      {inspection && disposition && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">2 · Inspection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Family">{inspection.family ?? "—"}</Field>
              <Field label="Schema">
                {inspection.packageSchema ?? "—"}
              </Field>
              <Field label="Runtime">{inspection.runtimeVersion ?? "—"}</Field>
              <Field label="Disposition">
                <span className="font-mono text-xs">{inspection.outcome}</span>
              </Field>
            </div>

            <DispositionPanel disposition={disposition} reasons={inspection.reasons} />

            {disposition.canUpgrade && (
              <Button onClick={handleUpgrade} disabled={busy} className="gap-2">
                {upgrading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="size-4" />
                )}
                {upgrading ? "Upgrading…" : "Upgrade presentation"}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Report + download */}
      {report &&
        ("mode" in report && report.mode === "legacy" ? (
          <LegacyReportCard
            report={report}
            downloadable={download !== null && report.download.available === true}
            onDownload={handleDownload}
          />
        ) : (
          <ReportCard
            report={report as UpgradeReport}
            downloadable={download !== null && report.download.available === true}
            onDownload={handleDownload}
          />
        ))}
    </div>
  );
}

function DispositionPanel({
  disposition,
  reasons,
}: {
  disposition: DispositionDescriptor;
  reasons: string[];
}) {
  const tone = TONE[disposition.tone];
  const Icon = tone.Icon;
  return (
    <div className={`flex items-start gap-3 rounded-lg border p-4 ${tone.border} ${tone.bg}`}>
      <Icon className={`mt-0.5 size-5 shrink-0 ${tone.color}`} />
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-semibold">{disposition.headline}</div>
        <p className="text-sm text-muted-foreground">{disposition.guidance}</p>
        {disposition.legacy && disposition.legacy.capabilities.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <span className="text-xs text-muted-foreground">Detected:</span>
            {disposition.legacy.capabilities.map((c) => (
              <Badge key={c} variant="secondary" className="text-xs">
                {c.replace(/_/g, " ")}
              </Badge>
            ))}
          </div>
        )}
        {Array.isArray(reasons) && reasons.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Inspector detail
            </summary>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
              {reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function ReportCard({
  report,
  downloadable,
  onDownload,
}: {
  report: UpgradeReport;
  downloadable: boolean;
  onDownload: () => void;
}) {
  const patched = report.outcome === "patched";
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg">3 · Validation report</CardTitle>
          <Badge variant={patched ? "default" : "destructive"}>{report.outcome}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Rejection (non-patched) */}
        {report.rejection && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0 space-y-1">
              <div className="font-medium text-destructive">
                {report.rejection.message ?? "Upgrade rejected"}
                {report.rejection.code ? (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {report.rejection.code}
                  </span>
                ) : null}
              </div>
              {report.rejection.reasons.length > 0 && (
                <ul className="list-inside list-disc text-xs text-muted-foreground">
                  {report.rejection.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Summary grid (patched) */}
        {patched && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Runtime">
                <span className="inline-flex items-center gap-1.5">
                  {report.runtime.from ?? "—"}
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                  <span className="font-medium">{report.runtime.to ?? "—"}</span>
                </span>
              </Field>
              <Field label="Schema">
                <span className="inline-flex items-center gap-1.5">
                  {report.schema.from ?? "—"}
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                  <span className="font-medium">{report.schema.to ?? "—"}</span>
                </span>
              </Field>
              <Field label="Family">
                {report.family.from ?? "—"}
                {report.family.to && report.family.to !== report.family.from
                  ? ` → ${report.family.to}`
                  : ""}
              </Field>
              <Field label="Accent">
                <Swatch color={report.branding?.accentColor ?? null} />
              </Field>
              <Field label="HUD background">
                <Swatch color={report.branding?.hudBgColor ?? null} />
              </Field>
              <Field label="Preservation">
                {report.preservation.verified ? (
                  <span className="inline-flex items-center gap-1.5 text-green-600">
                    <CheckCircle2 className="size-4" />
                    Verified ({report.preservation.untouchedSegmentCount} segments)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-destructive">
                    <XCircle className="size-4" />
                    Failed
                  </span>
                )}
              </Field>
            </div>

            {/* Mutations summary — operation count vs. how many actually
                changed are kept distinct (all spans are replaced and all metas
                rewritten by definition; only some change value). */}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Runtime spans">
                {report.mutations.spans.length} replaced;{" "}
                {report.mutations.spans.filter((s) => s.changed).length} changed
              </Field>
              <Field label="Metadata values">
                {report.mutations.metas.length} rewritten;{" "}
                {report.mutations.metas.filter((m) => m.changed).length} changed
              </Field>
            </div>
          </>
        )}

        {/* Warnings (incl. the external atlas-manifest limitation) */}
        {report.warnings.length > 0 && (
          <div className="space-y-2">
            {report.warnings.map((w, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700"
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        {/* Deep technical details (collapsible) */}
        {patched && (
          <details className="rounded-md border border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium hover:bg-muted/40">
              Technical detail
            </summary>
            <div className="space-y-4 border-t border-border p-3">
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  SHA-256 (before → after)
                </div>
                <div className="break-all font-mono text-xs">
                  <div>before: {report.sha256.before}</div>
                  <div>after: {report.sha256.after ?? "—"}</div>
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Runtime spans (5)
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {report.mutations.spans.map((s) => (
                      <tr key={s.name} className="border-t border-border/60">
                        <td className="py-1 font-mono">{s.name}</td>
                        <td className="py-1 text-muted-foreground">
                          {s.changed ? "changed" : "unchanged"}
                        </td>
                        <td className="py-1 text-right text-muted-foreground">
                          {s.beforeBytes} → {s.afterBytes} B
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Metadata values (4)
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {report.mutations.metas.map((m) => (
                      <tr key={m.name} className="border-t border-border/60">
                        <td className="py-1 font-mono">{m.name}</td>
                        <td className="py-1 text-right font-mono text-muted-foreground">
                          {m.from ?? "∅"} → {m.to ?? "∅"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Preservation
                </div>
                <div className="text-xs text-muted-foreground">
                  {report.preservation.detail}
                </div>
              </div>

              {report.notes.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Notes
                  </div>
                  <ul className="list-inside list-disc text-xs text-muted-foreground">
                    {report.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        )}

        {/* Download */}
        <div className="flex items-center gap-3 pt-1">
          <Button onClick={onDownload} disabled={!downloadable} className="gap-2">
            <Download className="size-4" />
            Download upgraded HTML
          </Button>
          {downloadable ? (
            <span className="truncate font-mono text-xs text-muted-foreground">
              {report.replacementFilename}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              Download is unavailable for this result.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function LegacyReportCard({
  report,
  downloadable,
  onDownload,
}: {
  report: LegacyBootstrapReport;
  downloadable: boolean;
  onDownload: () => void;
}) {
  const ok = report.outcome === "bootstrapped";
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg">3 · Legacy bootstrap report</CardTitle>
          <Badge variant={ok ? "default" : "destructive"}>{report.outcome}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {report.rejection && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0 space-y-1">
              <div className="font-medium text-destructive">
                {report.rejection.message}
                {report.rejection.code ? (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {report.rejection.code}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {ok && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Profile">
                <span className="font-mono text-xs">{report.profileId}</span>
              </Field>
              <Field label="Generation">{report.generationLabel}</Field>
              <Field label="Runtime">
                <span className="inline-flex items-center gap-1.5">
                  {report.runtime.from ?? "—"}
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                  <span className="font-medium">{report.runtime.to ?? "—"}</span>
                </span>
              </Field>
              <Field label="Accent">
                <Swatch color={report.branding?.accentColor ?? null} />
              </Field>
              <Field label="HUD background">
                <Swatch color={report.branding?.hudBgColor ?? null} />
              </Field>
              <Field label="Preservation">
                {report.preservation.verified ? (
                  <span className="inline-flex items-center gap-1.5 text-green-600">
                    <CheckCircle2 className="size-4" />
                    Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-destructive">
                    <XCircle className="size-4" />
                    Failed
                  </span>
                )}
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Runtime regions">
                {report.regions.filter((r) => r.op !== "insert").length} replaced/rewritten
              </Field>
              <Field label="Metadata">4 markers inserted; 5 sentinels added</Field>
            </div>

            {report.capabilities.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs text-muted-foreground">Preserved features:</span>
                {report.capabilities.map((c) => (
                  <Badge key={c} variant="secondary" className="text-xs">
                    {c.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
            )}
          </>
        )}

        {report.warnings.length > 0 && (
          <div className="space-y-2">
            {report.warnings.map((w, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700"
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        {ok && (
          <details className="rounded-md border border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium hover:bg-muted/40">
              Technical detail
            </summary>
            <div className="space-y-4 border-t border-border p-3">
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  SHA-256 (before → after)
                </div>
                <div className="break-all font-mono text-xs">
                  <div>before: {report.sha256.before}</div>
                  <div>after: {report.sha256.after ?? "—"}</div>
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Mutation regions ({report.regions.length})
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {report.regions.map((r) => (
                      <tr key={r.key} className="border-t border-border/60">
                        <td className="py-1 font-mono">{r.key}</td>
                        <td className="py-1 text-right text-muted-foreground">{r.op}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Preservation
                </div>
                <div className="text-xs text-muted-foreground">{report.preservation.detail}</div>
              </div>
            </div>
          </details>
        )}

        <div className="flex items-center gap-3 pt-1">
          <Button onClick={onDownload} disabled={!downloadable} className="gap-2">
            <Download className="size-4" />
            Download upgraded HTML
          </Button>
          {downloadable ? (
            <span className="truncate font-mono text-xs text-muted-foreground">
              {report.replacementFilename}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              Download is unavailable for this result.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
