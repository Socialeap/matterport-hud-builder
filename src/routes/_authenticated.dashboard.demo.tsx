import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BrandingSection } from "@/components/portal/BrandingSection";
import { PropertyModelsSection } from "@/components/portal/PropertyModelsSection";
import { AgentContactSection } from "@/components/portal/AgentContactSection";
import { TourBehaviorModal } from "@/components/portal/TourBehaviorModal";
import { HudPreview } from "@/components/portal/HudPreview";
import type { PropertyModel, AgentContact, TourBehavior } from "@/components/portal/types";
import { DEFAULT_BEHAVIOR, DEFAULT_AGENT } from "@/components/portal/types";
import { useServerFn } from "@tanstack/react-start";
import { getSandboxDemo, saveSandboxDemo, publishSandboxDemo } from "@/lib/sandbox-demo.functions";
import { useLusLicense } from "@/hooks/useLusLicense";
import { toast } from "sonner";
import { ExternalLink, Save, Globe, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard/demo")({
  component: DemoPage,
});

function createEmptyModel(): PropertyModel {
  return {
    id: crypto.randomUUID(),
    name: "",
    location: "",
    matterportId: "",
    musicUrl: "",
    enableNeighborhoodMap: false,
  };
}

function DemoPage() {
  // Branding state (demo defaults)
  const [brandName, setBrandName] = useState("My Brokerage");
  const [accentColor, setAccentColor] = useState("#0f6fff");
  const [hudBgColor, setHudBgColor] = useState("#08111d");
  const [gateLabel, setGateLabel] = useState("Explore Tour");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [faviconPreview, setFaviconPreview] = useState<string | null>(null);

  // Models
  const [models, setModels] = useState<PropertyModel[]>(() => [createEmptyModel()]);
  const [behaviors, setBehaviors] = useState<Record<string, TourBehavior>>({});

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

  // Publish state
  const [isPublished, setIsPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [studioSlug, setStudioSlug] = useState<string | null>(null);

  const getDemo = useServerFn(getSandboxDemo);
  const saveDemo = useServerFn(saveSandboxDemo);
  const publishDemo = useServerFn(publishSandboxDemo);
  const { isActive: lusActive, loading: lusLoading } = useLusLicense();

  // Load existing demo + studio slug on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getDemo();
        if (cancelled) return;
        if (result.demo) {
          const overrides = (result.demo.brand_overrides ?? {}) as {
            brandName?: string;
            accentColor?: string;
            hudBgColor?: string;
            gateLabel?: string;
            logoUrl?: string | null;
            faviconUrl?: string | null;
          };
          if (overrides.brandName) setBrandName(overrides.brandName);
          if (overrides.accentColor) setAccentColor(overrides.accentColor);
          if (overrides.hudBgColor) setHudBgColor(overrides.hudBgColor);
          if (overrides.gateLabel) setGateLabel(overrides.gateLabel);
          // Only restore durable (non-blob:) URLs from previous saves.
          if (overrides.logoUrl && !overrides.logoUrl.startsWith("blob:")) {
            setLogoPreview(overrides.logoUrl);
          }
          if (overrides.faviconUrl && !overrides.faviconUrl.startsWith("blob:")) {
            setFaviconPreview(overrides.faviconUrl);
          }
          const loadedProps = ((result.demo.properties as unknown) ?? []) as PropertyModel[];
          if (loadedProps.length > 0) setModels(loadedProps);
          const loadedBehaviors = ((result.demo.behaviors as unknown) ?? {}) as Record<string, TourBehavior>;
          if (Object.keys(loadedBehaviors).length > 0) setBehaviors(loadedBehaviors);
          const loadedAgent = ((result.demo.agent as unknown) ?? {}) as Partial<AgentContact>;
          setAgent({ ...DEFAULT_AGENT, ...loadedAgent });
          setIsPublished(!!result.demo.is_published);
        }
      } catch (err) {
        console.error("Failed to load demo:", err);
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (user && !cancelled) {
        const { data: branding } = await supabase
          .from("branding_settings")
          .select("slug")
          .eq("provider_id", user.id)
          .maybeSingle();
        if (branding?.slug && !cancelled) setStudioSlug(branding.slug);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getDemo]);

  // Upload a brand asset (logo or favicon) to public storage if still a local File.
  // Returns the durable URL or null on failure.
  const uploadIfFile = useCallback(
    async (file: File | null, currentPreview: string | null, kind: "logo" | "favicon"): Promise<string | null> => {
      if (file) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;
        const ext = (file.name.split(".").pop() || "png").toLowerCase();
        const path = `demo-${kind}s/${user.id}/${Date.now()}-${kind}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("brand-assets")
          .upload(path, file, { upsert: true, contentType: file.type || undefined });
        if (uploadErr) {
          console.error(`${kind} upload failed:`, uploadErr);
          toast.error(`Failed to upload ${kind}`);
          return null;
        }
        const { data: urlData } = supabase.storage.from("brand-assets").getPublicUrl(path);
        return urlData.publicUrl;
      }
      // No fresh file: keep existing preview unless it's a stale blob: URL.
      if (currentPreview && currentPreview.startsWith("blob:")) return null;
      return currentPreview;
    },
    []
  );

  const ensureBrandAssetUrls = useCallback(async (): Promise<{ logoUrl: string | null; faviconUrl: string | null }> => {
    const [logoUrl, faviconUrl] = await Promise.all([
      uploadIfFile(logoFile, logoPreview, "logo"),
      uploadIfFile(faviconFile, faviconPreview, "favicon"),
    ]);
    // Replace local previews with durable URLs and clear the File handles.
    if (logoFile) {
      setLogoFile(null);
      if (logoUrl) setLogoPreview(logoUrl);
    }
    if (faviconFile) {
      setFaviconFile(null);
      if (faviconUrl) setFaviconPreview(faviconUrl);
    }
    return { logoUrl, faviconUrl };
  }, [uploadIfFile, logoFile, logoPreview, faviconFile, faviconPreview]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const { logoUrl, faviconUrl } = await ensureBrandAssetUrls();
      const result = await saveDemo({
        data: {
          brand_overrides: { brandName, accentColor, hudBgColor, gateLabel, logoUrl, faviconUrl },
          properties: models,
          behaviors,
          agent: agent as unknown as Record<string, unknown>,
        },
      });
      if (result.success) {
        toast.success("Demo saved");
      } else {
        toast.error(result.error || "Failed to save demo");
      }
    } catch {
      toast.error("Failed to save demo");
    }
    setSaving(false);
  }, [saveDemo, ensureBrandAssetUrls, brandName, accentColor, hudBgColor, gateLabel, models, behaviors, agent]);

  const handlePublishToggle = useCallback(async (publish: boolean) => {
    if (publish && !lusActive) {
      toast.error("An active LUS license is required to publish your demo.");
      return;
    }
    setPublishing(true);
    try {
      if (publish) {
        const { logoUrl, faviconUrl } = await ensureBrandAssetUrls();
        await saveDemo({
          data: {
            brand_overrides: { brandName, accentColor, hudBgColor, gateLabel, logoUrl, faviconUrl },
            properties: models,
            behaviors,
            agent: agent as unknown as Record<string, unknown>,
          },
        });
      }
      const result = await publishDemo({ data: { publish } });
      if (result.success) {
        setIsPublished(publish);
        toast.success(publish ? "Demo is now live on your Studio" : "Demo unpublished");
      } else {
        toast.error(result.error || "Failed to update publish state");
      }
    } catch {
      toast.error("Failed to update publish state");
    }
    setPublishing(false);
  }, [publishDemo, saveDemo, ensureBrandAssetUrls, lusActive, brandName, accentColor, hudBgColor, gateLabel, models, behaviors, agent]);

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
      setLogoPreview(file ? URL.createObjectURL(file) : null);
    } else {
      setFaviconFile(file);
      setFaviconPreview(file ? URL.createObjectURL(file) : null);
    }
  }, []);

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

  const behaviorModel = behaviorModelId ? models.find((m) => m.id === behaviorModelId) : null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            3D Presentation Studio Demo
          </h1>
          <p className="text-sm text-muted-foreground">
            This is a live sandbox — configure branding, add properties, adjust tour behaviors, and preview the result in real-time.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">Sandbox Mode</Badge>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr,1fr]">
        {/* Left: Builder inputs */}
        <div className="space-y-6">
          <Tabs defaultValue="branding" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="branding">Branding</TabsTrigger>
              <TabsTrigger value="properties">Properties</TabsTrigger>
              <TabsTrigger value="agent">Agent</TabsTrigger>
            </TabsList>

            <TabsContent value="branding" className="mt-4">
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
            </TabsContent>

            <TabsContent value="properties" className="mt-4">
              <PropertyModelsSection
                models={models}
                onAdd={handleAddModel}
                onRemove={handleRemoveModel}
                onChange={handleModelChange}
                onOpenBehavior={handleOpenBehavior}
              />
            </TabsContent>

            <TabsContent value="agent" className="mt-4">
              <AgentContactSection
                agent={agent}
                onChange={handleAgentChange}
              />
            </TabsContent>
          </Tabs>

          {/* Publish as Public Demo */}
          <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <Globe className="h-4 w-4" />
                  Publish as Public Demo
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Save this configuration and expose it as a live, read-only demo on your public Studio.
                  Visitors to your slug page will see a "View Live Demo" CTA.
                </p>
              </div>
              {!lusActive && !lusLoading && (
                <Lock className="h-4 w-4 text-muted-foreground shrink-0" aria-label="License required" />
              )}
            </div>

            {!lusActive && !lusLoading && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-foreground">
                Publishing requires an active LUS (License for Upkeep Services) license.
              </div>
            )}

            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="publish-toggle" className="text-sm font-medium">
                  Show on public Studio
                </Label>
                <p className="text-xs text-muted-foreground">
                  {isPublished ? "Your demo is live." : "Toggle on to publish."}
                </p>
              </div>
              <Switch
                id="publish-toggle"
                checked={isPublished}
                disabled={publishing || (!lusActive && !isPublished)}
                onCheckedChange={handlePublishToggle}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSave}
                disabled={saving}
              >
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Saving…" : "Save Draft"}
              </Button>
              {isPublished && studioSlug && (
                <Button variant="ghost" size="sm" asChild>
                  <a
                    href={`/p/${studioSlug}/demo`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    View Live
                  </a>
                </Button>
              )}
              {!studioSlug && (
                <span className="text-xs text-muted-foreground">
                  Set a slug in Branding to enable a public URL.
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: Live HUD Preview */}
        <div className="lg:sticky lg:top-8 lg:self-start">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Live HUD Preview
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
            isPro={false}
          />
          <p className="mt-3 text-xs text-muted-foreground text-center">
            Enter a Matterport Model ID above to see the 3D tour embedded in the preview.
          </p>
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
    </div>
  );
}
