import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eye, ExternalLink, RefreshCw, Monitor, Tablet, Smartphone, AlertTriangle } from "lucide-react";
import { buildStudioUrl } from "@/lib/public-url";

type Device = "desktop" | "tablet" | "mobile";

interface StudioPreviewPanelProps {
  slug: string | null;
  tier: "starter" | "pro";
  customDomain: string | null;
  hasPaid: boolean;
  hasUnsavedChanges: boolean;
  /** Bumped after a successful save to force the iframe to reload. */
  refreshKey: number;
}

const DEVICE_WIDTHS: Record<Device, number | null> = {
  desktop: null,
  tablet: 768,
  mobile: 390,
};

export function StudioPreviewPanel({
  slug,
  tier,
  customDomain,
  hasPaid,
  hasUnsavedChanges,
  refreshKey,
}: StudioPreviewPanelProps) {
  const [device, setDevice] = useState<Device>("desktop");
  const [manualBump, setManualBump] = useState(0);

  const trimmedSlug = slug?.trim() || "";
  const publicUrl = trimmedSlug
    ? buildStudioUrl(trimmedSlug, { tier, customDomain })
    : null;
  // Preview mode is intentionally a dashboard-only bypass. The plain public
  // URL remains gated until the MSP activates a paid plan.
  const previewUrl = trimmedSlug ? `/p/${trimmedSlug}?preview=studio` : null;
  const embedUrl = previewUrl;
  const externalUrl = hasPaid ? publicUrl : previewUrl;

  const innerWidth = DEVICE_WIDTHS[device];
  const innerStyle: React.CSSProperties = innerWidth
    ? { width: `${innerWidth}px`, maxWidth: "100%" }
    : { width: "100%" };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Eye className="size-5 text-primary" />
              Studio Preview
            </CardTitle>
            <CardDescription>
              See exactly what visitors will see at your Studio URL — even before publishing. Your URL only goes live to the public after you activate a plan.
            </CardDescription>
          </div>
          {externalUrl && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setManualBump((n) => n + 1)}
                title="Reload preview"
              >
                <RefreshCw className="size-3.5" />
                Refresh
              </Button>
              <Button type="button" size="sm" variant="outline" asChild>
                <a href={externalUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-3.5" />
                  {hasPaid ? "Open live Studio" : "Open preview"}
                </a>
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!embedUrl ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center">
            <p className="text-sm font-medium text-foreground">
              Set your Studio URL slug above and save to see a live preview.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your preview loads directly from your saved branding settings.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="truncate text-xs text-muted-foreground">
                Previewing <span className="font-mono text-foreground">{publicUrl}</span>
              </p>
              <div className="inline-flex rounded-md border border-border bg-background p-0.5">
                <DeviceButton current={device} value="desktop" onClick={setDevice} icon={<Monitor className="size-3.5" />} label="Desktop" />
                <DeviceButton current={device} value="tablet" onClick={setDevice} icon={<Tablet className="size-3.5" />} label="Tablet" />
                <DeviceButton current={device} value="mobile" onClick={setDevice} icon={<Smartphone className="size-3.5" />} label="Mobile" />
              </div>
            </div>

            {hasUnsavedChanges && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                <AlertTriangle className="size-4 shrink-0" />
                <span>
                  You have unsaved changes. Save to update the preview — the embed below shows your last-saved Studio.
                </span>
              </div>
            )}

            <div className="flex justify-center rounded-lg border border-border bg-muted/30 p-2">
              <div style={innerStyle} className="overflow-hidden rounded-md border border-border bg-background shadow-sm">
                <iframe
                  key={`${refreshKey}-${manualBump}`}
                  src={embedUrl}
                  title="Studio preview"
                  className="block h-[700px] w-full bg-background"
                  sandbox="allow-scripts allow-popups allow-forms allow-same-origin"
                  loading="lazy"
                />
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DeviceButton({
  current,
  value,
  onClick,
  icon,
  label,
}: {
  current: Device;
  value: Device;
  onClick: (d: Device) => void;
  icon: React.ReactNode;
  label: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      aria-pressed={active}
      className={
        "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors " +
        (active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")
      }
    >
      {icon}
      {label}
    </button>
  );
}
