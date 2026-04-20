import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { Slider } from "@/components/ui/slider";
import { uploadBrandAsset } from "@/lib/storage";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { getStripeEnvironment } from "@/lib/stripe";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { buildStudioUrl } from "@/lib/public-url";

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
  hero_bg_url: string | null;
  hero_bg_opacity: number;
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
  hero_bg_url: null,
  hero_bg_opacity: 0.45,
};

function BrandingPage() {
  const { user } = useAuth();
  const [branding, setBranding] = useState<BrandingData>(defaultBranding);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [heroFile, setHeroFile] = useState<File | null>(null);

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
        hero_bg_url: (data as any).hero_bg_url ?? null,
        hero_bg_opacity: (data as any).hero_bg_opacity ?? 0.45,
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
    const hasReturn = url.searchParams.has("stripe_connect_return");
    const hasSuccess = url.searchParams.get("stripe_connect_success") === "true";
    if ((hasReturn || hasSuccess) && user) {
      supabase.functions
        .invoke("stripe-connect-status", {
          body: { environment: getStripeEnvironment() },
        })
        .then(({ data }) => {
          if (data?.onboarding_complete) {
            fetchBranding();
            toast.success("Stripe account connected successfully!");
          } else {
            toast.info(
              "Stripe onboarding not yet complete. Finish all required steps in Stripe."
            );
          }
        });
      // Clean up the URL
      url.searchParams.delete("stripe_connect_return");
      url.searchParams.delete("stripe_connect_success");
      window.history.replaceState({}, "", url.toString());
    }
  }, [user, fetchBranding]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);

    let logoUrl = branding.logo_url;
    let faviconUrl = branding.favicon_url;
    let heroUrl = branding.hero_bg_url;

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
    if (heroFile) {
      const url = await uploadBrandAsset(user.id, heroFile, "hero");
      if (url) heroUrl = url;
      else toast.error("Failed to upload hero background");
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
          hero_bg_url: heroUrl,
          hero_bg_opacity: branding.hero_bg_opacity,
        } as any,
        { onConflict: "provider_id" }
      );

    setSaving(false);
    if (error) {
      toast.error("Failed to save branding settings");
    } else {
      setBranding((prev) => ({
        ...prev,
        logo_url: logoUrl,
        favicon_url: faviconUrl,
        hero_bg_url: heroUrl,
      }));
      setLogoFile(null);
      setFaviconFile(null);
      setHeroFile(null);
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
              <Label htmlFor="hud_bg_color">Portal Background</Label>
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

          {/* Portal hero background */}
          <div className="space-y-3 rounded-lg border border-dashed border-border p-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Portal Hero Background</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The cinematic image behind your portal headline. Falls back to a default residential photo.
                </p>
              </div>
              {branding.hero_bg_url && !heroFile && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setBranding({ ...branding, hero_bg_url: null })}
                >
                  <X className="h-3 w-3 mr-1" />
                  Remove
                </Button>
              )}
            </div>
            <Input
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              onChange={(e) => setHeroFile(e.target.files?.[0] || null)}
            />
            {(heroFile || branding.hero_bg_url) && (
              <div className="relative h-32 w-full overflow-hidden rounded-md border border-border">
                <img
                  src={heroFile ? URL.createObjectURL(heroFile) : branding.hero_bg_url!}
                  alt="Hero preview"
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div
                  className="absolute inset-0"
                  style={{ backgroundColor: `rgba(0,0,0,${branding.hero_bg_opacity})` }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-semibold text-white drop-shadow-lg">
                    Headline preview
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="hero_opacity">Image Dimming</Label>
                <span className="text-xs font-medium text-muted-foreground">
                  {Math.round(branding.hero_bg_opacity * 100)}%
                </span>
              </div>
              <Slider
                id="hero_opacity"
                min={0}
                max={100}
                step={1}
                value={[Math.round(branding.hero_bg_opacity * 100)]}
                onValueChange={([v]) =>
                  setBranding({ ...branding, hero_bg_opacity: (v ?? 45) / 100 })
                }
              />
              <p className="text-xs text-muted-foreground">
                Increase to keep the headline readable on busy or bright images.
              </p>
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
                  Your studio: {buildStudioUrl(branding.slug, { tier: branding.tier, customDomain: branding.custom_domain })}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      buildStudioUrl(branding.slug!, { tier: branding.tier, customDomain: branding.custom_domain })
                    );
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
                        body: {
                          returnUrl: window.location.href,
                          environment: getStripeEnvironment(),
                        },
                      });
                      if (error) throw new Error((data as any)?.error || error.message);
                      if ((data as any)?.error) throw new Error((data as any).error);
                      if (!data?.url) throw new Error("Failed to start onboarding");
                      window.location.href = data.url;
                    } catch (err: any) {
                      console.error("Stripe Connect error:", err);
                      toast.error(err?.message || "Failed to connect Stripe. Please try again.");
                    }
                  }}
                >
                  Connect with Stripe
                </Button>
              )}
            </div>
          </div>

          {branding.stripe_onboarding_complete && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Payouts &amp; Earnings</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    View your balance, manage payout schedule, and request instant payouts (typically arrive within 30 minutes).
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Instant Payout fee: <span className="font-medium">1.50%</span> (set by platform)
                  </p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to="/dashboard/payouts">Manage payouts →</Link>
                </Button>
              </div>
            </div>
          )}

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

      <Dialog open={isOpen} onOpenChange={(open) => !open && closeCheckout()}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>Upgrade to Pro</DialogTitle>
          {CheckoutForm && <CheckoutForm />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
