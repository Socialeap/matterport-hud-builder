import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { BrandingSection } from "./BrandingSection";
import { PropertyModelsSection } from "./PropertyModelsSection";
import { AgentContactSection } from "./AgentContactSection";
import { TourBehaviorModal } from "./TourBehaviorModal";
import { HudPreview } from "./HudPreview";
import { PortalSignupModal } from "./PortalSignupModal";
import type { PropertyModel, AgentContact, TourBehavior } from "./types";
import { DEFAULT_BEHAVIOR, DEFAULT_AGENT } from "./types";
import type { Tables } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { savePresentationRequest } from "@/lib/portal.functions";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe } from "@/lib/stripe";

interface HudBuilderSandboxProps {
  branding: Tables<"branding_settings">;
}

function createEmptyModel(): PropertyModel {
  return {
    id: crypto.randomUUID(),
    name: "",
    location: "",
    matterportId: "",
    musicUrl: "",
  };
}

export function HudBuilderSandbox({ branding }: HudBuilderSandboxProps) {
  // Auth state
  const [userId, setUserId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
      setAuthChecked(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Branding state (pre-filled from MSP settings)
  const [brandName, setBrandName] = useState(branding.brand_name);
  const [accentColor, setAccentColor] = useState(branding.accent_color);
  const [hudBgColor, setHudBgColor] = useState(branding.hud_bg_color);
  const [gateLabel, setGateLabel] = useState(branding.gate_label);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(branding.logo_url);
  const [faviconPreview, setFaviconPreview] = useState<string | null>(branding.favicon_url);

  // Models
  const [models, setModels] = useState<PropertyModel[]>(() => {
    const first = createEmptyModel();
    return [first];
  });
  const [behaviors, setBehaviors] = useState<Record<string, TourBehavior>>(() => {
    const initial: Record<string, TourBehavior> = {};
    return initial;
  });

  // Ensure first model has behavior
  const firstModelId = models[0]?.id;
  if (firstModelId && !behaviors[firstModelId]) {
    behaviors[firstModelId] = { ...DEFAULT_BEHAVIOR };
  }

  // Agent
  const [agent, setAgent] = useState<AgentContact>({ ...DEFAULT_AGENT });

  // Behavior modal
  const [behaviorModalOpen, setBehaviorModalOpen] = useState(false);
  const [behaviorModelId, setBehaviorModelId] = useState<string | null>(null);

  // Preview
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);

  // Signup modal
  const [signupOpen, setSignupOpen] = useState(false);

  // Intent/submission state
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  // Purchase state
  const [reviewApproved, setReviewApproved] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [savedModelId, setSavedModelId] = useState<string | null>(null);
  const [isReleased, setIsReleased] = useState(false);

  const isPro = branding.tier === "pro";
  const hasPricing = branding.base_price_cents != null && branding.stripe_onboarding_complete;

  // Calculate price
  const modelCount = models.filter((m) => m.matterportId.trim()).length;
  const basePriceCents = branding.base_price_cents ?? 0;
  const threshold = branding.model_threshold ?? 1;
  const additionalFeeCents = branding.additional_model_fee_cents ?? 0;
  const totalCents = modelCount <= threshold
    ? basePriceCents
    : basePriceCents + ((modelCount - threshold) * additionalFeeCents);
  const extraModels = Math.max(0, modelCount - threshold);

  const handleBrandingChange = useCallback((field: string, value: string) => {
    switch (field) {
      case "brandName": setBrandName(value); break;
      case "accentColor": setAccentColor(value); break;
      case "hudBgColor": setHudBgColor(value); break;
      case "gateLabel": setGateLabel(value); break;
    }
  }, []);

  const handleFileChange = useCallback((field: "logo" | "favicon", file: File | null) => {
    if (field === "logo") {
      setLogoFile(file);
      setLogoPreview(file ? URL.createObjectURL(file) : branding.logo_url);
    } else {
      setFaviconFile(file);
      setFaviconPreview(file ? URL.createObjectURL(file) : branding.favicon_url);
    }
  }, [branding.logo_url, branding.favicon_url]);

  const handleAddModel = useCallback(() => {
    const newModel = createEmptyModel();
    setModels((prev) => [...prev, newModel]);
    setBehaviors((prev) => ({ ...prev, [newModel.id]: { ...DEFAULT_BEHAVIOR } }));
  }, []);

  const handleRemoveModel = useCallback((id: string) => {
    setModels((prev) => prev.filter((m) => m.id !== id));
    setBehaviors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSelectedModelIndex(0);
  }, []);

  const handleModelChange = useCallback((id: string, field: keyof PropertyModel, value: string) => {
    setModels((prev) =>
      prev.map((m) => (m.id === id ? { ...m, [field]: value } : m))
    );
  }, []);

  const handleOpenBehavior = useCallback((id: string) => {
    setBehaviorModelId(id);
    setBehaviorModalOpen(true);
  }, []);

  const handleBehaviorChange = useCallback(
    (field: keyof TourBehavior, value: string | boolean) => {
      if (!behaviorModelId) return;
      setBehaviors((prev) => ({
        ...prev,
        [behaviorModelId]: { ...prev[behaviorModelId], [field]: value },
      }));
    },
    [behaviorModelId]
  );

  const handleAgentChange = useCallback((field: keyof AgentContact, value: string) => {
    setAgent((prev) => ({ ...prev, [field]: value }));
  }, []);

  const submitRequest = useCallback(async (authenticatedUserId: string) => {
    setSubmitting(true);
    try {
      const result = await savePresentationRequest({
        data: {
          providerId: branding.provider_id,
          name: models[0]?.name || "Untitled Presentation",
          properties: models,
          tourConfig: behaviors as unknown as Record<string, unknown>,
          agent: agent as unknown as Record<string, string>,
          brandingOverrides: {
            brandName,
            accentColor,
            hudBgColor,
            gateLabel,
          },
        },
      });

      if (result.success) {
        setShowConfirmation(true);
      } else {
        toast.error(result.error || "Failed to submit request");
      }
    } catch (err) {
      toast.error("An error occurred. Please try again.");
      console.error(err);
    }
    setSubmitting(false);
  }, [branding.provider_id, models, behaviors, agent, brandName, accentColor, hudBgColor, gateLabel]);

  const handleConfirmIntent = useCallback(() => {
    if (!userId) {
      // Not logged in — show signup modal
      setSignupOpen(true);
    } else {
      // Already logged in — submit directly
      submitRequest(userId);
    }
  }, [userId, submitRequest]);

  const handleAuthenticated = useCallback((newUserId: string) => {
    setUserId(newUserId);
    setSignupOpen(false);
    submitRequest(newUserId);
  }, [submitRequest]);

  const behaviorModel = behaviorModelId ? models.find((m) => m.id === behaviorModelId) : null;

  if (showConfirmation) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="mx-auto max-w-lg text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-foreground">Request Submitted!</h2>
          <p className="mt-2 text-muted-foreground">
            Your presentation configuration has been saved. To proceed, complete payment using the link below.
          </p>
           <p className="mt-4 text-sm text-muted-foreground">
              Your presentation has been submitted. You will be notified when it is ready for download.
            </p>
          {!isPro && (
            <p className="mt-6 text-xs text-muted-foreground">Powered by Transcendence Media</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Portal header */}
      <header
        className="border-b px-6 py-4"
        style={{ borderColor: `${accentColor}33` }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            {logoPreview && (
              <img src={logoPreview} alt="Logo" className="h-8 object-contain" />
            )}
            <span className="text-lg font-bold text-foreground">
              {brandName || "Property Tours"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {userId && (
              <span className="text-xs text-muted-foreground">Signed in</span>
            )}
            {!isPro && (
              <span className="text-xs text-muted-foreground">Powered by Transcendence Media</span>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="grid gap-8 lg:grid-cols-[1fr,1fr]">
          {/* Left: Builder inputs */}
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Build Your 3D Presentation
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Configure your property tours, add branding, and preview in real-time.
              </p>
            </div>

            <BrandingSection
              brandName={brandName}
              accentColor={accentColor}
              hudBgColor={hudBgColor}
              gateLabel={gateLabel}
              logoFile={logoFile}
              faviconFile={faviconFile}
              logoPreview={logoPreview}
              faviconPreview={faviconPreview}
              onChange={handleBrandingChange}
              onFileChange={handleFileChange}
            />

            <PropertyModelsSection
              models={models}
              onAdd={handleAddModel}
              onRemove={handleRemoveModel}
              onChange={handleModelChange}
              onOpenBehavior={handleOpenBehavior}
            />

            <AgentContactSection
              agent={agent}
              onChange={handleAgentChange}
            />

            {/* CTA */}
            <div className="rounded-lg border-2 p-6 text-center" style={{ borderColor: accentColor }}>
              <h3 className="text-lg font-semibold text-foreground">
                Satisfied with your preview?
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Request your professional presentation and receive it once payment is confirmed.
              </p>
              <Button
                size="lg"
                className="mt-4 text-white"
                style={{ backgroundColor: accentColor }}
                onClick={handleConfirmIntent}
                disabled={submitting}
              >
                {submitting ? "Submitting…" : "I Want This — Request Presentation"}
              </Button>
            </div>
          </div>

          {/* Right: Live HUD Preview */}
          <div className="lg:sticky lg:top-8 lg:self-start">
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Desktop HUD Preview
            </h2>
            <HudPreview
              models={models}
              selectedModelIndex={selectedModelIndex}
              onSelectModel={setSelectedModelIndex}
              behaviors={behaviors}
              brandName={brandName}
              accentColor={accentColor}
              hudBgColor={hudBgColor}
              logoPreview={logoPreview}
              agent={agent}
              isPro={isPro}
            />
          </div>
        </div>
      </div>

      {/* Behavior Modal */}
      {behaviorModel && (
        <TourBehaviorModal
          open={behaviorModalOpen}
          onOpenChange={setBehaviorModalOpen}
          behavior={behaviors[behaviorModel.id] || DEFAULT_BEHAVIOR}
          onChange={handleBehaviorChange}
          modelId={behaviorModel.matterportId}
          modelName={behaviorModel.name}
        />
      )}

      {/* Signup Modal */}
      <PortalSignupModal
        open={signupOpen}
        onOpenChange={setSignupOpen}
        onAuthenticated={handleAuthenticated}
        providerId={branding.provider_id}
        accentColor={accentColor}
        brandName={brandName}
      />
    </div>
  );
}
