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
  | "coworking"
  | "event_space";

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
  {
    key: "event_space",
    label: "Event Space",
    tagline: "Wedding/reception hall, party venue",
    icon: Building2,
    starterId: "starter-event-space",
    docKind: "event_space_factsheet",
  },
];

export function getCategory(key: CategoryKey | null): ProfileCategory | null {
  if (!key) return null;
  return PROFILE_CATEGORIES.find((c) => c.key === key) ?? null;
}

/**
 * Resolves a Property Profile to a usable vault_templates row id.
 *
 * Resolution order (queries Postgres directly — never trusts a stale
 * client-side cache, which previously caused phantom "template_not_found"
 * 404s when retrying after a transient failure):
 *
 *   1. SELECT vault_templates WHERE provider_id = ? AND doc_kind = ? AND is_active.
 *   2. Otherwise INSERT a clone of the matching STARTER_TEMPLATES entry,
 *      then immediately re-SELECT by id to confirm the row truly persisted
 *      (catches silent RLS rejections / trigger rollbacks).
 *
 * Returns the template id on success, throws a friendly Error on failure.
 * Note: `availableTemplates` is no longer consulted — kept in the signature
 * only so callers don't have to change. It will be removed in a follow-up.
 */
export async function resolveProfileTemplate(args: {
  providerId: string;
  category: CategoryKey;
  availableTemplates?: VaultTemplate[];
}): Promise<{ templateId: string; cloned: boolean }> {
  const cat = getCategory(args.category);
  if (!cat) throw new Error("Unknown property profile selected.");

  // 1. Authoritative server lookup by (provider, doc_kind).
  const { data: existing, error: lookupErr } = await supabase
    .from("vault_templates")
    .select("id")
    .eq("provider_id", args.providerId)
    .eq("doc_kind", cat.docKind)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lookupErr) {
    console.error("[ai-wizard] template lookup failed:", lookupErr);
    throw new Error(
      `Couldn't load the ${cat.label} profile. Try again, or contact support.`,
    );
  }
  if (existing?.id) return { templateId: existing.id, cloned: false };

  // 2. Clone the starter template into this provider's vault.
  const starter = STARTER_TEMPLATES.find((s) => s.id === cat.starterId);
  if (!starter) {
    throw new Error(`No starter template available for ${cat.label}.`);
  }

  const { data: inserted, error: insertErr } = await supabase
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

  if (insertErr || !inserted?.id) {
    console.error(
      "[ai-wizard] template clone failed for provider",
      args.providerId,
      "category",
      args.category,
      insertErr,
    );
    throw new Error(
      `Couldn't save the ${cat.label} profile. Try again, or contact support.`,
    );
  }

  // 3. Verify the row is actually readable back (catches silent RLS / trigger
  //    rollback that would otherwise cause a downstream 404 in extract-property-doc).
  const { data: verified, error: verifyErr } = await supabase
    .from("vault_templates")
    .select("id, provider_id")
    .eq("id", inserted.id)
    .maybeSingle();
  if (verifyErr || !verified) {
    console.error(
      "[ai-wizard] template clone vanished post-insert id=",
      inserted.id,
      "provider=",
      args.providerId,
      verifyErr,
    );
    throw new Error(
      `Couldn't save the ${cat.label} profile. Try again, or contact support.`,
    );
  }

  return { templateId: inserted.id, cloned: true };
}

/**
 * Additively merge new field definitions into an existing profile template's
 * `field_schema`. Never removes or overwrites existing keys. Used by the wizard
 * after `induce-schema` discovers extra fields in the user's PDF — keeps the
 * merged schema attached to the same template id (no hidden override rows).
 *
 * Returns the count of newly added field keys (0 means no-op).
 */
export async function mergeFieldsIntoTemplate(args: {
  templateId: string;
  inducedProperties: Record<string, { type: string; description?: string }>;
}): Promise<number> {
  const { data: row, error: readErr } = await supabase
    .from("vault_templates")
    .select("field_schema")
    .eq("id", args.templateId)
    .maybeSingle();
  if (readErr || !row) return 0;

  const existing =
    (row.field_schema as { properties?: Record<string, unknown> } | null)
      ?.properties ?? {};
  const additions: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(args.inducedProperties)) {
    if (!(key in existing)) additions[key] = def;
  }
  const addedCount = Object.keys(additions).length;
  if (addedCount === 0) return 0;

  const merged = {
    ...(row.field_schema as Record<string, unknown>),
    type: "object",
    properties: { ...existing, ...additions },
  };

  const { error: updateErr } = await supabase
    .from("vault_templates")
    .update({ field_schema: merged as unknown as never })
    .eq("id", args.templateId);
  if (updateErr) {
    console.warn("[ai-wizard] field merge failed:", updateErr);
    return 0;
  }
  return addedCount;
}

