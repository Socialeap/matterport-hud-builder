import { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, ExternalLink, IdCard, RotateCw, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { CallingCard, type CallingCardData } from "./CallingCard";
import { buildStudioUrl, getPublicBaseUrl } from "@/lib/public-url";
import { optimizeBrandImage } from "@/lib/portal/image-optimizer";

interface CallingCardSectionProps {
  brandName: string;
  accentColor: string;
  logoUrl: string | null;
  slug: string | null;
  tier: "starter" | "pro";
  customDomain: string | null;
  studioName: string;
  headline: string;
  ctaLabel: string;
  callingCardLogoUrl: string | null;
  callingCardLogoFile: File | null;
  onCallingCardLogoChange: (file: File | null) => void;
  onChange: (patch: {
    studio_name?: string;
    headline?: string;
    cta_label?: string;
  }) => void;
}

export function CallingCardSection({
  brandName,
  accentColor,
  logoUrl,
  slug,
  tier,
  customDomain,
  studioName,
  headline,
  ctaLabel,
  callingCardLogoUrl,
  callingCardLogoFile,
  onCallingCardLogoChange,
  onChange,
}: CallingCardSectionProps) {
  const [face, setFace] = useState<"front" | "back">("front");
  const [logoBusy, setLogoBusy] = useState(false);
  const [adjustLogo, setAdjustLogo] = useState(false);
  const [placement, setPlacement] = useState<LogoPlacement>(DEFAULT_LOGO_PLACEMENT);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const studioUrl = useMemo(
    () => (slug ? buildStudioUrl(slug, { tier, customDomain }) : "#"),
    [slug, tier, customDomain],
  );

  const cardUrl = useMemo(() => {
    if (!slug) return "";
    // Card always lives on canonical platform domain — embeds need a stable host.
    const base = getPublicBaseUrl({ scope: "platform" });
    return `${base}/card/${slug}`;
  }, [slug]);

  const iframeSnippet = useMemo(() => {
    if (!cardUrl) return "";
    // Tighter container: matches the card's 1920:1065 aspect at 600×333,
    // rounded corners, transparent background so the soft 90%-opacity
    // edge band rendered by /card/$slug shows through.
    return `<iframe src="${cardUrl}" width="600" height="333" frameborder="0" style="border:0;max-width:100%;border-radius:18px;background:transparent;" allowfullscreen></iframe>`;
  }, [cardUrl]);

  // Live preview source: pending upload (object URL) > saved URL.
  const livePreviewLogoUrl = useMemo(() => {
    if (callingCardLogoFile) return URL.createObjectURL(callingCardLogoFile);
    return callingCardLogoUrl;
  }, [callingCardLogoFile, callingCardLogoUrl]);

  const data: CallingCardData = {
    brandName: brandName || "Your Studio",
    studioName: studioName || brandName || "",
    logoUrl: livePreviewLogoUrl,
    studioUrl,
  };

  const handleLogoFile = async (file: File | null) => {
    if (!file) {
      onCallingCardLogoChange(null);
      return;
    }
    setLogoBusy(true);
    try {
      // Enforce 1:1 — read native dimensions before optimizing.
      const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          resolve({ w: img.naturalWidth, h: img.naturalHeight });
          URL.revokeObjectURL(url);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("Could not read image dimensions."));
        };
        img.src = url;
      });
      // Allow ±2% tolerance for users exporting "almost square" assets.
      const ratio = dims.w / dims.h;
      if (ratio < 0.98 || ratio > 1.02) {
        toast.error(
          `Logo must be square (1:1). Yours is ${dims.w}×${dims.h}. Crop it to a square first.`,
        );
        return;
      }
      const result = await optimizeBrandImage(file, {
        maxWidth: 512,
        targetBytes: 120 * 1024,
        kind: "logo",
      });
      onCallingCardLogoChange(result.file);
      toast.success(
        result.wasOptimized
          ? `Logo optimized to ${(result.finalBytes / 1024).toFixed(0)} KB (WebP)`
          : "Logo ready",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not process logo");
    } finally {
      setLogoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard`);
    } catch {
      toast.error("Copy failed — please copy manually");
    }
  };

  const slugMissing = !slug;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IdCard className="h-5 w-5 text-primary" />
          Calling Card (Embeddable)
          <Badge variant="secondary" className="ml-auto text-xs">
            Both tiers
          </Badge>
        </CardTitle>
        <CardDescription>
          A flippable digital business card you can embed on your website or share as a link.
          Click the preview to see the back side.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Live preview */}
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <div className="mx-auto max-w-2xl">
            <CallingCard
              data={data}
              forcedFace={adjustLogo ? "front" : face}
              logoPlacement={placement}
              adjustLogo={adjustLogo}
              onLogoPlacementChange={setPlacement}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={face === "front" ? "default" : "outline"}
              onClick={() => setFace("front")}
              disabled={adjustLogo}
            >
              Front
            </Button>
            <Button
              type="button"
              size="sm"
              variant={face === "back" ? "default" : "outline"}
              onClick={() => setFace("back")}
              disabled={adjustLogo}
            >
              Back
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setFace((f) => (f === "front" ? "back" : "front"))}
              disabled={adjustLogo}
            >
              <RotateCw className="h-4 w-4 mr-1" /> Flip
            </Button>
            <Button
              type="button"
              size="sm"
              variant={adjustLogo ? "default" : "outline"}
              onClick={() => setAdjustLogo((v) => !v)}
            >
              <Move className="h-4 w-4 mr-1" />
              {adjustLogo ? "Done" : "Adjust logo position"}
            </Button>
          </div>

          {adjustLogo && (
            <div className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-50/60 p-3 text-xs">
              <div className="mb-2 font-semibold text-emerald-900">
                Drag the dashed circle into place. Use the buttons to resize.
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono">
                  left: {placement.left.toFixed(2)}% · top: {placement.top.toFixed(2)}% · width: {placement.width.toFixed(2)}%
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Size:</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2"
                    onClick={() =>
                      setPlacement((p) => ({ ...p, width: Math.max(2, +(p.width - 0.5).toFixed(2)) }))
                    }
                  >
                    −
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2"
                    onClick={() =>
                      setPlacement((p) => ({ ...p, width: Math.min(100, +(p.width + 0.5).toFixed(2)) }))
                    }
                  >
                    +
                  </Button>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    copy(
                      `left: ${placement.left.toFixed(2)}%, top: ${placement.top.toFixed(2)}%, width: ${placement.width.toFixed(2)}%`,
                      "Coordinates",
                    )
                  }
                >
                  <Copy className="h-3.5 w-3.5 mr-1" /> Copy coordinates
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setPlacement(DEFAULT_LOGO_PLACEMENT)}
                >
                  Reset
                </Button>
              </div>
              <p className="mt-2 text-muted-foreground">
                Positioning here is preview-only. Send me the coordinates to bake them in permanently.
              </p>
            </div>
          )}
        </div>

        {/* Editable fields — studio name + logo. The rest of the card art is fixed. */}
        <div className="space-y-2">
          <Label htmlFor="cc_studio_name">Studio Name</Label>
          <Input
            id="cc_studio_name"
            value={studioName}
            maxLength={25}
            onChange={(e) => onChange({ studio_name: e.target.value.slice(0, 25) })}
            placeholder={brandName || "Acme 3D Tours"}
          />
          <p className="text-[11px] text-muted-foreground text-right">{studioName.length}/25</p>
          <p className="text-xs text-muted-foreground">
            Appears inside the green pill on the front of the card.
          </p>
        </div>

        {/* Logo upload — square (1:1), auto-converted to WebP under 120 KB */}
        <div className="space-y-2">
          <Label htmlFor="cc_logo">Studio Logo (square)</Label>
          <div className="flex items-center gap-3">
            <div className="h-16 w-16 flex-none overflow-hidden rounded-full border border-border bg-muted">
              {livePreviewLogoUrl ? (
                <img
                  src={livePreviewLogoUrl}
                  alt="Calling card logo preview"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                  No logo
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              id="cc_logo"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => handleLogoFile(e.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={logoBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-1" />
              {logoBusy ? "Processing…" : livePreviewLogoUrl ? "Replace" : "Upload"}
            </Button>
            {(livePreviewLogoUrl) && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={logoBusy}
                onClick={() => handleLogoFile(null)}
              >
                <X className="h-4 w-4 mr-1" /> Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Must be a square image (1:1). Automatically converted to WebP and shrunk under 120 KB.
          </p>
        </div>

        {/* Embed / share panel */}
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Embed & Share</div>
            {slugMissing && (
              <Badge variant="destructive" className="text-xs">Set a Studio URL slug to enable</Badge>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Embed code (paste into any website)</Label>
            <div className="flex items-center gap-2">
              <Input readOnly value={iframeSnippet} className="font-mono text-xs" disabled={slugMissing} />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={slugMissing}
                onClick={() => copy(iframeSnippet, "Embed code")}
              >
                <Copy className="h-4 w-4 mr-1" /> Copy
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Share URL (great for email signatures, QR codes, social posts)</Label>
            <div className="flex items-center gap-2">
              <Input readOnly value={cardUrl} className="font-mono text-xs" disabled={slugMissing} />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={slugMissing}
                onClick={() => copy(cardUrl, "Share URL")}
              >
                <Copy className="h-4 w-4 mr-1" /> Copy
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={slugMissing}
                asChild
              >
                <a href={cardUrl || "#"} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-1" /> Open
                </a>
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
