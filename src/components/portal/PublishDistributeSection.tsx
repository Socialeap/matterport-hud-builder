import { useCallback, useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Info,
  QrCode,
  Rocket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface PublishDistributeSectionProps {
  /** Used as a friendly slug for QR-PNG file names. Falls back to "presentation". */
  propertyName?: string;
  /** Brand accent color from the builder (used for primary CTAs). */
  accentColor: string;
  /** Whether the user has at least one downloadable model configured. */
  canDownload: boolean;
  /** Triggers the existing download / pay-and-download flow in the parent. */
  onDownload: () => void;
  /** True while the parent is preparing or downloading. */
  downloading: boolean;
  /** Optional in-flight step label from the parent (matches the pay/download card). */
  downloadingLabel?: string;
  /** Optional reason the download is currently disabled (forwarded as tooltip text). */
  downloadDisabledReason?: string | null;
}

type ShareLink = {
  key: string;
  /** Value appended as ?src=... — null means the unmodified main URL. */
  src: string | null;
  label: string;
  description: string;
  /** When true, this link gets a downloadable QR code in the kit. */
  qr?: boolean;
};

const SHARE_LINKS: ShareLink[] = [
  {
    key: "main",
    src: null,
    label: "Main Link",
    description: "Use anywhere you want to share the full presentation.",
    qr: true,
  },
  {
    key: "mls",
    src: "mls",
    label: "MLS / Unbranded Link",
    description: "Use only if it meets the rules of your MLS or brokerage.",
  },
  {
    key: "marketplace",
    src: "marketplace",
    label: "Zillow / Homes.com Link",
    description:
      "Use where listing platforms allow a virtual-tour or external property link.",
  },
  {
    key: "realtor",
    src: "realtor",
    label: "Realtor.com Link",
    description:
      "Use where Realtor.com or similar marketplaces allow virtual-tour URLs.",
  },
  {
    key: "email",
    src: "email",
    label: "Email Link",
    description: "Use in email campaigns and direct follow-ups.",
  },
  {
    key: "social",
    src: "social",
    label: "Social Link",
    description: "Use in social posts and DMs.",
  },
  {
    key: "open-house",
    src: "open-house",
    label: "Open House Link",
    description: "Use on open house signage or sign-in materials.",
    qr: true,
  },
  {
    key: "flyer",
    src: "flyer",
    label: "Flyer Link",
    description: "Use on printed flyers and brochures.",
    qr: true,
  },
  {
    key: "business-card",
    src: "business-card",
    label: "Business Card Link",
    description: "Use on cards or leave-behind materials.",
    qr: true,
  },
  {
    key: "window-sign",
    src: "window-sign",
    label: "Window Sign Link",
    description: "Use on storefront/window displays.",
    qr: true,
  },
];

const NETLIFY_DROP_URL = "https://app.netlify.com/drop";

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

/**
 * Validate + normalize the live URL the agent pastes back from Netlify.
 * Accepts http or https, prefers https. If no protocol is present we
 * upgrade to https before validating. Returns null when the input does
 * not parse as an absolute URL with a real-looking host.
 */
function normalizeLiveUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname.includes(".")) return null;
  return parsed.toString();
}

/**
 * Compose the source-tagged URL. We rebuild via URL so existing query
 * strings, paths, and fragments on the agent's hosted URL are preserved
 * while still letting us add (or overwrite) the src parameter.
 */
function buildShareUrl(baseUrl: string, src: string | null): string {
  try {
    const url = new URL(baseUrl);
    if (src) {
      url.searchParams.set("src", src);
    } else {
      url.searchParams.delete("src");
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
}

export function PublishDistributeSection({
  propertyName,
  accentColor,
  canDownload,
  onDownload,
  downloading,
  downloadingLabel,
  downloadDisabledReason,
}: PublishDistributeSectionProps) {
  const [netlifyOpened, setNetlifyOpened] = useState(false);
  const [netlifyBlocked, setNetlifyBlocked] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // One container ref per QR — used to grab the underlying <canvas>
  // for PNG export. We map by share-link key so re-renders don't lose it.
  const qrContainerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setQrRef = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) qrContainerRefs.current.set(key, el);
    else qrContainerRefs.current.delete(key);
  }, []);

  const filenameSlug = useMemo(
    () => slugifyForFilename(propertyName || "presentation"),
    [propertyName],
  );

  const openNetlifyPublishWindow = useCallback(() => {
    setNetlifyBlocked(false);
    const width = 560;
    const height = 760;
    const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
    const features = [
      `width=${width}`,
      `height=${height}`,
      `left=${left}`,
      `top=${top}`,
      "resizable=yes",
      "scrollbars=yes",
      "noopener",
      "noreferrer",
    ].join(",");
    let publishWindow: Window | null = null;
    try {
      publishWindow = window.open(
        NETLIFY_DROP_URL,
        "netlifyPublishWindow",
        features,
      );
    } catch {
      publishWindow = null;
    }
    // Defensive: even when the browser ignores the noopener feature
    // string, dropping the back-reference protects 3DPS from any later
    // navigation by the popup (cross-origin so it can't read us, but
    // it could still call window.opener.location.replace before nav).
    if (publishWindow) {
      try {
        publishWindow.opener = null;
      } catch {
        /* cross-origin lockout — already isolated. */
      }
      setNetlifyOpened(true);
      setNetlifyBlocked(false);
    } else {
      setNetlifyBlocked(true);
    }
  }, []);

  const handleGenerateShareKit = useCallback(() => {
    const normalized = normalizeLiveUrl(urlInput);
    if (!normalized) {
      setUrlError(
        "Please enter a valid published URL, such as https://your-property-site.netlify.app",
      );
      setLiveUrl(null);
      return;
    }
    setUrlError(null);
    setUrlInput(normalized);
    setLiveUrl(normalized);
  }, [urlInput]);

  const handleUrlChange = useCallback((value: string) => {
    setUrlInput(value);
    if (urlError) setUrlError(null);
    // Clear an existing kit if the agent edits the URL after generating —
    // forces a fresh "Generate Share Kit" click so links never drift out
    // of sync with the input field.
    if (liveUrl) setLiveUrl(null);
  }, [urlError, liveUrl]);

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
      if (!blob) {
        toast.error("Couldn't export QR. Try again.");
        return;
      }
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

  const shareLinksWithUrls = useMemo(() => {
    if (!liveUrl) return [] as Array<ShareLink & { fullUrl: string }>;
    return SHARE_LINKS.map((link) => ({
      ...link,
      fullUrl: buildShareUrl(liveUrl, link.src),
    }));
  }, [liveUrl]);

  return (
    <div className="space-y-5">
      {/* Strategic positioning copy */}
      <p className="text-xs text-muted-foreground">
        While you can use any web hosting platform to publish your presentation
        file (or upload to your own site), we recommend using Netlify which is
        a really easy and free. See how below.
      </p>

      {/* Step 1 — Download the package */}
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
                If you haven't already, Download Your Presentation Package
              </h4>
              <p className="text-xs text-muted-foreground">
                Generate the publish-ready presentation file you'll upload to
                your host. Same flow as the main download button — kept here
                so you can stay in this section.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={!canDownload || downloading}
              onClick={onDownload}
              title={downloadDisabledReason ?? undefined}
            >
              <Download className="size-4" />
              {downloading
                ? (downloadingLabel || "Preparing…")
                : "Download Presentation Package"}
            </Button>
          </div>
        </div>
      </div>

      {/* Step 2 — Open Netlify */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-start gap-3">
          <div
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
            style={{ backgroundColor: accentColor }}
          >
            2
          </div>
          <div className="flex-1 space-y-2">
            <div>
              <h4 className="text-sm font-semibold text-foreground">
                Open Netlify Publish Window
              </h4>
              <p className="text-xs text-muted-foreground">
                Netlify Drop opens in a small focused window so you can drag
                your file in without losing your place here. Signup, upload,
                and account flows all happen on Netlify's own site.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                className="gap-1.5 text-white"
                style={{ backgroundColor: accentColor }}
                onClick={openNetlifyPublishWindow}
              >
                <Rocket className="size-4" />
                {netlifyOpened ? "Reopen Netlify Publish Window" : "Open Netlify Publish Window"}
              </Button>
              <a
                href={NETLIFY_DROP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent"
              >
                <ExternalLink className="size-3.5" />
                Open Netlify Drop in New Tab
              </a>
            </div>

            {netlifyBlocked && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-900/90 dark:text-amber-200/90">
                Your browser blocked the publish window. Please allow popups
                for this site or use the "Open Netlify Drop in New Tab" link
                above.
              </div>
            )}

            {netlifyOpened && !netlifyBlocked && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">
                  Netlify is open. Upload your 3DPS file or package there,
                  then copy the live published URL and paste it below.
                </p>
                <ol className="mt-2 list-decimal space-y-0.5 pl-4">
                  <li>Drag your 3DPS file/package into Netlify.</li>
                  <li>Wait for Netlify to publish the site.</li>
                  <li>Copy the live Netlify URL.</li>
                  <li>Paste the URL below.</li>
                  <li>Generate your Share Kit.</li>
                </ol>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Step 3 — Paste the live URL & generate */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-start gap-3">
          <div
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
            style={{ backgroundColor: accentColor }}
          >
            3
          </div>
          <div className="flex-1 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-foreground">
                Paste your live URL
              </h4>
              <p className="text-xs text-muted-foreground">
                After your presentation is published online, paste the live
                URL here to generate sharing links and QR codes.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="publish-live-url" className="text-xs font-medium">
                Live Presentation URL
              </Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Globe className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="publish-live-url"
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="https://your-property-site.netlify.app"
                    value={urlInput}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleGenerateShareKit();
                      }
                    }}
                    className="pl-8"
                    aria-invalid={urlError ? true : undefined}
                    aria-describedby={urlError ? "publish-live-url-error" : undefined}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="text-white sm:w-auto"
                  style={{ backgroundColor: accentColor }}
                  onClick={handleGenerateShareKit}
                  disabled={urlInput.trim().length === 0}
                >
                  Generate Share Kit
                </Button>
              </div>
              {urlError ? (
                <p
                  id="publish-live-url-error"
                  className="text-xs text-destructive"
                >
                  {urlError}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Paste your live URL after publishing. We'll use it as the
                  base for every share link below.
                </p>
              )}
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
              Listing Launch Kit
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Use these links and QR codes to distribute your 3D presentation
              through listing platforms, email, social media, flyers, business
              cards, window signs, and open houses.
            </p>
          </div>

          <ul className="space-y-3">
            {shareLinksWithUrls.map((link) => {
              const justCopied = copiedKey === `link:${link.key}`;
              return (
                <li
                  key={link.key}
                  className="rounded-md border bg-muted/20 p-3"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {link.label}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {link.description}
                      </p>
                      <p className="mt-1 break-all font-mono text-[11px] text-foreground/80">
                        {link.fullUrl}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => handleCopy(`link:${link.key}`, link.fullUrl)}
                      >
                        {justCopied ? (
                          <>
                            <Check className="size-3.5" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="size-3.5" />
                            Copy
                          </>
                        )}
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
              Each QR encodes the matching source-tagged URL. Download as PNG
              for print, signage, and leave-behind materials.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shareLinksWithUrls
                .filter((link) => link.qr)
                .map((link) => (
                  <div
                    key={`qr-${link.key}`}
                    className="flex flex-col items-center gap-2 rounded-md border bg-card p-3 text-center"
                  >
                    <span className="text-xs font-medium text-foreground">
                      {link.label}
                    </span>
                    <div
                      className="rounded-md bg-white p-2"
                      ref={(el) => setQrRef(link.key, el)}
                    >
                      <QRCodeCanvas
                        value={link.fullUrl}
                        size={140}
                        level="M"
                        includeMargin={false}
                      />
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
              Listing platform and MLS rules vary. Use the links where
              external virtual-tour or property presentation URLs are
              supported, and confirm compliance with your MLS, brokerage,
              or platform requirements.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
