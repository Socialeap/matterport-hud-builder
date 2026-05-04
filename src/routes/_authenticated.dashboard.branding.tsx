import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { lazy, Suspense, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock, Copy, X, MapPin } from "lucide-react";

// Lazy-loaded so the ~150 KB Leaflet bundle ships only when a Pro
// MSP actually opens the Service Area editor.
const ServiceAreaMap = lazy(() => import("@/components/dashboard/ServiceAreaMap"));
import { toast } from "sonner";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { uploadBrandAsset } from "@/lib/storage";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { getStripeEnvironment } from "@/lib/stripe";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { buildStudioUrl } from "@/lib/public-url";
import { useMspAccess } from "@/hooks/use-msp-access";
import { StudioPreviewPanel } from "@/components/dashboard/StudioPreviewPanel";
import type { Database } from "@/integrations/supabase/types";

type MarketplaceSpecialty = Database["public"]["Enums"]["marketplace_specialty"];

const SPECIALTY_OPTIONS: ReadonlyArray<{
  value: MarketplaceSpecialty;
  label: string;
  group: "scanning" | "studio";
  proOnly: boolean;
}> = [
  // On-site scanning services
  { value: "scan-matterport-pro3", label: "Matterport Pro3", group: "scanning", proOnly: false },
  { value: "scan-drone-aerial", label: "Drone / Aerial", group: "scanning", proOnly: false },
  { value: "scan-twilight-photography", label: "Twilight Photography", group: "scanning", proOnly: false },
  { value: "scan-floor-plans", label: "Floor Plans", group: "scanning", proOnly: false },
  { value: "scan-dimensional-measurements", label: "Dimensional Measurements", group: "scanning", proOnly: false },
  { value: "scan-same-day-turnaround", label: "Same-Day Turnaround", group: "scanning", proOnly: false },
  // Studio (Production Vault) services
  { value: "vault-sound-library", label: "Sound Library (12+ tracks)", group: "studio", proOnly: false },
  { value: "vault-portal-filters", label: "Visual Portal Filters (3+)", group: "studio", proOnly: false },
  { value: "vault-interactive-widgets", label: "Interactive Widgets (2+)", group: "studio", proOnly: false },
  { value: "vault-custom-icons", label: "Custom Iconography (2+ sets)", group: "studio", proOnly: false },
  { value: "vault-property-mapper", label: "Property Mapper (6+ maps)", group: "studio", proOnly: false },
  { value: "ai-lead-generation", label: "AI Lead Generation", group: "studio", proOnly: false },
];

const ZIP_RE = /^\d{5}(-\d{4})?$/;
const STATE_RE = /^[A-Z]{2}$/;

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
  // Marketplace listing
  is_directory_public: boolean;
  primary_city: string | null;
  region: string | null;
  service_radius_miles: number | null;
  service_zips: string[];
  specialties: MarketplaceSpecialty[];
  service_polygon: GeoJSON.Polygon | null;
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
  is_directory_public: false,
  primary_city: null,
  region: null,
  service_radius_miles: null,
  service_zips: [],
  specialties: [],
  service_polygon: null,
};

function BrandingPage() {
  const { user } = useAuth();
  const { hasPaid } = useMspAccess();
  const [branding, setBranding] = useState<BrandingData>(defaultBranding);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [heroFile, setHeroFile] = useState<File | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<BrandingData>(defaultBranding);
  const savedSnapshotRef = useRef<BrandingData>(defaultBranding);
  const [previewVersion, setPreviewVersion] = useState(0);
  // Free-text mirror for service_zips so users can type commas/spaces
  // without us fighting their cursor on every keystroke.
  const [zipsInput, setZipsInput] = useState("");

  const hasUnsavedChanges = useMemo(
    () =>
      JSON.stringify(branding) !== JSON.stringify(savedSnapshot) ||
      !!logoFile ||
      !!faviconFile ||
      !!heroFile ||
      zipsInput !== savedSnapshot.service_zips.join(", "),
    [branding, savedSnapshot, logoFile, faviconFile, heroFile, zipsInput],
  );

  const isPro = branding.tier === "pro";
  const customDomainUnlocked = isPro && hasPaid;
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
      const next: BrandingData = {
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
        hero_bg_url: data.hero_bg_url ?? null,
        hero_bg_opacity: data.hero_bg_opacity ?? 0.45,
        is_directory_public: data.is_directory_public ?? false,
        primary_city: data.primary_city ?? null,
        region: data.region ?? null,
        // service_radius_miles is on the row but not yet in the
        // generated Database types; read it via untyped fallback.
        service_radius_miles:
          (data as unknown as { service_radius_miles?: number | null })
            .service_radius_miles ?? null,
        service_zips: data.service_zips ?? [],
        specialties: data.specialties ?? [],
        // Polygon is loaded separately via get_my_service_polygon RPC
        // (geometry columns aren't natively rendered by Postgrest).
        service_polygon: savedSnapshotRef.current.service_polygon,
      };
      // Only update state if the fetched payload actually differs from
      // what we already have — prevents needless re-renders that would
      // remount the preview iframe in a loop when auth/session events
      // re-fire this effect.
      if (JSON.stringify(next) !== JSON.stringify(savedSnapshotRef.current)) {
        savedSnapshotRef.current = next;
        setBranding(next);
        setSavedSnapshot(next);
        setZipsInput(next.service_zips.join(", "));
      }

      // Polygon is gated on Pro license at the RPC level. Attempt
      // unconditionally and tolerate the 42501 error for Starter users
      // — they just see an empty polygon and the upgrade prompt.
      if (data.tier === "pro") {
        const { data: polygonJson } = await supabase.rpc(
          "get_my_service_polygon" as never,
        );
        const candidate =
          polygonJson && typeof polygonJson === "object" && !Array.isArray(polygonJson)
            ? (polygonJson as unknown as GeoJSON.Polygon)
            : null;
        if (candidate && candidate.type === "Polygon") {
          const withPoly = { ...next, service_polygon: candidate };
          savedSnapshotRef.current = withPoly;
          setBranding(withPoly);
          setSavedSnapshot(withPoly);
        }
      }
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

  // Parse the free-text zips input into a clean string[] of unique
  // 5- or 9-digit codes. Invalid entries are silently dropped here;
  // the inline hint UI tells the user what was rejected.
  const parsedZips = useMemo(() => {
    const seen = new Set<string>();
    return zipsInput
      .split(/[\s,]+/)
      .map((z) => z.trim())
      .filter((z) => {
        if (!z || !ZIP_RE.test(z) || seen.has(z)) return false;
        seen.add(z);
        return true;
      });
  }, [zipsInput]);

  const invalidZipCount = useMemo(() => {
    const tokens = zipsInput.split(/[\s,]+/).filter((t) => t.trim().length > 0);
    return tokens.length - parsedZips.length;
  }, [zipsInput, parsedZips]);

  const toggleSpecialty = (value: MarketplaceSpecialty, proOnly: boolean) => {
    if (proOnly && !isPro) return;
    setBranding((prev) => {
      const has = prev.specialties.includes(value);
      return {
        ...prev,
        specialties: has
          ? prev.specialties.filter((s) => s !== value)
          : [...prev.specialties, value],
      };
    });
  };

  const handleSave = async () => {
    if (!user) return;

    // Marketplace listing validation: if the MSP is publishing, they
    // must at least name a city and a 2-letter state.
    if (branding.is_directory_public) {
      if (!branding.primary_city || branding.primary_city.trim().length < 2) {
        toast.error("Add a Primary City before listing in the Marketplace");
        return;
      }
      if (!branding.region || !STATE_RE.test(branding.region)) {
        toast.error("Add a 2-letter state code (e.g. GA) before listing");
        return;
      }
    }

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

    // Strip Pro-only specialty tags if the MSP is on Starter — defense
    // in depth in case the UI gating was bypassed.
    const allowedSpecialties = branding.specialties.filter((s) => {
      const opt = SPECIALTY_OPTIONS.find((o) => o.value === s);
      return opt ? !opt.proOnly || isPro : false;
    });

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
          custom_domain: customDomainUnlocked ? branding.custom_domain : null,
          slug: branding.slug,
          base_price_cents: branding.base_price_cents,
          model_threshold: branding.model_threshold,
          additional_model_fee_cents: branding.additional_model_fee_cents,
          hero_bg_url: heroUrl,
          hero_bg_opacity: branding.hero_bg_opacity,
          is_directory_public: branding.is_directory_public,
          primary_city: branding.primary_city?.trim() || null,
          region: branding.region?.trim().toUpperCase() || null,
          service_radius_miles: branding.service_radius_miles,
          service_zips: parsedZips,
          specialties: allowedSpecialties,
        } as any,
        { onConflict: "provider_id" }
      );

    if (error) {
      setSaving(false);
      toast.error("Failed to save branding settings");
      return;
    }

    // Persist the polygon via the SECURITY DEFINER RPC. Geometry
    // columns aren't writable through Postgrest's row UPDATE path,
    // so this is the only authenticated write surface for them.
    // Gated to Pro at the RPC level — Starter callers get 42501,
    // which we surface as a soft warning rather than a hard error.
    const polygonChanged =
      JSON.stringify(branding.service_polygon ?? null) !==
      JSON.stringify(savedSnapshot.service_polygon ?? null);
    if (isPro && polygonChanged) {
      const { error: polygonError } = await supabase.rpc(
        "set_my_service_polygon" as never,
        {
          p_geojson: (branding.service_polygon ?? null) as never,
        } as never,
      );
      if (polygonError) {
        // Surface but don't unwind the row save — the rest of the
        // settings did persist; the MSP can retry the polygon edit.
        toast.warning(
          "Branding saved, but the service-area polygon could not be updated.",
        );
      }
    }

    setSaving(false);

    const updated: BrandingData = {
      ...branding,
      logo_url: logoUrl,
      favicon_url: faviconUrl,
      hero_bg_url: heroUrl,
      service_zips: parsedZips,
      specialties: allowedSpecialties,
    };

    // Fire the marketplace matcher when the listing is public AND
    // either just flipped public OR the service area changed. The
    // matcher is global + idempotent so we don't need to wait on it
    // or surface its result to the user.
    const wentPublic =
      updated.is_directory_public && !savedSnapshot.is_directory_public;
    const cityOrRegionChanged =
      updated.primary_city !== savedSnapshot.primary_city ||
      updated.region !== savedSnapshot.region;
    const serviceAreaChanged =
      updated.is_directory_public &&
      (cityOrRegionChanged ||
        JSON.stringify(updated.service_zips) !==
          JSON.stringify(savedSnapshot.service_zips) ||
        polygonChanged);
    if (wentPublic || serviceAreaChanged) {
      void supabase.functions.invoke("match-beacons", { body: {} });
    }

    // Re-geocode the listing's centroid when the city or region
    // changes. Fire-and-forget — Census can be slow and we don't
    // want to block the toast. The matcher's ZIP/trigram tiers
    // continue to work if geocoding fails.
    if (updated.is_directory_public && cityOrRegionChanged) {
      void triggerGeocodeBranding();
    }

    setBranding(updated);
    setSavedSnapshot(updated);
    savedSnapshotRef.current = updated;
    setLogoFile(null);
    setFaviconFile(null);
    setHeroFile(null);
    setZipsInput(parsedZips.join(", "));
    setPreviewVersion((n) => n + 1);
    toast.success("Branding settings saved");
  };

  /**
   * Best-effort POST to /api/geocode-branding so the server can
   * resolve city/state to lat/lng via Census. Silent failure: the
   * matcher degrades to ZIP/trigram if geocoding is unavailable.
   */
  const triggerGeocodeBranding = useCallback(async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;
      await fetch("/api/geocode-branding", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
    } catch {
      // best-effort; matcher degrades gracefully
    }
  }, []);

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

          {/* Studio hero background */}
          <div className="space-y-3 rounded-lg border border-dashed border-border p-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Studio Hero Background</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The cinematic image behind your Studio's headline. Falls back to a default residential photo.
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

      {/* Studio URL */}
      <Card>
        <CardHeader>
          <CardTitle>Studio URL</CardTitle>
          <CardDescription>
            Configure the public URL where clients access your Studio.
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
        </CardContent>
      </Card>

      {/* Pro-only section */}
      <Card className={!customDomainUnlocked ? "opacity-75" : ""}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Whitelabel Settings</CardTitle>
            {!customDomainUnlocked && <Lock className="size-4 text-muted-foreground" />}
          </div>
          <CardDescription>
            {customDomainUnlocked
              ? "Full whitelabel — all Transcendence Media branding removed."
              : !hasPaid
                ? "Purchase a plan to enable a custom domain and full whitelabel."
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
              disabled={!customDomainUnlocked}
            />
          </div>

          {!customDomainUnlocked && (
            <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4 text-center">
              <p className="text-sm font-medium text-foreground">
                {!hasPaid
                  ? "Activate your Studio to unlock custom domains"
                  : "Remove all co-branding and unlock custom domains"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {!hasPaid
                  ? "Custom domains are available on Pro plans after purchase."
                  : "Starter tier includes \"Powered by Transcendence Media\" on all output."}
              </p>
              <Button size="sm" className="mt-3" onClick={() => handleUpgrade()}>
                {!hasPaid ? "Choose a plan" : "Upgrade to Pro — $199"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Marketplace listing — opt-in directory presence for the
          agent-facing /find-a-studio search (rolls out in a follow-up PR). */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <MapPin className="size-4 text-muted-foreground" />
                <CardTitle>Marketplace Listing</CardTitle>
              </div>
              <CardDescription className="mt-1">
                List your Studio in our agent-facing directory. This is a
                supplemental marketing channel — it does not change your
                personal branding or existing workflow.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="is_directory_public"
                checked={branding.is_directory_public}
                onCheckedChange={(checked) =>
                  setBranding({ ...branding, is_directory_public: checked })
                }
              />
              <Label htmlFor="is_directory_public" className="text-sm">
                {branding.is_directory_public ? "Listed" : "Hidden"}
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="primary_city">Primary City</Label>
              <Input
                id="primary_city"
                value={branding.primary_city ?? ""}
                onChange={(e) =>
                  setBranding({ ...branding, primary_city: e.target.value })
                }
                placeholder="Atlanta"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="region">State</Label>
              <Input
                id="region"
                maxLength={2}
                value={branding.region ?? ""}
                onChange={(e) =>
                  setBranding({
                    ...branding,
                    region: e.target.value.toUpperCase().replace(/[^A-Z]/g, ""),
                  })
                }
                placeholder="GA"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="service_zips">Service ZIP Codes</Label>
            <Input
              id="service_zips"
              value={zipsInput}
              onChange={(e) => setZipsInput(e.target.value)}
              placeholder="30303, 30308, 30312"
            />
            <p className="text-xs text-muted-foreground">
              Comma- or space-separated. Agents searching by ZIP will match
              against this list. {parsedZips.length} valid
              {invalidZipCount > 0 ? `, ${invalidZipCount} ignored` : ""}.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Specialties</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SPECIALTY_OPTIONS.map((opt) => {
                const checked = branding.specialties.includes(opt.value);
                const disabled = opt.proOnly && !isPro;
                return (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm ${
                      disabled
                        ? "cursor-not-allowed opacity-50"
                        : "cursor-pointer hover:bg-muted/50"
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={() =>
                        toggleSpecialty(opt.value, opt.proOnly)
                      }
                    />
                    <span className="flex-1">{opt.label}</span>
                    {opt.proOnly && (
                      <Badge variant="outline" className="text-[10px]">
                        Pro
                      </Badge>
                    )}
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Pro-only tags require an active Pro license to claim.
            </p>
          </div>

          {branding.is_directory_public && (
            <div className="rounded-md border border-dashed border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
              Your studio will appear in agent search results once the
              Marketplace launches. Save your changes to publish.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Service Area — geospatial matching layer.
          Pro draws a polygon (most precise match tier).
          Starter sees an upgrade prompt; their listing still
          matches via the radius / ZIP / fuzzy-city fallbacks. */}
      {branding.is_directory_public && (
        <Card className={!isPro ? "opacity-95" : ""}>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <MapPin className="size-4 text-muted-foreground" />
                  <CardTitle>Service Area</CardTitle>
                  {!isPro && <Lock className="size-4 text-muted-foreground" />}
                </div>
                <CardDescription className="mt-1">
                  Define how the marketplace matches incoming agent leads
                  to your listing. Polygon matches always win over radius
                  and ZIP fallbacks.
                </CardDescription>
              </div>
              <Badge variant="outline" className="text-[10px]">Pro polygon</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="service_radius">Service Radius (miles)</Label>
              <Input
                id="service_radius"
                type="number"
                min={1}
                max={500}
                value={branding.service_radius_miles ?? ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  const next = raw === "" ? null : Math.max(1, Math.min(500, Number(raw) || 0));
                  setBranding({ ...branding, service_radius_miles: next });
                }}
                placeholder="25"
              />
              <p className="text-xs text-muted-foreground">
                Used for radius-based matches when no polygon is drawn.
                Leave blank to match by ZIP / city only.
              </p>
            </div>

            {isPro ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Custom Polygon</Label>
                  {branding.service_polygon && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        setBranding({ ...branding, service_polygon: null })
                      }
                    >
                      <X className="h-3 w-3 mr-1" />
                      Clear polygon
                    </Button>
                  )}
                </div>
                <Suspense
                  fallback={
                    <div className="flex h-80 w-full items-center justify-center rounded-md border border-input bg-muted/30 text-xs text-muted-foreground">
                      Loading map editor…
                    </div>
                  }
                >
                  <ServiceAreaMap
                    initialPolygon={savedSnapshot.service_polygon}
                    initialCenter={null}
                    onPolygonChange={(p) =>
                      setBranding((prev) => ({ ...prev, service_polygon: p }))
                    }
                  />
                </Suspense>
                <p className="text-xs text-muted-foreground">
                  Click the polygon tool (top-right) to draw your service
                  area. Only one polygon is stored at a time — drawing a
                  new one replaces the old.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4 text-center">
                <p className="text-sm font-medium text-foreground">
                  Polygon service areas are a Pro feature
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Upgrade to draw the exact area where you accept jobs.
                  Your listing still matches via radius and ZIP today.
                </p>
                <Button size="sm" className="mt-3" onClick={() => handleUpgrade()}>
                  Upgrade to Pro
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <StudioPreviewPanel
        slug={savedSnapshot.slug}
        tier={savedSnapshot.tier}
        customDomain={savedSnapshot.custom_domain}
        hasPaid={hasPaid}
        hasUnsavedChanges={hasUnsavedChanges}
        refreshKey={previewVersion}
      />

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
