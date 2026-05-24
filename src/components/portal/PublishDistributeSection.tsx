import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { QRCodeCanvas } from "qrcode.react";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Info,
  LinkIcon,
  Loader2,
  LogOut,
  QrCode,
  Rocket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useNetlifyConnection } from "@/hooks/useNetlifyConnection";
import { getNetlifyAccessToken } from "@/lib/portal/netlify.functions";
import {
  deployZipToNetlify,
  isValidNetlifySlug,
  slugifyForNetlify,
} from "@/lib/portal/netlify-deploy";

/**
 * Imperative handle the parent passes in so the download flow can hand
 * the in-memory zip Blob to the Publish flow instead of saving to disk.
 */
export interface PublishInterceptor {
  /** Set by the Publish flow before triggering the parent's download. */
  set: (handler: (blob: Blob) => Promise<void> | void) => void;
  /** Cleared automatically after one call; can be called manually too. */
  clear: () => void;
  /** Called by the parent right before triggering the browser download. */
  consume: (blob: Blob) => Promise<boolean>;
}

interface PublishDistributeSectionProps {
  propertyName?: string;
  accentColor: string;
  canDownload: boolean;
  onDownload: () => void;
  downloading: boolean;
  downloadingLabel?: string;
  downloadDisabledReason?: string | null;
}

type ShareLink = {
  key: string;
  src: string | null;
  label: string;
  description: string;
  qr?: boolean;
};

const SHARE_LINKS: ShareLink[] = [
  { key: "main", src: null, label: "Main Link", description: "Use anywhere you want to share the full presentation.", qr: true },
  { key: "mls", src: "mls", label: "MLS / Unbranded Link", description: "Use only if it meets the rules of your MLS or brokerage." },
  { key: "marketplace", src: "marketplace", label: "Zillow / Homes.com Link", description: "Use where listing platforms allow a virtual-tour or external property link." },
  { key: "realtor", src: "realtor", label: "Realtor.com Link", description: "Use where Realtor.com or similar marketplaces allow virtual-tour URLs." },
  { key: "email", src: "email", label: "Email Link", description: "Use in email campaigns and direct follow-ups." },
  { key: "social", src: "social", label: "Social Link", description: "Use in social posts and DMs." },
  { key: "open-house", src: "open-house", label: "Open House Link", description: "Use on open house signage or sign-in materials.", qr: true },
  { key: "flyer", src: "flyer", label: "Flyer Link", description: "Use on printed flyers and brochures.", qr: true },
  { key: "business-card", src: "business-card", label: "Business Card Link", description: "Use on cards or leave-behind materials.", qr: true },
  { key: "window-sign", src: "window-sign", label: "Window Sign Link", description: "Use on storefront/window displays.", qr: true },
];

function slugifyForFilename(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "presentation";
}

function buildShareUrl(baseUrl: string, src: string | null): string {
  try {
    const url = new URL(baseUrl);
    if (src) url.searchParams.set("src", src);
    else url.searchParams.delete("src");
    return url.toString();
  } catch {
    return baseUrl;
  }
}

/**
 * forwardRef so the parent (HudBuilderSandbox) can pass a PublishInterceptor
 * ref into runDownload — when set, the parent hands the Blob to Publish
 * instead of triggering a browser download.
 */
export const PublishDistributeSection = forwardRef<
  PublishInterceptor,
  PublishDistributeSectionProps
>(function PublishDistributeSection(
  {
    propertyName,
    accentColor,
    canDownload,
    onDownload,
    downloading,
    downloadingLabel,
    downloadDisabledReason,
  },
  ref,
) {
  const netlify = useNetlifyConnection();
  const fetchAccessToken = useServerFn(getNetlifyAccessToken);

  const [slug, setSlug] = useState(() => slugifyForNetlify(propertyName || "presentation"));
  const [publishing, setPublishing] = useState(false);
  const [publishStep, setPublishStep] = useState<string>("");
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const interceptorHandlerRef = useRef<((blob: Blob) => Promise<void> | void) | null>(null);
  useImperativeHandle(ref, () => ({
    set: (handler) => { interceptorHandlerRef.current = handler; },
    clear: () => { interceptorHandlerRef.current = null; },
    consume: async (blob: Blob) => {
      const h = interceptorHandlerRef.current;
      if (!h) return false;
      interceptorHandlerRef.current = null;
      await h(blob);
      return true;
    },
  }), []);

  const qrContainerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setQrRef = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) qrContainerRefs.current.set(key, el);
    else qrContainerRefs.current.delete(key);
  }, []);

  const filenameSlug = useMemo(
    () => slugifyForFilename(propertyName || "presentation"),
    [propertyName],
  );

  const handleCopy = useCallback(async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      toast.error("Couldn't copy to clipboard. Long-press the link to copy manually.");
    }
  }, []);

  const downloadQrPng = useCallback((linkKey: string, fileSlug: string) => {
    const container = qrContainerRefs.current.get(linkKey);
    const canvas = container?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) {
      toast.error("QR code is still rendering — try again in a moment.");
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) { toast.error("Couldn't export QR. Try again."); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filenameSlug}-${fileSlug}-qr.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, "image/png");
  }, [filenameSlug]);

  const slugValid = isValidNetlifySlug(slug);

  const handlePublish = useCallback(async () => {
    if (!netlify.connection?.connected) {
      toast.error("Connect your Netlify account first.");
      return;
    }
    if (!slugValid) {
      toast.error("Pick a URL using lowercase letters, numbers, and hyphens only.");
      return;
    }

    setPublishing(true);
    setLiveUrl(null);

    try {
      setPublishStep("Fetching Netlify credentials…");
      const { accessToken } = await fetchAccessToken({});

      // Set the interceptor BEFORE triggering the parent's download.
      setPublishStep("Packaging presentation…");
      const blob: Blob = await new Promise((resolve, reject) => {
        interceptorHandlerRef.current = (b: Blob) => {
          resolve(b);
        };
        try {
          onDownload();
        } catch (err) {
          interceptorHandlerRef.current = null;
          reject(err);
        }
        // Safety timeout: 2 minutes for big packages.
        setTimeout(() => reject(new Error("Package build timed out.")), 120_000);
      });

      const result = await deployZipToNetlify({
        blob,
        desiredSlug: slug,
        accessToken,
        onProgress: (label) => setPublishStep(label),
      });

      setLiveUrl(result.liveUrl);
      if (result.fellBackToAutoName) {
        toast.warning(
          `"${slug}" was already taken on Netlify. Published at ${result.siteName}.netlify.app instead — you can rename in Netlify.`,
        );
      } else {
        toast.success("Your presentation is live!");
      }
    } catch (err) {
      console.error("[publish] failed", err);
      interceptorHandlerRef.current = null;
      const msg = err instanceof Error ? err.message : "Publish failed.";
      toast.error(msg);
    } finally {
      setPublishing(false);
      setPublishStep("");
    }
  }, [fetchAccessToken, netlify.connection?.connected, onDownload, slug, slugValid]);

  const shareLinksWithUrls = useMemo(() => {
    if (!liveUrl) return [] as Array<ShareLink & { fullUrl: string }>;
    return SHARE_LINKS.map((link) => ({ ...link, fullUrl: buildShareUrl(liveUrl, link.src) }));
  }, [liveUrl]);

  const publishDisabled =
    publishing ||
    downloading ||
    !canDownload ||
    !netlify.connection?.connected ||
    !slugValid;

  const publishDisabledReason = !canDownload
    ? downloadDisabledReason
    : !netlify.connection?.connected
      ? "Connect your Netlify account to publish."
      : !slugValid
        ? "Pick a valid URL (lowercase letters, numbers, hyphens)."
        : null;

  return (
    <div className="space-y-5">
      {/* Step 1 — Connect Netlify */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-start gap-3">
          <div
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
            style={{ backgroundColor: accentColor }}
          >
            1
          </div>
          <div className="flex-1 space-y-2">
            <div>
              <h4 className="text-sm font-semibold text-foreground">
                Connect your Netlify account
              </h4>
              <p className="text-xs text-muted-foreground">
                Publishing sends your presentation to <strong>your own</strong> free Netlify account.
                Don't have one? You can sign up inside the popup in about 20 seconds.
              </p>
            </div>

            {netlify.connection?.connected ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2 text-xs">
                <Check className="size-4 text-emerald-500" />
                <span className="text-foreground">
                  Connected as{" "}
                  <strong>{netlify.connection.email || netlify.connection.fullName || "your Netlify account"}</strong>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-7 gap-1 text-xs"
                  onClick={() => void netlify.disconnect()}
                >
                  <LogOut className="size-3.5" />
                  Disconnect
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5 text-white"
                  style={{ backgroundColor: accentColor }}
                  onClick={() => void netlify.connect()}
                  disabled={netlify.connecting || netlify.loading}
                >
                  {netlify.connecting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Waiting for Netlify…
                    </>
                  ) : (
                    <>
                      <LinkIcon className="size-4" />
                      Connect Netlify Account
                    </>
                  )}
                </Button>
              </div>
            )}

            {netlify.lastError && (
              <p className="text-xs text-destructive">{netlify.lastError}</p>
            )}
          </div>
        </div>
      </div>

      {/* Step 2 — Choose URL + Publish */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-start gap-3">
          <div
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
            style={{ backgroundColor: accentColor }}
          >
            2
          </div>
          <div className="flex-1 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-foreground">
                Pick your URL & publish
              </h4>
              <p className="text-xs text-muted-foreground">
                Choose a friendly subdomain. We'll package your presentation and deploy it to your Netlify account.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="netlify-slug" className="text-xs font-medium">
                Your Netlify URL
              </Label>
              <div className="flex items-stretch overflow-hidden rounded-md border bg-background">
                <span className="flex items-center bg-muted/40 px-2.5 font-mono text-xs text-muted-foreground">https://</span>
                <Input
                  id="netlify-slug"
                  value={slug}
                  onChange={(e) => setSlug(slugifyForNetlify(e.target.value))}
                  placeholder="your-property-tour"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                  className="h-9 flex-1 rounded-none border-0 font-mono text-xs focus-visible:ring-0"
                  disabled={publishing}
                />
                <span className="flex items-center bg-muted/40 px-2.5 font-mono text-xs text-muted-foreground">.netlify.app</span>
              </div>
              {!slugValid && slug.length > 0 && (
                <p className="text-xs text-destructive">
                  Use lowercase letters, numbers, and hyphens only (no leading/trailing hyphen).
                </p>
              )}
            </div>

            <Button
              type="button"
              size="sm"
              className="gap-1.5 text-white"
              style={{ backgroundColor: accentColor }}
              onClick={() => void handlePublish()}
              disabled={publishDisabled}
              title={publishDisabledReason ?? undefined}
            >
              {publishing ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {publishStep || "Publishing…"}
                </>
              ) : (
                <>
                  <Rocket className="size-4" />
                  Publish Presentation
                </>
              )}
            </Button>

            {/* Secondary download fallback — agents may still want the file. */}
            <div className="pt-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={!canDownload || downloading || publishing}
                onClick={onDownload}
                title={downloadDisabledReason ?? undefined}
              >
                <Download className="size-4" />
                {downloading
                  ? (downloadingLabel || "Preparing…")
                  : "Or download package (.zip)"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Listing Launch Kit (Share Kit) */}
      {liveUrl && shareLinksWithUrls.length > 0 && (
        <div className="space-y-4 rounded-lg border-2 p-4" style={{ borderColor: accentColor }}>
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Rocket className="size-5" style={{ color: accentColor }} />
              Your presentation is live
            </h3>
            <p className="mt-1 break-all font-mono text-sm text-foreground">
              <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="underline">
                {liveUrl}
              </a>
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Use the links and QR codes below to distribute your 3D presentation through listing platforms,
              email, social media, flyers, business cards, window signs, and open houses.
            </p>
          </div>

          <ul className="space-y-3">
            {shareLinksWithUrls.map((link) => {
              const justCopied = copiedKey === `link:${link.key}`;
              return (
                <li key={link.key} className="rounded-md border bg-muted/20 p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{link.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{link.description}</p>
                      <p className="mt-1 break-all font-mono text-[11px] text-foreground/80">{link.fullUrl}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => handleCopy(`link:${link.key}`, link.fullUrl)}
                      >
                        {justCopied ? (<><Check className="size-3.5" />Copied</>) : (<><Copy className="size-3.5" />Copy</>)}
                      </Button>
                      <a
                        href={link.fullUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-2 text-foreground hover:bg-accent"
                        aria-label={`Open ${link.label} in a new tab`}
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="space-y-2">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <QrCode className="size-4" style={{ color: accentColor }} />
              QR Codes
            </h4>
            <p className="text-xs text-muted-foreground">
              Each QR encodes the matching source-tagged URL. Download as PNG for print, signage, and leave-behind materials.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shareLinksWithUrls
                .filter((link) => link.qr)
                .map((link) => (
                  <div key={`qr-${link.key}`} className="flex flex-col items-center gap-2 rounded-md border bg-card p-3 text-center">
                    <span className="text-xs font-medium text-foreground">{link.label}</span>
                    <div className="rounded-md bg-white p-2" ref={(el) => setQrRef(link.key, el)}>
                      <QRCodeCanvas value={link.fullUrl} size={140} level="M" includeMargin={false} />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 w-full gap-1.5 text-xs"
                      onClick={() => downloadQrPng(link.key, link.key)}
                    >
                      <Download className="size-3.5" />
                      Download PNG
                    </Button>
                  </div>
                ))}
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900/90 dark:text-amber-200/90">
            <Info className="mt-0.5 size-4 shrink-0" />
            <p>
              Listing platform and MLS rules vary. Use the links where external virtual-tour or property
              presentation URLs are supported, and confirm compliance with your MLS, brokerage, or platform requirements.
            </p>
          </div>
        </div>
      )}
    </div>
  );
});
