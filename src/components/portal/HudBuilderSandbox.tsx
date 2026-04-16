import { useState, useCallback, useEffect, useRef } from "react";
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
import { savePresentationRequest, generatePresentation } from "@/lib/portal.functions";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripeForConnect } from "@/lib/stripe";
import { useServerFn } from "@tanstack/react-start";
import { EmbeddingWorkerClient } from "@/lib/rag/embedding-worker-client";
import type { QAEntry, QADatabaseEntry } from "@/lib/rag/types";

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
  const [downloading, setDownloading] = useState(false);
  const [downloadStep, setDownloadStep] = useState("");
  const [isPolling, setIsPolling] = useState(false);
  const [connectAccountId, setConnectAccountId] = useState<string | null>(null);
  const [checkoutClientSecret, setCheckoutClientSecret] = useState<string | null>(null);
  const generatePresentationFn = useServerFn(generatePresentation);
  const workerRef = useRef<EmbeddingWorkerClient | null>(null);

  // Post-payment polling: detect return from Stripe checkout
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutModelId = params.get("checkout_model_id");
    if (!checkoutModelId) return;

    setSavedModelId(checkoutModelId);
    setIsPolling(true);
    setShowCheckout(false);
    let attempts = 0;
    const maxAttempts = 15;
    const interval = setInterval(async () => {
      attempts++;
      const { data } = await supabase
        .from("saved_models")
        .select("status, is_released")
        .eq("id", checkoutModelId)
        .single();
      if (data?.status === "paid") {
        setIsReleased(true);
        setIsPolling(false);
        clearInterval(interval);
      }
      if (attempts >= maxAttempts) {
        setIsPolling(false);
        clearInterval(interval);
        toast.error("Payment verification timed out. Please refresh the page.");
      }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const isPro = branding.tier === "pro";
  const licenseExpired = branding.license_expiry_date
    ? new Date(branding.license_expiry_date) < new Date()
    : false;
  const licenseActive = branding.license_status === "active" && !licenseExpired;
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

            {/* License Expired Kill-Switch */}
            {!licenseActive && (
              <div className="rounded-lg border-2 border-amber-500 bg-amber-500/5 p-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-foreground">Operating License Renewal Required</h3>
                <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
                  Your Studio setup is permanent, but your AI engine and hosting license has expired.
                  Renew now to continue exporting smart 3D presentations.
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  Please contact the studio provider to renew their operating license.
                </p>
              </div>
            )}

            {/* Purchase / Download Card */}
            {!licenseActive ? null : isPolling ? (
              <div className="rounded-lg border-2 border-primary/50 bg-primary/5 p-6 text-center">
                <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <h3 className="text-lg font-semibold text-foreground">Verifying Payment…</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Please wait while we confirm your payment. This may take a few seconds.
                </p>
              </div>
            ) : isReleased ? (
              <div className="rounded-lg border-2 border-green-500 bg-green-500/5 p-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-foreground">Payment Confirmed!</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your presentation is ready for download.
                </p>
                <Button
                  size="lg"
                  className="mt-4 text-white"
                  style={{ backgroundColor: accentColor }}
                  disabled={downloading || !savedModelId}
                  onClick={async () => {
                    if (!savedModelId) return;
                    setDownloading(true);
                    setDownloadStep("Generating Q&A dictionary…");
                    try {
                      // ── Step 1: Build property spec text for Q&A generation ──
                      const specParts: string[] = [];
                      for (const m of models) {
                        if (m.name) specParts.push(`## Property: ${m.name}`);
                        if (m.location) specParts.push(`Location: ${m.location}`);
                      }
                      if (agent.name) {
                        specParts.push(`## Agent Contact`);
                        specParts.push(`Name: ${agent.name}`);
                        if (agent.titleRole) specParts.push(`Title: ${agent.titleRole}`);
                        if (agent.email) specParts.push(`Email: ${agent.email}`);
                        if (agent.phone) specParts.push(`Phone: ${agent.phone}`);
                        if (agent.welcomeNote) specParts.push(`Note: ${agent.welcomeNote}`);
                      }
                      const propertySpec = specParts.join("\n");

                      // ── Step 2: Call generate-qa-dictionary Edge Function ────
                      let qaDatabase: QADatabaseEntry[] = [];

                      if (propertySpec.trim().length >= 20) {
                        const { data: sessionData } = await supabase.auth.getSession();
                        const token = sessionData?.session?.access_token;

                        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
                        const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

                        const qaRes = await fetch(
                          `${supabaseUrl}/functions/v1/generate-qa-dictionary`,
                          {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                              Authorization: `Bearer ${token || supabaseKey}`,
                              apikey: supabaseKey,
                            },
                            body: JSON.stringify({ propertySpec }),
                          },
                        );

                        if (qaRes.ok) {
                          const qaData = await qaRes.json();
                          const entries: QAEntry[] = qaData.entries || [];

                          if (entries.length > 0) {
                            // ── Step 3: Embed questions via Web Worker ─────────
                            setDownloadStep(`Embedding ${entries.length} Q&A pairs…`);

                            if (!workerRef.current) {
                              workerRef.current = new EmbeddingWorkerClient();
                            }
                            await workerRef.current.init();

                            const questions = entries.map((e) => e.question);
                            const embeddings = await workerRef.current.embedBatch(questions);

                            qaDatabase = entries.map((entry, i) => ({
                              id: `qa-${i}`,
                              question: entry.question,
                              answer: entry.answer,
                              source_anchor_id: entry.source_anchor_id,
                              embedding: embeddings[i],
                            }));
                          }
                        } else {
                          console.warn("Q&A generation failed, continuing without Q&A:", await qaRes.text());
                        }
                      }

                      // ── Step 4: Generate presentation HTML with Q&A baked in ─
                      setDownloadStep("Building presentation…");
                      const result = await generatePresentationFn({
                        data: { modelId: savedModelId, qaDatabase },
                      });
                      if (!result.success || !result.html) {
                        toast.error(result.error || "Failed to generate presentation");
                        return;
                      }
                      const blob = new Blob([result.html], { type: "text/html" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      const safeName = (models[0]?.name || "presentation").replace(/[^a-zA-Z0-9_-]/g, "_");
                      a.download = `${safeName}.html`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    } catch {
                      toast.error("Download failed. Please try again.");
                    }
                    setDownloading(false);
                    setDownloadStep("");
                  }}
                >
                  {downloading ? (downloadStep || "Generating…") : "Download Presentation File"}
                </Button>
              </div>
            ) : showCheckout && savedModelId && connectAccountId && checkoutClientSecret ? (
              <div className="rounded-lg border p-6">
                <h3 className="text-lg font-semibold text-foreground mb-4">Complete Payment</h3>
                <EmbeddedCheckoutProvider
                  stripe={getStripeForConnect(connectAccountId)}
                  options={{ clientSecret: checkoutClientSecret }}
                >
                  <EmbeddedCheckout />
                </EmbeddedCheckoutProvider>
              </div>
            ) : hasPricing ? (
              <div className="rounded-lg border-2 p-6" style={{ borderColor: accentColor }}>
                <h3 className="text-lg font-semibold text-foreground">
                  Purchase & Download Your Presentation
                </h3>

                {/* Price breakdown */}
                <div className="mt-4 rounded-md bg-muted/50 p-4 text-left text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Base Package ({threshold} model{threshold > 1 ? "s" : ""} included)
                    </span>
                    <span className="font-medium text-foreground">${(basePriceCents / 100).toFixed(2)}</span>
                  </div>
                  {extraModels > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        + {extraModels} extra model{extraModels > 1 ? "s" : ""} × ${(additionalFeeCents / 100).toFixed(2)}
                      </span>
                      <span className="font-medium text-foreground">
                        ${((extraModels * additionalFeeCents) / 100).toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div className="border-t border-border pt-2 mt-2 flex justify-between font-semibold">
                    <span>Total</span>
                    <span>${(totalCents / 100).toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {modelCount} model{modelCount !== 1 ? "s" : ""} in this presentation
                  </p>
                </div>

                {/* Review checkbox */}
                <div className="mt-4 flex items-start gap-3">
                  <Checkbox
                    id="review-approved"
                    checked={reviewApproved}
                    onCheckedChange={(v) => setReviewApproved(v === true)}
                  />
                  <label htmlFor="review-approved" className="text-sm text-muted-foreground cursor-pointer leading-snug">
                    I have reviewed and approve this as my finalized presentation.
                  </label>
                </div>

                {/* Purchase button */}
                {reviewApproved && (
                  <Button
                    size="lg"
                    className="mt-4 w-full text-white"
                    style={{ backgroundColor: accentColor }}
                    disabled={submitting || modelCount < 1}
                    onClick={async () => {
                      if (!userId) {
                        setSignupOpen(true);
                        return;
                      }
                      setSubmitting(true);
                      try {
                        const result = await savePresentationRequest({
                          data: {
                            providerId: branding.provider_id,
                            name: models[0]?.name || "Untitled Presentation",
                            properties: models,
                            tourConfig: behaviors as unknown as Record<string, unknown>,
                            agent: agent as unknown as Record<string, string>,
                            brandingOverrides: { brandName, accentColor, hudBgColor, gateLabel },
                          },
                        });
                        if (result.success && result.modelId) {
                          setSavedModelId(result.modelId);
                          // Pre-fetch checkout session to get Connect account ID + client secret
                          const { data: checkoutData, error: checkoutError } = await supabase.functions.invoke("create-connect-checkout", {
                            body: {
                              providerId: branding.provider_id,
                              modelId: result.modelId,
                              modelCount,
                              returnUrl: `${window.location.origin}${window.location.pathname}?checkout_model_id=${result.modelId}&session_id={CHECKOUT_SESSION_ID}`,
                            },
                          });
                          if (checkoutError || !checkoutData?.clientSecret || !checkoutData?.stripeConnectAccountId) {
                            toast.error("Failed to create checkout session");
                          } else {
                            setConnectAccountId(checkoutData.stripeConnectAccountId);
                            setCheckoutClientSecret(checkoutData.clientSecret);
                            setShowCheckout(true);
                          }
                        } else {
                          toast.error(result.error || "Failed to save presentation");
                        }
                      } catch {
                        toast.error("An error occurred. Please try again.");
                      }
                      setSubmitting(false);
                    }}
                  >
                    {submitting ? "Preparing…" : `Purchase — $${(totalCents / 100).toFixed(2)}`}
                  </Button>
                )}
              </div>
            ) : (
              /* Fallback: no pricing configured, use old flow */
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
            )}
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
