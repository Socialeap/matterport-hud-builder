import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock, Copy } from "lucide-react";
import { toast } from "sonner";
import { uploadBrandAsset } from "@/lib/storage";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

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
  stripe_connect_id: string | null;
  stripe_onboarding_complete: boolean;
  base_price_cents: number | null;
  model_threshold: number;
  additional_model_fee_cents: number | null;
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
  stripe_connect_id: null,
  stripe_onboarding_complete: false,
  base_price_cents: null,
  model_threshold: 1,
  additional_model_fee_cents: null,
};

function BrandingPage() {
  const { user } = useAuth();
  const [branding, setBranding] = useState<BrandingData>(defaultBranding);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);

  const isPro = branding.tier === "pro";
  const { openCheckout, closeCheckout, isOpen, CheckoutForm } = useStripeCheckout();

  const handleUpgrade = useCallback(() => {
    openCheckout({
      priceId: "pro_upgrade_onetime",
      customerEmail: user?.email ?? undefined,
      userId: user?.id ?? "",
      returnUrl: `${window.location.origin}/dashboard/branding?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    });
  }, [user, openCheckout]);

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
        stripe_connect_id: data.stripe_connect_id,
        stripe_onboarding_complete: data.stripe_onboarding_complete ?? false,
        base_price_cents: data.base_price_cents,
        model_threshold: data.model_threshold ?? 1,
        additional_model_fee_cents: data.additional_model_fee_cents,
      });
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchBranding();
  }, [fetchBranding]);

  // Check Stripe Connect status on return from onboarding
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("stripe_connect_return") && user) {
      supabase.functions.invoke("stripe-connect-status").then(({ data }) => {
        if (data?.onboarding_complete) {
          setBranding((prev) => ({ ...prev, stripe_onboarding_complete: true }));
          toast.success("Stripe account connected successfully!");
        }
      });
      // Clean up the URL
      url.searchParams.delete("stripe_connect_return");
      window.history.replaceState({}, "", url.toString());
    }
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);

    let logoUrl = branding.logo_url;
    let faviconUrl = branding.favicon_url;

    // Upload files if changed
    if (logoFile) {
      const url = await uploadBrandAsset(user.id, logoFile, "logo");
      if (url) logoUrl = url;
      else toast.error("Failed to upload logo");
    }
    if (faviconFile) {
      const url = await uploadBrandAsset(user.id, faviconFile, "favicon");
      if (url) faviconUrl = url;
      else toast.error("Failed to upload favicon");
    }

    const { error } = await supabase
      .from("branding_settings")
      .upsert(
        {
          provider_id: user.id,
          brand_name: branding.brand_name,
          accent_color: branding.accent_color,
          hud_bg_color: branding.hud_bg_color,
          gate_label: branding.gate_label,
          logo_url: logoUrl,
          favicon_url: faviconUrl,
          custom_domain: isPro ? branding.custom_domain : null,
          slug: branding.slug,
          base_price_cents: branding.base_price_cents,
          model_threshold: branding.model_threshold,
          additional_model_fee_cents: branding.additional_model_fee_cents,
        },
        { onConflict: "provider_id" }
      );

    setSaving(false);
    if (error) {
      toast.error("Failed to save branding settings");
    } else {
      setBranding((prev) => ({ ...prev, logo_url: logoUrl, favicon_url: faviconUrl }));
      setLogoFile(null);
      setFaviconFile(null);
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Studio Branding</h1>
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Primary Logo</Label>
              <Input
                type="file"
                accept=".png,.jpg,.jpeg,.svg,.webp"
                onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
              />
              {(logoFile || branding.logo_url) && (
                <img
                  src={logoFile ? URL.createObjectURL(logoFile) : branding.logo_url!}
                  alt="Logo preview"
                  className="mt-2 h-12 rounded object-contain"
                />
              )}
            </div>
            <div className="space-y-2">
              <Label>Favicon / Tab Icon</Label>
              <Input
                type="file"
                accept=".png,.jpg,.jpeg,.svg,.webp,.ico"
                onChange={(e) => setFaviconFile(e.target.files?.[0] || null)}
              />
              {(faviconFile || branding.favicon_url) && (
                <img
                  src={faviconFile ? URL.createObjectURL(faviconFile) : branding.favicon_url!}
                  alt="Favicon preview"
                  className="mt-2 h-8 rounded object-contain"
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Studio & Payment Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Studio & Payment Links</CardTitle>
          <CardDescription>
            Configure your site URL and payment details for client orders.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="slug">Studio URL Slug</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">/p/</span>
              <Input
                id="slug"
                value={branding.slug ?? ""}
                onChange={(e) =>
                  setBranding({
                    ...branding,
                    slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                  })
                }
                placeholder="your-brand"
              />
            </div>
            {branding.slug && (
              <div className="flex items-center gap-2 mt-1">
                <p className="text-xs text-muted-foreground">
                  Your studio: {window.location.origin}/p/{branding.slug}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/p/${branding.slug}`);
                    toast.success("Studio link copied to clipboard!");
                  }}
                >
                  <Copy className="h-3 w-3 mr-1" />
                  Copy Link
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Stripe Connect</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Connect your Stripe account to accept payments from clients.
                </p>
              </div>
              {branding.stripe_onboarding_complete ? (
                <Badge className="bg-green-600 text-white">Stripe Connected ✅</Badge>
              ) : (
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      const { data, error } = await supabase.functions.invoke("stripe-connect-onboard", {
                        body: { returnUrl: window.location.href },
                      });
                      if (error || !data?.url) throw new Error("Failed to start onboarding");
                      window.location.href = data.url;
                    } catch {
                      toast.error("Failed to connect Stripe. Please try again.");
                    }
                  }}
                >
                  Connect with Stripe
                </Button>
              )}
            </div>
          </div>

          {branding.stripe_onboarding_complete && (
            <>
              <div className="space-y-2">
                <Label htmlFor="base_price">Base Price ($)</Label>
                <Input
                  id="base_price"
                  type="number"
                  min={0}
                  step={1}
                  value={branding.base_price_cents != null ? (branding.base_price_cents / 100).toString() : ""}
                  onChange={(e) =>
                    setBranding({
                      ...branding,
                      base_price_cents: e.target.value ? Math.round(parseFloat(e.target.value) * 100) : null,
                    })
                  }
                  placeholder="200"
                />
                <p className="text-xs text-muted-foreground">
                  Flat fee for the starting package.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="model_threshold">Model Threshold</Label>
                <Input
                  id="model_threshold"
                  type="number"
                  min={1}
                  step={1}
                  value={branding.model_threshold}
                  onChange={(e) =>
                    setBranding({
                      ...branding,
                      model_threshold: parseInt(e.target.value) || 1,
                    })
                  }
                  placeholder="3"
                />
                <p className="text-xs text-muted-foreground">
                  How many models are included in the base price.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="additional_fee">Additional Model Fee ($)</Label>
                <Input
                  id="additional_fee"
                  type="number"
                  min={0}
                  step={1}
                  value={branding.additional_model_fee_cents != null ? (branding.additional_model_fee_cents / 100).toString() : ""}
                  onChange={(e) =>
                    setBranding({
                      ...branding,
                      additional_model_fee_cents: e.target.value ? Math.round(parseFloat(e.target.value) * 100) : null,
                    })
                  }
                  placeholder="50"
                />
                <p className="text-xs text-muted-foreground">
                  Price for each model beyond the threshold.
                </p>
              </div>
            </>
          )}
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
              <Button size="sm" className="mt-3" onClick={() => handleUpgrade()}>
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
