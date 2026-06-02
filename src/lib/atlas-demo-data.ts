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
  | "cafe"
  | "restaurant"
  | "hotel"
  | "event_space"
  | "gallery"
  | "wellness"
  | "retail"
  | "other";

export const CATEGORY_LABELS: Record<AtlasCategory, string> = {
  cafe: "Café & Coffee",
  restaurant: "Restaurant & Dining",
  hotel: "Boutique Hotel & Stay",
  event_space: "Event & Private Space",
  gallery: "Gallery & Culture",
  wellness: "Wellness & Studio",
  retail: "Retail Showroom",
  other: "Space",
};

/** Ordered options for the admin category <select>. */
export const CATEGORY_OPTIONS: AtlasCategory[] = [
  "cafe",
  "restaurant",
  "hotel",
  "event_space",
  "gallery",
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
  created_at: string;
  updated_at: string;
}

/** Human label for a category value (known → friendly label, else Title Case). */
export function categoryLabel(category: string): string {
  return (
    CATEGORY_LABELS[category as AtlasCategory] ??
    category.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}
