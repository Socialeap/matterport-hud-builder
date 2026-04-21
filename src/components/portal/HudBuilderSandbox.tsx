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
import { savePresentationRequest, generatePresentation, getStudioAccessState } from "@/lib/portal.functions";
import { uploadBrandAsset } from "@/lib/storage";
import { toast } from "sonner";
import { calculatePresentationPrice } from "@/lib/portal/pricing";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripeForConnect } from "@/lib/stripe";
import { useServerFn } from "@tanstack/react-start";
import { EmbeddingWorkerClient } from "@/lib/rag/embedding-worker-client";
import { buildPropertyQAEntries } from "@/lib/rag/property-qa-builder";
import type { QAEntry, QADatabaseEntry } from "@/lib/rag/types";
import {
  saveDraft,
  loadDraft,
  clearDraft,
  exportDraftFile,
  importDraftFile,
  type DraftState,
} from "@/lib/portal/draft-storage";

interface HudBuilderSandboxProps {
  branding: Tables<"branding_settings">;
}

function createEmptyModel(): PropertyModel {
  return {
    id: crypto.randomUUID(),
    name: "",
    propertyName: "",
    location: "",
    matterportId: "",
    musicUrl: "",
    cinematicVideoUrl: "",
  };
}

export function HudBuilderSandbox({ branding }: HudBuilderSandboxProps) {
  // Auth state
  const [userId, setUserId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // License guard state
  const [licenseExpired, setLicenseExpired] = useState(false);
  const [licenseChecked, setLicenseChecked] = useState(false);

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

  // Check license status — for clients, check the provider's license
  useEffect(() => {
    if (!userId) return;

    const checkLicense = async () => {
      // First check if user has their own license (provider)
      const { data: ownLicense } = await supabase
        .from("licenses")
        .select("license_status, license_expiry")
        .eq("user_id", userId)
        .maybeSingle();

      if (ownLicense) {
        const isExpired =
          ownLicense.license_status === "expired" ||
          (ownLicense.license_expiry && new Date(ownLicense.license_expiry) < new Date());
        setLicenseExpired(!!isExpired);
        setLicenseChecked(true);
        return;
      }

      // No own license — check if client, look up provider's license
      const { data: providerLink } = await supabase
        .from("client_providers")
        .select("provider_id")
        .eq("client_id", userId)
        .maybeSingle();

      if (providerLink) {
        const { data: provLicense } = await supabase
          .from("licenses")
          .select("license_status, license_expiry")
          .eq("user_id", providerLink.provider_id)
          .maybeSingle();

        if (provLicense) {
          const isExpired =
            provLicense.license_status === "expired" ||
            (provLicense.license_expiry && new Date(provLicense.license_expiry) < new Date());
          setLicenseExpired(!!isExpired);
        }
      }

      setLicenseChecked(true);
    };

    checkLicense();
  }, [userId]);

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
  const [agentAvatarFile, setAgentAvatarFile] = useState<File | null>(null);
  const [agentAvatarUploading, setAgentAvatarUploading] = useState(false);

  // Behavior modal
  const [behaviorModalOpen, setBehaviorModalOpen] = useState(false);
  const [behaviorModelId, setBehaviorModelId] = useState<string | null>(null);

  // Preview
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);

  // Signup modal
  const [signupOpen, setSignupOpen] = useState(false);

  // Submission/download state
  const [submitting, setSubmitting] = useState(false);

  // Authoritative Studio access state (from resolve_studio_access RPC).
  // Replaces narrow client-side free/pricing/payout checks.
  const [accessState, setAccessState] = useState<{
    linked: boolean;
    isFree: boolean;
    pricingConfigured: boolean;
    payoutsReady: boolean;
    providerBrandName: string;
    loaded: boolean;
  }>({
    linked: false,
    isFree: false,
    pricingConfigured: false,
    payoutsReady: false,
    providerBrandName: "",
    loaded: false,
  });

  // Purchase / checkout state
  const [showCheckout, setShowCheckout] = useState(false);
  const [savedModelId, setSavedModelId] = useState<string | null>(null);
  const [isReleased, setIsReleased] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadStep, setDownloadStep] = useState("");
  const [isPolling, setIsPolling] = useState(false);
  const [connectAccountId, setConnectAccountId] = useState<string | null>(null);
  const [checkoutClientSecret, setCheckoutClientSecret] = useState<string | null>(null);
  const generatePresentationFn = useServerFn(generatePresentation);
  const getStudioAccessStateFn = useServerFn(getStudioAccessState);
  const workerRef = useRef<EmbeddingWorkerClient | null>(null);
  const autoDownloadTriggeredRef = useRef(false);

  // ── Draft autosave (client-side only, no backend) ─────────────────
  const providerSlug = branding.slug || branding.provider_id;
  const draftHydratedRef = useRef(false);
  const [draftBannerOpen, setDraftBannerOpen] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<{ data: DraftState; savedAt: string } | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  // On mount: check for an existing draft and offer to resume.
  useEffect(() => {
    const existing = loadDraft(providerSlug);
    if (existing) {
      setPendingDraft(existing);
      setDraftBannerOpen(true);
    } else {
      // Nothing to restore → mark hydrated so autosave can engage.
      draftHydratedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerSlug]);

  const applyDraft = useCallback((draft: DraftState) => {
    setBrandName(draft.brandName);
    setAccentColor(draft.accentColor);
    setHudBgColor(draft.hudBgColor);
    setGateLabel(draft.gateLabel);
    setModels(draft.models?.length ? draft.models : [createEmptyModel()]);
    setBehaviors(draft.behaviors || {});
    setAgent(draft.agent || { ...DEFAULT_AGENT });
  }, []);

  const handleResumeDraft = useCallback(() => {
    if (pendingDraft) {
      applyDraft(pendingDraft.data);
      toast.success("Draft restored");
    }
    setDraftBannerOpen(false);
    setPendingDraft(null);
    draftHydratedRef.current = true;
  }, [pendingDraft, applyDraft]);

  const handleDiscardDraft = useCallback(() => {
    clearDraft(providerSlug);
    setDraftBannerOpen(false);
    setPendingDraft(null);
    draftHydratedRef.current = true;
  }, [providerSlug]);

  const handleExportDraft = useCallback(() => {
    exportDraftFile(providerSlug, {
      brandName,
      accentColor,
      hudBgColor,
      gateLabel,
      models,
      behaviors,
      agent,
      reviewApproved: false,
    });
    toast.success("Draft exported");
  }, [providerSlug, brandName, accentColor, hudBgColor, gateLabel, models, behaviors, agent]);

  const handleImportDraft = useCallback(async (file: File) => {
    const draft = await importDraftFile(file);
    if (!draft) {
      toast.error("Could not read draft file");
      return;
    }
    applyDraft(draft);
    draftHydratedRef.current = true;
    setDraftBannerOpen(false);
    setPendingDraft(null);
    toast.success("Draft imported");
  }, [applyDraft]);

  // Debounced autosave whenever any tracked field changes (after hydration).
  useEffect(() => {
    if (!draftHydratedRef.current) return;
    const handle = window.setTimeout(() => {
      saveDraft(providerSlug, {
        brandName,
        accentColor,
        hudBgColor,
        gateLabel,
        models,
        behaviors,
        agent,
        reviewApproved: false,
      });
    }, 500);
    return () => window.clearTimeout(handle);
  }, [providerSlug, brandName, accentColor, hudBgColor, gateLabel, models, behaviors, agent]);

  // Post-payment polling: detect return from Stripe checkout and
  // auto-trigger the download once the webhook flips status to "paid".
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
        clearDraft(providerSlug);
        if (!autoDownloadTriggeredRef.current) {
          autoDownloadTriggeredRef.current = true;
          // Strip the query param so a refresh doesn't re-trigger polling.
          window.history.replaceState({}, "", window.location.pathname);
          runDownload(checkoutModelId);
        }
      }
      if (attempts >= maxAttempts) {
        setIsPolling(false);
        clearInterval(interval);
        toast.error("Payment verification timed out. Please refresh the page.");
      }
    }, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isPro = branding.tier === "pro";

  // Single source of truth for pricing — same function the edge function uses.
  const modelCount = models.filter((m) => m.matterportId.trim()).length;
  const providerBrandName = branding.brand_name?.trim() || brandName || "the provider";
  const pricing = calculatePresentationPrice({
    modelCount,
    use_flat_pricing: Boolean(
      (branding as { use_flat_pricing?: boolean | null }).use_flat_pricing
    ),
    flat_price_per_model_cents:
      (branding as { flat_price_per_model_cents?: number | null })
        .flat_price_per_model_cents ?? null,
    base_price_cents: branding.base_price_cents ?? null,
    tier3_price_cents:
      (branding as { tier3_price_cents?: number | null }).tier3_price_cents ?? null,
    additional_model_fee_cents: branding.additional_model_fee_cents ?? null,
  });
  const totalCents = pricing.totalCents;
  const pricingConfigured = pricing.configured;
  const payoutsReady = Boolean(
    branding.stripe_onboarding_complete &&
      (branding as { stripe_connect_id?: string | null }).stripe_connect_id
  );
  const checkoutReady = pricingConfigured && payoutsReady;

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

  const handleModelChange = useCallback((id: string, field: keyof PropertyModel, value: string | boolean) => {
    setModels((prev) =>
      prev.map((m) => (m.id === id ? { ...m, [field]: value } : m))
    );
  }, []);

  const handleMediaChange = useCallback((id: string, assets: import("./types").MediaAsset[]) => {
    setModels((prev) => prev.map((m) => (m.id === id ? { ...m, multimedia: assets } : m)));
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

  const handleAgentAvatarChange = useCallback(
    async (file: File | null) => {
      if (!file) {
        setAgentAvatarFile(null);
        setAgent((prev) => ({ ...prev, avatarUrl: "" }));
        return;
      }
      // Show local preview immediately so the user gets feedback even before auth/upload.
      const previewUrl = URL.createObjectURL(file);
      setAgentAvatarFile(file);
      setAgent((prev) => ({ ...prev, avatarUrl: previewUrl }));

      // If signed in, upload right away so the URL is permanent.
      if (userId) {
        setAgentAvatarUploading(true);
        try {
          const url = await uploadBrandAsset(userId, file, "avatar");
          if (url) {
            setAgent((prev) => ({ ...prev, avatarUrl: url }));
            setAgentAvatarFile(null);
            toast.success("Profile photo uploaded");
          } else {
            toast.error("Profile photo upload failed. It will be retried on submit.");
          }
        } catch (err) {
          console.error("Avatar upload failed:", err);
          toast.error("Profile photo upload failed. It will be retried on submit.");
        } finally {
          setAgentAvatarUploading(false);
        }
      }
    },
    [userId]
  );

  // ── Free-client status lookup ─────────────────────────────────────
  // Determines whether the bottom button is "Download" (free) or
  // "Pay $X & Download" (paid). Server is the authority — this is
  // only used for UI labelling.
  useEffect(() => {
    if (!userId) {
      setIsFreeClient(false);
      return;
    }
    let cancelled = false;
    getClientFreeStatusFn({ data: { providerId: branding.provider_id } })
      .then((res) => {
        if (!cancelled) setIsFreeClient(!!res?.isFree);
      })
      .catch(() => {
        if (!cancelled) setIsFreeClient(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, branding.provider_id, getClientFreeStatusFn]);

  /**
   * Generate the .html and trigger a browser download for the given
   * saved_model. Pre-condition: the model is `paid` + `is_released`
   * (server enforces this in `generatePresentation`).
   */
  const runDownload = useCallback(async (modelId: string) => {
    setDownloading(true);
    setDownloadStep("Generating Q&A dictionary…");
    try {
      // Step 1: Build property Q&A pairs locally (deterministic, no LLM).
      const entries: QAEntry[] = buildPropertyQAEntries(models, agent);

      // Step 2: Embed questions via Web Worker.
      let qaDatabase: QADatabaseEntry[] = [];
      if (entries.length > 0) {
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

      // Step 3: Generate presentation HTML with Q&A baked in.
      setDownloadStep("Building presentation…");
      const result = await generatePresentationFn({
        data: { modelId, qaDatabase },
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
      clearDraft(providerSlug);
      toast.success("Presentation downloaded");
    } catch (err) {
      console.error("Download failed:", err);
      toast.error("Download failed. Please try again.");
    }
    setDownloading(false);
    setDownloadStep("");
  }, [models, agent, generatePresentationFn, providerSlug]);

  /**
   * Single entry-point for the bottom "Download" / "Pay & Download"
   * button. Branches on auth + is_free + pricing.
   */
  const handleDownload = useCallback(async () => {
    // 1) Anonymous → open signup modal; flow re-runs after auth.
    if (!userId) {
      setSignupOpen(true);
      return;
    }

    // 2) Save / upsert the saved_model row first (and re-run avatar upload
    //    if a local file is still pending from pre-auth).
    setSubmitting(true);
    let finalAgent = agent;
    if (agentAvatarFile) {
      try {
        const url = await uploadBrandAsset(userId, agentAvatarFile, "avatar");
        if (url) {
          finalAgent = { ...agent, avatarUrl: url };
          setAgent(finalAgent);
          setAgentAvatarFile(null);
        }
      } catch (err) {
        console.error("Avatar upload (deferred) failed:", err);
      }
    }

    let modelId = savedModelId;
    try {
      const result = await savePresentationRequest({
        data: {
          providerId: branding.provider_id,
          name: models[0]?.name || "Untitled Presentation",
          properties: models,
          tourConfig: behaviors as unknown as Record<string, unknown>,
          agent: finalAgent as unknown as Record<string, string>,
          brandingOverrides: { brandName, accentColor, hudBgColor, gateLabel },
        },
      });
      if (!result.success || !result.modelId) {
        toast.error(result.error || "Failed to save presentation");
        setSubmitting(false);
        return;
      }
      modelId = result.modelId;
      setSavedModelId(modelId);
    } catch (err) {
      console.error(err);
      toast.error("An error occurred. Please try again.");
      setSubmitting(false);
      return;
    }

    // 3) Hit create-connect-checkout. Server decides free vs paid.
    try {
      const { data: checkoutData, error: checkoutError } =
        await supabase.functions.invoke("create-connect-checkout", {
          body: {
            providerId: branding.provider_id,
            modelId,
            modelCount,
            returnUrl: `${window.location.origin}${window.location.pathname}?checkout_model_id=${modelId}&session_id={CHECKOUT_SESSION_ID}`,
          },
        });

      if (checkoutError) {
        toast.error("Failed to create checkout session");
        setSubmitting(false);
        return;
      }

      // Free client → backend already marked paid + released.
      if (checkoutData?.free === true) {
        setIsReleased(true);
        setSubmitting(false);
        await runDownload(modelId);
        return;
      }

      // Paid client → embedded checkout.
      if (checkoutData?.clientSecret && checkoutData?.stripeConnectAccountId) {
        setConnectAccountId(checkoutData.stripeConnectAccountId);
        setCheckoutClientSecret(checkoutData.clientSecret);
        setShowCheckout(true);
        setSubmitting(false);
        return;
      }

      toast.error(checkoutData?.error || "Failed to create checkout session");
    } catch (err) {
      console.error(err);
      toast.error("An error occurred. Please try again.");
    }
    setSubmitting(false);
  }, [
    userId,
    agent,
    agentAvatarFile,
    savedModelId,
    branding.provider_id,
    models,
    behaviors,
    brandName,
    accentColor,
    hudBgColor,
    gateLabel,
    modelCount,
    runDownload,
  ]);

  const handleAuthenticated = useCallback((newUserId: string) => {
    setUserId(newUserId);
    setSignupOpen(false);
    // After successful auth, re-run the download flow.
    // Defer to next tick so userId state has a chance to settle.
    setTimeout(() => {
      handleDownload();
    }, 0);
  }, [handleDownload]);

  const behaviorModel = behaviorModelId ? models.find((m) => m.id === behaviorModelId) : null;

  return (
    <div className="min-h-screen bg-background">
      {/* Sandbox header */}
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
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportDraft(f);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => importInputRef.current?.click()}
            >
              Import Draft
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExportDraft}
            >
              Export Draft
            </Button>
            {!isPro && (
              <span className="text-xs text-muted-foreground">Powered by Transcendence Media</span>
            )}
          </div>
        </div>
      </header>

      {/* Resume-draft banner */}
      {draftBannerOpen && pendingDraft && (
        <div className="border-b bg-muted/40 px-6 py-3">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-foreground">
              <span className="font-medium">Resume your saved draft?</span>{" "}
              <span className="text-muted-foreground">
                Last saved {new Date(pendingDraft.savedAt).toLocaleString()}.
                Note: uploaded logo, favicon, and profile photo will need to be re-added.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleResumeDraft} style={{ backgroundColor: accentColor, color: "white" }}>
                Resume
              </Button>
              <Button size="sm" variant="outline" onClick={handleDiscardDraft}>
                Start fresh
              </Button>
            </div>
          </div>
        </div>
      )}

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
              onMediaChange={handleMediaChange}
              onOpenBehavior={handleOpenBehavior}
              savedModelId={savedModelId}
            />

            <AgentContactSection
              agent={agent}
              onChange={handleAgentChange}
              onAvatarFileChange={handleAgentAvatarChange}
            />

            {/* License Expired Banner */}
            {licenseExpired && (
              <div className="rounded-lg border-2 border-destructive/50 bg-destructive/5 p-6 text-center">
                <h3 className="text-lg font-semibold text-foreground">Operating License Renewal Required</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Your Studio setup is permanent, but your AI engine and Lead-Hook bridge require an active license.
                  Please renew your annual operating license to continue generating presentations.
                </p>
              </div>
            )}

            {/* Download / Payment Card */}
            {isPolling ? (
              <div className="rounded-lg border-2 border-primary/50 bg-primary/5 p-6 text-center">
                <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <h3 className="text-lg font-semibold text-foreground">Verifying Payment…</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Please wait while we confirm your payment, then your download will start automatically.
                </p>
              </div>
            ) : showCheckout && savedModelId && connectAccountId && checkoutClientSecret ? (
              <div className="rounded-lg border p-6">
                <h3 className="text-lg font-semibold text-foreground mb-4">Complete Payment</h3>
                <p className="mb-4 text-sm text-muted-foreground">
                  Total: <span className="font-semibold text-foreground">${(totalCents / 100).toFixed(2)}</span>
                  {" "}— your presentation will download automatically once payment is confirmed.
                </p>
                <EmbeddedCheckoutProvider
                  stripe={getStripeForConnect(connectAccountId)}
                  options={{ clientSecret: checkoutClientSecret }}
                >
                  <EmbeddedCheckout />
                </EmbeddedCheckoutProvider>
              </div>
            ) : isReleased && downloading ? (
              <div className="rounded-lg border-2 border-primary/50 bg-primary/5 p-6 text-center">
                <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <h3 className="text-lg font-semibold text-foreground">Preparing Your Download…</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {downloadStep || "Generating your presentation file…"}
                </p>
              </div>
            ) : isReleased ? (
              /* Re-download fallback (e.g. user closed the auto-download). */
              <div className="rounded-lg border-2 border-green-500 bg-green-500/5 p-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-foreground">Presentation Ready</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your presentation is unlocked. Click below to download again.
                </p>
                <Button
                  size="lg"
                  className="mt-4 text-white"
                  style={{ backgroundColor: accentColor }}
                  disabled={!savedModelId || licenseExpired}
                  onClick={() => savedModelId && runDownload(savedModelId)}
                >
                  Download Presentation
                </Button>
              </div>
            ) : isFreeClient ? (
              /* Free client — Download with no price. */
              <div className="rounded-lg border-2 p-6 text-center" style={{ borderColor: accentColor }}>
                <h3 className="text-lg font-semibold text-foreground">
                  Download Your Presentation
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Included with your account — no payment required.
                </p>
                <Button
                  size="lg"
                  className="mt-4 w-full text-white"
                  style={{ backgroundColor: accentColor }}
                  disabled={submitting || downloading || modelCount < 1 || licenseExpired}
                  onClick={handleDownload}
                >
                  {submitting
                    ? "Preparing…"
                    : downloading
                      ? (downloadStep || "Generating…")
                      : modelCount < 1
                        ? "Add a property to download"
                        : "Download Presentation"}
                </Button>
              </div>
            ) : checkoutReady ? (
              /* Paid client — Pay $X.XX & Download. */
              <div className="rounded-lg border-2 p-6" style={{ borderColor: accentColor }}>
                <h3 className="text-lg font-semibold text-foreground">
                  Download Your Presentation
                </h3>

                {/* Price breakdown — driven by the shared pricing function. */}
                <div className="mt-4 rounded-md bg-muted/50 p-4 text-left text-sm space-y-1">
                  {pricing.breakdown.map((line, i) => (
                    <div key={i} className="flex justify-between">
                      <span className="text-muted-foreground">{line.label}</span>
                      <span className="font-medium text-foreground">
                        ${(line.cents / 100).toFixed(2)}
                      </span>
                    </div>
                  ))}
                  <div className="border-t border-border pt-2 mt-2 flex justify-between font-semibold">
                    <span>Total</span>
                    <span>${(totalCents / 100).toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {modelCount} model{modelCount !== 1 ? "s" : ""} in this presentation
                  </p>
                </div>

                <Button
                  size="lg"
                  className="mt-4 w-full text-white"
                  style={{ backgroundColor: accentColor }}
                  disabled={submitting || downloading || modelCount < 1 || licenseExpired}
                  onClick={handleDownload}
                >
                  {submitting
                    ? "Preparing checkout…"
                    : modelCount < 1
                      ? "Add a property to continue"
                      : `Pay $${(totalCents / 100).toFixed(2)} & Download`}
                </Button>
              </div>
            ) : pricingConfigured ? (
              /* Pricing exists, but payment routing is unavailable. */
              <div className="rounded-lg border-2 border-muted p-6">
                <h3 className="text-lg font-semibold text-foreground">
                  Payment Temporarily Unavailable
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  This Studio's pricing is configured, but online checkout is not available right now.
                  If you need help completing payment, please contact{" "}
                  <span className="font-medium text-foreground">{providerBrandName}</span>.
                </p>

                <div className="mt-4 rounded-md bg-muted/50 p-4 text-left text-sm space-y-1">
                  {pricing.breakdown.map((line, i) => (
                    <div key={i} className="flex justify-between">
                      <span className="text-muted-foreground">{line.label}</span>
                      <span className="font-medium text-foreground">
                        ${(line.cents / 100).toFixed(2)}
                      </span>
                    </div>
                  ))}
                  <div className="border-t border-border pt-2 mt-2 flex justify-between font-semibold">
                    <span>Total</span>
                    <span>${(totalCents / 100).toFixed(2)}</span>
                  </div>
                </div>

                <Button
                  size="lg"
                  variant="outline"
                  className="mt-4 w-full"
                  disabled
                >
                  Payment Unavailable
                </Button>
              </div>
            ) : (
              /* No pricing configured + not free — informative notice only. */
              <div className="rounded-lg border-2 border-muted p-6 text-center">
                <h3 className="text-lg font-semibold text-foreground">
                  Pricing Unavailable
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  We couldn't load pricing for this Studio right now. If you need help completing payment,
                  please contact <span className="font-medium text-foreground">{providerBrandName}</span>.
                </p>
              </div>
            )}
          </div>

          {/* Right: Live Presentation Portal Preview */}
          <div className="lg:sticky lg:top-8 lg:self-start">
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Desktop Portal Preview
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
        brandName={providerBrandName}
      />
    </div>
  );
}
