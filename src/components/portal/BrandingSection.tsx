import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Palette, Loader2, X } from "lucide-react";

interface BrandingSectionProps {
  brandName: string;
  accentColor: string;
  hudBgColor: string;
  gateLabel: string;
  logoFile: File | null;
  faviconFile: File | null;
  logoPreview: string | null;
  faviconPreview: string | null;
  logoUploading?: boolean;
  faviconUploading?: boolean;
  onChange: (field: string, value: string) => void;
  onFileChange: (field: "logo" | "favicon", file: File | null) => void;
  onRemoveAsset?: (field: "logo" | "favicon") => void;
  /** When true, render only the inner form (no Card/Header wrapper) — used inside Accordion. */
  headless?: boolean;
}

export function BrandingSection({
  brandName,
  accentColor,
  hudBgColor,
  gateLabel,
  logoPreview,
  faviconPreview,
  logoUploading,
  faviconUploading,
  onChange,
  onFileChange,
  onRemoveAsset,
  headless,
}: BrandingSectionProps) {
  const body = (
    <div className="space-y-4">
        <div className="space-y-2">
          <Label>Brand / Brokerage Name</Label>
          <Input
            value={brandName}
            onChange={(e) => onChange("brandName", e.target.value)}
            placeholder="Your Company Name"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Accent Color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={accentColor}
                onChange={(e) => onChange("accentColor", e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-input"
              />
              <Input
                value={accentColor}
                onChange={(e) => onChange("accentColor", e.target.value)}
                className="flex-1"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Portal Header Background</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={hudBgColor}
                onChange={(e) => onChange("hudBgColor", e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-input"
              />
              <Input
                value={hudBgColor}
                onChange={(e) => onChange("hudBgColor", e.target.value)}
                className="flex-1"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Entry Button Label</Label>
          <Input
            value={gateLabel}
            onChange={(e) => onChange("gateLabel", e.target.value)}
            placeholder="Explore Tour"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              Primary Logo
              {logoUploading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </Label>
            <Input
              type="file"
              accept=".png,.jpg,.jpeg,.svg,.webp"
              disabled={logoUploading}
              onChange={(e) => onFileChange("logo", e.target.files?.[0] || null)}
            />
            {logoPreview && (
              <div className="mt-2 flex items-center gap-2">
                <img src={logoPreview} alt="Logo preview" className="h-12 rounded object-contain" />
                {onRemoveAsset && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => onRemoveAsset("logo")}
                  >
                    <X className="h-3 w-3 mr-1" /> Remove
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              Favicon / Tab Icon
              {faviconUploading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </Label>
            <Input
              type="file"
              accept=".png,.jpg,.jpeg,.svg,.webp,.ico"
              disabled={faviconUploading}
              onChange={(e) => onFileChange("favicon", e.target.files?.[0] || null)}
            />
            {faviconPreview && (
              <div className="mt-2 flex items-center gap-2">
                <img src={faviconPreview} alt="Favicon preview" className="h-8 rounded object-contain" />
                {onRemoveAsset && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => onRemoveAsset("favicon")}
                  >
                    <X className="h-3 w-3 mr-1" /> Remove
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
