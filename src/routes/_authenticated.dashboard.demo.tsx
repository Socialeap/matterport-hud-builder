import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BrandingSection } from "@/components/portal/BrandingSection";
import { PropertyModelsSection } from "@/components/portal/PropertyModelsSection";
import { AgentContactSection } from "@/components/portal/AgentContactSection";
import { TourBehaviorModal } from "@/components/portal/TourBehaviorModal";
import { HudPreview } from "@/components/portal/HudPreview";
import type { PropertyModel, AgentContact, TourBehavior } from "@/components/portal/types";
import { DEFAULT_BEHAVIOR, DEFAULT_AGENT } from "@/components/portal/types";

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
