import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Palette } from "lucide-react";

interface BrandingSectionProps {
  brandName: string;
  accentColor: string;
  hudBgColor: string;
  gateLabel: string;
  logoFile: File | null;
  faviconFile: File | null;
  logoPreview: string | null;
  faviconPreview: string | null;
  onChange: (field: string, value: string) => void;
  onFileChange: (field: "logo" | "favicon", file: File | null) => void;
}

export function BrandingSection({
  brandName,
  accentColor,
  hudBgColor,
  gateLabel,
  logoPreview,
  faviconPreview,
  onChange,
  onFileChange,
}: BrandingSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="size-5 text-primary" />
          Branding
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
            <Label>HUD Header Background</Label>
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
            <Label>Primary Logo</Label>
            <Input
              type="file"
              accept=".png,.jpg,.jpeg,.svg,.webp"
              onChange={(e) => onFileChange("logo", e.target.files?.[0] || null)}
            />
            {logoPreview && (
              <img src={logoPreview} alt="Logo preview" className="mt-2 h-12 rounded object-contain" />
            )}
          </div>
          <div className="space-y-2">
            <Label>Favicon / Tab Icon</Label>
            <Input
              type="file"
              accept=".png,.jpg,.jpeg,.svg,.webp,.ico"
              onChange={(e) => onFileChange("favicon", e.target.files?.[0] || null)}
            />
            {faviconPreview && (
              <img src={faviconPreview} alt="Favicon preview" className="mt-2 h-8 rounded object-contain" />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
