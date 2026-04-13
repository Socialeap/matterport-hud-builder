import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard/branding")({
  component: BrandingPage,
});

interface BrandingData {
  brand_name: string;
  accent_color: string;
  hud_bg_color: string;
  gate_label: string;
  logo_url: string | null;
  favicon_url: string | null;
  custom_domain: string | null;
  tier: "starter" | "pro";
  slug: string | null;
  payment_link: string | null;
  payment_instructions: string | null;
}

const defaultBranding: BrandingData = {
  brand_name: "",
  accent_color: "#2563EB",
  hud_bg_color: "#1A1A2E",
  gate_label: "Enter Tour",
  logo_url: null,
  favicon_url: null,
  custom_domain: null,
  tier: "starter",
  slug: null,
  payment_link: null,
  payment_instructions: null,
};

function BrandingPage() {
  const { user } = useAuth();
  const [branding, setBranding] = useState<BrandingData>(defaultBranding);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isPro = branding.tier === "pro";

  const fetchBranding = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("branding_settings")
      .select("*")
      .eq("provider_id", user.id)
      .maybeSingle();

    if (data) {
      setBranding({
        brand_name: data.brand_name,
        accent_color: data.accent_color,
        hud_bg_color: data.hud_bg_color,
        gate_label: data.gate_label,
        logo_url: data.logo_url,
        favicon_url: data.favicon_url,
        custom_domain: data.custom_domain,
        tier: data.tier as "starter" | "pro",
        slug: data.slug,
        payment_link: data.payment_link,
        payment_instructions: data.payment_instructions,
      });
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchBranding();
  }, [fetchBranding]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);

    const { error } = await supabase
      .from("branding_settings")
      .upsert(
        {
          provider_id: user.id,
          brand_name: branding.brand_name,
          accent_color: branding.accent_color,
          hud_bg_color: branding.hud_bg_color,
          gate_label: branding.gate_label,
          logo_url: branding.logo_url,
          favicon_url: branding.favicon_url,
          custom_domain: isPro ? branding.custom_domain : null,
          slug: branding.slug,
          payment_link: branding.payment_link,
          payment_instructions: branding.payment_instructions,
        },
        { onConflict: "provider_id" }
      );

    setSaving(false);
    if (error) {
      toast.error("Failed to save branding settings");
    } else {
      toast.success("Branding settings saved");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Branding</h1>
          <p className="text-sm text-muted-foreground">
            Configure your whitelabel settings and visual identity.
          </p>
        </div>
        <Badge variant={isPro ? "default" : "secondary"}>
          {isPro ? "Pro" : "Starter"} Tier
        </Badge>
      </div>

      {/* Basic branding — available to all tiers */}
      <Card>
        <CardHeader>
          <CardTitle>Brand Identity</CardTitle>
          <CardDescription>
            These settings are applied to your client-facing builder and generated tours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="brand_name">Brand Name</Label>
            <Input
              id="brand_name"
              value={branding.brand_name}
              onChange={(e) => setBranding({ ...branding, brand_name: e.target.value })}
              placeholder="Your Company Name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gate_label">Gate Button Label</Label>
            <Input
              id="gate_label"
              value={branding.gate_label}
              onChange={(e) => setBranding({ ...branding, gate_label: e.target.value })}
              placeholder="Enter Tour"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="accent_color">Accent Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  id="accent_color"
                  value={branding.accent_color}
                  onChange={(e) => setBranding({ ...branding, accent_color: e.target.value })}
                  className="h-9 w-12 cursor-pointer rounded border border-input"
                />
                <Input
                  value={branding.accent_color}
                  onChange={(e) => setBranding({ ...branding, accent_color: e.target.value })}
                  className="flex-1"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="hud_bg_color">HUD Background</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  id="hud_bg_color"
                  value={branding.hud_bg_color}
                  onChange={(e) => setBranding({ ...branding, hud_bg_color: e.target.value })}
                  className="h-9 w-12 cursor-pointer rounded border border-input"
                />
                <Input
                  value={branding.hud_bg_color}
                  onChange={(e) => setBranding({ ...branding, hud_bg_color: e.target.value })}
                  className="flex-1"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pro-only section */}
      <Card className={!isPro ? "opacity-75" : ""}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Whitelabel Settings</CardTitle>
            {!isPro && <Lock className="size-4 text-muted-foreground" />}
          </div>
          <CardDescription>
            {isPro
              ? "Full whitelabel — all Transcendence Media branding removed."
              : "Upgrade to Pro ($199) to unlock full whitelabel capabilities."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="custom_domain">Custom Domain</Label>
            <Input
              id="custom_domain"
              value={branding.custom_domain ?? ""}
              onChange={(e) => setBranding({ ...branding, custom_domain: e.target.value })}
              placeholder="tours.yourcompany.com"
              disabled={!isPro}
            />
          </div>

          {!isPro && (
            <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4 text-center">
              <p className="text-sm font-medium text-foreground">
                Remove all co-branding and unlock custom domains
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Starter tier includes "Powered by Transcendence Media" on all output.
              </p>
              <Button size="sm" className="mt-3">
                Upgrade to Pro — $199
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
