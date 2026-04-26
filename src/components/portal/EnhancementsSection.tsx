import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Boxes,
  FileText,
  Layers,
  Link as LinkIcon,
  MapPin,
  Music,
  Wand2,
} from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { PropertyIntelligenceSection } from "./PropertyIntelligenceSection";
import { SoundLibraryPicker } from "./enhancements/SoundLibraryPicker";
import { VaultCatalogList } from "./enhancements/VaultCatalogList";
import type { PropertyModel } from "./types";

/**
 * Per-property map of which vault assets the client has chosen to apply.
 *
 * Only `spatial_audio` is wired to the runtime today; the other category keys
 * persist UI selections so the data is ready when those categories graduate
 * from "Coming soon" to a wired runtime feature.
 */
export interface PropertyEnhancements {
  /** Single ambient track for this property (overrides manual musicUrl). */
  spatial_audio?: string | null;
  visual_hud_filter?: string[];
  interactive_widget?: string[];
  custom_iconography?: string[];
  external_link?: string[];
}

export type EnhancementsByProperty = Record<string, PropertyEnhancements>;

interface Props {
  models: PropertyModel[];
  savedModelId: string | null;
  enhancements: EnhancementsByProperty;
  onEnhancementsChange: (next: EnhancementsByProperty) => void;
  onExtractionSuccess: () => void;
}

/**
 * "Enhancements" — single home for every Vault-sourced customization the
 * client can apply to their presentation. The user picks a property at the
 * top, then toggles assets in nested category accordions.
 */
export function EnhancementsSection({
  models,
  savedModelId,
  enhancements,
  onEnhancementsChange,
  onExtractionSuccess,
}: Props) {
  // Active property tab. Defaults to the first model and self-corrects if the
  // user removes the property currently selected.
  const [activeId, setActiveId] = useState<string>(() => models[0]?.id ?? "");

  useEffect(() => {
    if (!models.some((m) => m.id === activeId)) {
      setActiveId(models[0]?.id ?? "");
    }
  }, [models, activeId]);

  const activeModel = useMemo(
    () => models.find((m) => m.id === activeId) ?? models[0] ?? null,
    [models, activeId],
  );

  const activeEnhancements: PropertyEnhancements = useMemo(
    () => enhancements[activeId] ?? {},
    [enhancements, activeId],
  );

  const updateActive = (patch: Partial<PropertyEnhancements>) => {
    if (!activeId) return;
    onEnhancementsChange({
      ...enhancements,
      [activeId]: { ...activeEnhancements, ...patch },
    });
  };

  if (!activeModel) {
    return (
      <p className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-sm text-muted-foreground">
        Add a property model first — Enhancements apply per property.
      </p>
    );
  }

  const audioApplied = !!activeEnhancements.spatial_audio;

  return (
    <div className="space-y-4">
      {/* Intro */}
      <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-snug text-foreground/80">
        <p>
          Pick a property, then toggle the assets your provider has published.
          Selections are saved with your draft and applied when you generate
          the tour.
        </p>
      </div>

      {/* Property tab bar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Apply to:
        </span>
        {models.map((m, idx) => {
          const label = m.propertyName || m.name || `Property ${idx + 1}`;
          const isActive = m.id === activeId;
          const propEnh = enhancements[m.id] ?? {};
          const hasAny =
            !!propEnh.spatial_audio ||
            (propEnh.visual_hud_filter?.length ?? 0) > 0 ||
            (propEnh.interactive_widget?.length ?? 0) > 0 ||
            (propEnh.custom_iconography?.length ?? 0) > 0 ||
            (propEnh.external_link?.length ?? 0) > 0;
          return (
            <Button
              key={m.id}
              type="button"
              size="sm"
              variant={isActive ? "default" : "outline"}
              onClick={() => setActiveId(m.id)}
              className="gap-2"
            >
              <span className="max-w-[180px] truncate">{label}</span>
              {hasAny && !isActive && (
                <span className="size-1.5 rounded-full bg-primary" aria-label="Has enhancements" />
              )}
            </Button>
          );
        })}
      </div>

      {/* Nested category accordion */}
      <Accordion type="single" collapsible className="space-y-2">
        {/* Unified Property Intelligence + Docs — single accordion, two tabs */}
        <AccordionItem value="intelligence-docs" className="rounded-md border bg-card">
          <AccordionTrigger className="px-3 py-2 hover:no-underline">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="size-4 text-primary" />
              Property Intelligence &amp; Docs
              <Badge variant="secondary" className="ml-1">Wired</Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3">
            <Tabs defaultValue="ask" className="w-full">
              <TabsList className="mb-3">
                <TabsTrigger value="ask" className="gap-1.5">
                  <BookOpen className="size-3.5" />
                  AI Chat Assistant
                </TabsTrigger>
                <TabsTrigger value="catalog" className="gap-1.5">
                  <FileText className="size-3.5" />
                  Provider Catalog
                </TabsTrigger>
              </TabsList>

              <TabsContent value="ask" className="mt-0 space-y-2">
                <PropertyIntelligenceSection
                  models={models}
                  savedModelId={savedModelId}
                  onExtractionSuccess={onExtractionSuccess}
                />
              </TabsContent>

              <TabsContent value="catalog" className="mt-0 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Docs (floorplans, datasheets, listings) your provider has
                  already published. Anything you upload via{" "}
                  <strong>Ask AI</strong> is also added here for future tours.
                </p>
                <VaultCatalogList
                  category="property_doc"
                  emptyHint="Your provider hasn't published any property docs yet."
                />
              </TabsContent>
            </Tabs>
          </AccordionContent>
        </AccordionItem>

        {/* Sound Library — wired */}
        <AccordionItem value="sound" className="rounded-md border bg-card">
          <AccordionTrigger className="px-3 py-2 hover:no-underline">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Music className="size-4 text-primary" />
              Sound Library
              <Badge variant="secondary" className="ml-1">Wired</Badge>
              {audioApplied && (
                <Badge variant="outline" className="ml-1 border-emerald-300 text-emerald-700">
                  Applied
                </Badge>
              )}
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3">
            <SoundLibraryPicker
              propertyId={activeId}
              selectedAssetId={activeEnhancements.spatial_audio ?? null}
              fallbackMusicUrl={activeModel.musicUrl ?? ""}
              onSelect={(assetId) => updateActive({ spatial_audio: assetId })}
            />
          </AccordionContent>
        </AccordionItem>


        {/* Coming-soon categories */}
        <AccordionItem value="filters" className="rounded-md border bg-card">
          <AccordionTrigger className="px-3 py-2 hover:no-underline">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Wand2 className="size-4 text-primary" />
              Visual Portal Filters
              <Badge variant="outline" className="ml-1 border-amber-300 text-amber-700">
                Coming soon
              </Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3">
            <VaultCatalogList
              category="visual_hud_filter"
              comingSoon
              emptyHint="Your provider hasn't published any visual filters yet."
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="widgets" className="rounded-md border bg-card">
          <AccordionTrigger className="px-3 py-2 hover:no-underline">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Boxes className="size-4 text-primary" />
              Interactive Widgets
              <Badge variant="outline" className="ml-1 border-amber-300 text-amber-700">
                Coming soon
              </Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3">
            <VaultCatalogList
              category="interactive_widget"
              comingSoon
              emptyHint="Your provider hasn't published any widgets yet."
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="icons" className="rounded-md border bg-card">
          <AccordionTrigger className="px-3 py-2 hover:no-underline">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <MapPin className="size-4 text-primary" />
              Custom Iconography
              <Badge variant="outline" className="ml-1 border-amber-300 text-amber-700">
                Coming soon
              </Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3">
            <VaultCatalogList
              category="custom_iconography"
              comingSoon
              emptyHint="Your provider hasn't published any custom icons yet."
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="links" className="rounded-md border bg-card">
          <AccordionTrigger className="px-3 py-2 hover:no-underline">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <LinkIcon className="size-4 text-primary" />
              External Links
              <Badge variant="outline" className="ml-1 border-amber-300 text-amber-700">
                Coming soon
              </Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3">
            <VaultCatalogList
              category="external_link"
              comingSoon
              emptyHint="Your provider hasn't published any external links yet."
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Marker icon to keep tree-shaker honest */}
      <Layers className="hidden" aria-hidden />
    </div>
  );
}
