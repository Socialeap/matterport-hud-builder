/**
 * Atlas v1 — shared types + display labels.
 *
 * Listings now live in the admin-managed `atlas_entries` table and are read at
 * runtime via `src/lib/atlas.functions.ts`. This module keeps category labels
 * and the row-shape types used by both the public route and the admin UI.
 *
 * Categories use `text + CHECK` in the database so they can evolve cheaply —
 * unknown values still render via the Title-Case fallback in `categoryLabel`.
 */

export type AtlasCategory =
  | "residential"
  | "commercial"
  | "hospitality"
  | "hotel"
  | "cultural"
  | "gallery"
  | "restaurant"
  | "event_space"
  | "wellness"
  | "retail"
  | "other";

export const CATEGORY_LABELS: Record<AtlasCategory, string> = {
  residential: "Residential",
  commercial: "Commercial & Office",
  hospitality: "Hospitality",
  hotel: "Boutique Hotel & Stay",
  cultural: "Cultural & Museum",
  gallery: "Gallery & Art",
  restaurant: "Restaurant & Dining",
  event_space: "Event & Private Space",
  wellness: "Wellness & Spa",
  retail: "Retail Showroom",
  other: "Space",
};

/** Ordered options for the admin category <select>. Mirrors CATEGORY_IMAGES
 *  in src/routes/atlas.tsx so every selectable category has a fallback hero. */
export const CATEGORY_OPTIONS: AtlasCategory[] = [
  "residential",
  "commercial",
  "hospitality",
  "hotel",
  "cultural",
  "gallery",
  "restaurant",
  "event_space",
  "wellness",
  "retail",
  "other",
];

export type AtlasEntryKind = "demo" | "client_submitted" | "curated_showcase";
export type AtlasEntryStatus = "pending_review" | "active" | "inactive" | "rejected";
/** Claim state for curated listings ("unclaimed" until a business claims it). */
export type AtlasRelationshipStatus =
  | "unclaimed"
  | "claim_requested"
  | "claimed"
  | "removed";

/** Terminal outcome of verification-first Atlas submission (client + server). */
export type AtlasVerifyState =
  | "verified"
  | "unverified"
  | "missing_manifest"
  | "token_mismatch"
  | "fetch_failed";

/** A row of `atlas_entries`. */
export interface AtlasEntry {
  id: string;
  kind: AtlasEntryKind;
  status: AtlasEntryStatus;
  is_active: boolean;
  title: string;
  summary: string | null;
  hero_image_url: string | null;
  category: string;
  tags: string[];
  sort_order: number;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  presentation_url: string | null;
  saved_model_id: string | null;
  owner_user_id: string | null;
  /** Optional: only present once the curated-listing migration is applied. */
  relationship_status?: AtlasRelationshipStatus | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** Back-compat alias — older imports may still reference this name. */
export type AtlasDemoListing = AtlasEntry;

// ── Atlas map-appearance tags ────────────────────────────────────────────────

/**
 * Curated tag vocabulary shown on Atlas map cards (hover tooltip + expanded
 * card). Shared by the publisher UI (pill picker in Publish & Distribute) and
 * the /atlas map renderer so both sides agree on the exact strings.
 */
export const PREDEFINED_TAGS = [
  "$",
  "$$",
  "$$$",
  "WiFi",
  "Parking",
  "Pet Friendly",
  "Wheelchair Accessible",
  "Outdoor Seating",
  "Capacity: 50+",
  "Capacity: 100+",
  "Family Friendly",
  "Open Late",
] as const;

export type PredefinedTag = (typeof PREDEFINED_TAGS)[number];

/** Max tags a publisher can attach to a listing — keeps map cards legible. */
export const MAX_MAP_TAGS = 4;

// ── Curated Atlas Listing Assistant ──────────────────────────────────────────

export type AtlasCurationStatus =
  | "draft"
  | "needs_selection"
  | "ready_for_review"
  | "blocked"
  | "atlas_entry_created"
  | "rejected";

/** How coordinates were resolved for a curation job. */
export type GeocodeConfidence = "google_places" | "city_level" | "manual";

/** A candidate place returned by Google Places text search (multi-match). */
export interface AtlasPlaceCandidate {
  place_id: string;
  name: string;
  formatted_address: string;
  latitude: number | null;
  longitude: number | null;
  types: string[];
}

/** The editable Atlas-entry draft assembled by the curation job. */
export interface AtlasCurationDraft {
  title: string;
  category: string;
  summary: string;
  tags: string[];
  address: string;
  city: string;
  region: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  hero_image_url: string;
}

/** A row of `atlas_curation_jobs`. */
export interface AtlasCurationJob {
  id: string;
  created_by: string;
  status: AtlasCurationStatus;
  needs_human_review: boolean;
  input_matterport_url: string | null;
  extracted_matterport_id: string | null;
  input_name: string | null;
  input_address: string | null;
  input_category: string | null;
  rights_note: string | null;
  google_place_id: string | null;
  formatted_address: string | null;
  latitude: number | null;
  longitude: number | null;
  geocode_confidence: GeocodeConfidence | null;
  place_candidates: AtlasPlaceCandidate[];
  website_url: string | null;
  phone: string | null;
  drafted_title: string | null;
  drafted_summary: string | null;
  drafted_category: string | null;
  drafted_tags: string[];
  draft_payload: AtlasCurationDraft | null;
  atlas_entry_id: string | null;
  error_message: string | null;
  // Package build state (present once the build migration is applied).
  build_status?: AtlasBuildStatus;
  built_at?: string | null;
  package_filename?: string | null;
  package_size_bytes?: number | null;
  build_error?: string | null;
  // Showcase publishing state (present once the publish migration is applied).
  showcase_slug?: string | null;
  publish_status?: AtlasPublishStatus;
  showcase_pr_url?: string | null;
  deployed_url?: string | null;
  published_at?: string | null;
  publish_error?: string | null;
  // Programmatic merge & deploy ("Approve & Publish"; merge migration applied).
  showcase_pr_number?: number | null;
  showcase_branch?: string | null;
  merged_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type AtlasBuildStatus = "none" | "building" | "built" | "failed";
export type AtlasPublishStatus =
  | "none"
  | "pr_open"
  | "merged"
  | "pending_deploy"
  | "published"
  | "failed";

/** Human label for a category value (known → friendly label, else Title Case). */
export function categoryLabel(category: string): string {
  return (
    CATEGORY_LABELS[category as AtlasCategory] ??
    category.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}
