/**
 * Maps user-facing "Property Profile" cards to the underlying
 * `vault_templates` row. If the provider has a curated template whose
 * `doc_kind` matches the category's `docKind`, that wins. Otherwise the
 * matching `STARTER_TEMPLATES` entry is cloned into the provider's vault
 * (silently, on first use) and the new id is returned.
 *
 * This keeps the user's mental model simple ("I picked Co-working") while
 * preserving the existing vault_templates / extract-property-doc contract.
 */

import {
  Briefcase,
  Building,
  Building2,
  Home,
  Hotel,
  Users,
  type LucideIcon,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { STARTER_TEMPLATES } from "@/lib/vault/starter-templates";
import type { VaultTemplate } from "@/lib/extraction/provider";

export type CategoryKey =
  | "residential"
  | "hospitality"
  | "commercial_office"
  | "multifamily"
  | "coworking";

export interface ProfileCategory {
  key: CategoryKey;
  label: string;
  tagline: string;
  icon: LucideIcon;
  /** Matches StarterTemplate.doc_kind for resolution + cloning. */
  starterId: string;
  docKind: string;
}

/**
 * Display order: most-used first. Icons mirror the starter library so the
 * visual language stays consistent across the wizard and the templates
 * editor.
 */
export const PROFILE_CATEGORIES: ProfileCategory[] = [
  {
    key: "residential",
    label: "Residential",
    tagline: "Single-family, condo, townhouse",
    icon: Home,
    starterId: "starter-residential",
    docKind: "residential_listing",
  },
  {
    key: "hospitality",
    label: "Hospitality",
    tagline: "Hotel, B&B, vacation rental, resort",
    icon: Hotel,
    starterId: "starter-hospitality",
    docKind: "hospitality_factsheet",
  },
  {
    key: "commercial_office",
    label: "Commercial Office",
    tagline: "Office building, business park",
    icon: Building2,
    starterId: "starter-commercial-office",
    docKind: "commercial_office_om",
  },
  {
    key: "multifamily",
    label: "Multi-Family",
    tagline: "Apartment community, mid-rise",
    icon: Building,
    starterId: "starter-multifamily",
    docKind: "multifamily_om",
  },
  {
    key: "coworking",
    label: "Coworking / Flex",
    tagline: "Coworking, executive suites, flex offices",
    icon: Users,
    starterId: "starter-coworking",
    docKind: "coworking_brochure",
  },
];

export function getCategory(key: CategoryKey | null): ProfileCategory | null {
  if (!key) return null;
  return PROFILE_CATEGORIES.find((c) => c.key === key) ?? null;
}

/**
 * Resolves a Property Profile to a usable vault_templates row id.
 *
 * Resolution order:
 *   1. Provider already has an `is_active=true` vault_template whose
 *      `doc_kind` matches the category — reuse it.
 *   2. Otherwise clone the matching STARTER_TEMPLATES entry into the
 *      provider's vault (label prefixed with "AI Profile: …" so it shows
 *      up in /dashboard/vault/templates).
 *
 * Returns the template id on success, throws a friendly Error on failure.
 */
export async function resolveProfileTemplate(args: {
  providerId: string;
  category: CategoryKey;
  availableTemplates: VaultTemplate[];
}): Promise<{ templateId: string; cloned: boolean }> {
  const cat = getCategory(args.category);
  if (!cat) throw new Error("Unknown property profile selected.");

  // 1. Reuse an existing template by doc_kind match.
  const existing = args.availableTemplates.find(
    (t) => t.is_active && t.doc_kind === cat.docKind,
  );
  if (existing) return { templateId: existing.id, cloned: false };

  // 2. Clone the starter template into this provider's vault.
  const starter = STARTER_TEMPLATES.find((s) => s.id === cat.starterId);
  if (!starter) {
    throw new Error(`No starter template available for ${cat.label}.`);
  }

  const { data, error } = await supabase
    .from("vault_templates")
    .insert({
      provider_id: args.providerId,
      label: `AI Profile: ${cat.label}`,
      doc_kind: starter.doc_kind,
      field_schema: starter.schema as unknown as never,
      extractor: starter.extractor,
      is_active: true,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Couldn't set up the ${cat.label} profile. Try again, or contact support.`,
    );
  }

  return { templateId: data.id, cloned: true };
}
