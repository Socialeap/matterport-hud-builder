import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, ExternalLink, IdCard, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { CallingCard, type CallingCardData } from "./CallingCard";
import { buildStudioUrl, getPublicBaseUrl } from "@/lib/public-url";

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
  onChange,
}: CallingCardSectionProps) {
  const [face, setFace] = useState<"front" | "back">("front");

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
    return `<iframe src="${cardUrl}" width="600" height="338" frameborder="0" style="border:0;max-width:100%;" allowfullscreen></iframe>`;
  }, [cardUrl]);

  const data: CallingCardData = {
    brandName: brandName || "Your Studio",
    studioName: studioName || brandName || "",
    studioUrl,
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
            <CallingCard data={data} forcedFace={face} />
          </div>
          <div className="mt-3 flex justify-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={face === "front" ? "default" : "outline"}
              onClick={() => setFace("front")}
            >
              Front
            </Button>
            <Button
              type="button"
              size="sm"
              variant={face === "back" ? "default" : "outline"}
              onClick={() => setFace("back")}
            >
              Back
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setFace((f) => (f === "front" ? "back" : "front"))}
            >
              <RotateCw className="h-4 w-4 mr-1" /> Flip
            </Button>
        </div>

        {/* Editable fields — studio name only; the rest of the card art is fixed. */}
        <div className="space-y-2">
          <Label htmlFor="cc_studio_name">Studio Name</Label>
          <Input
            id="cc_studio_name"
            value={studioName}
            onChange={(e) => onChange({ studio_name: e.target.value })}
            placeholder={brandName || "Acme 3D Tours"}
          />
          <p className="text-xs text-muted-foreground">
            Appears inside the green pill on the front of the card.
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
