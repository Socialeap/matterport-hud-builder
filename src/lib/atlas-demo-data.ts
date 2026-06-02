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

export type AtlasEntryKind = "demo" | "client_submitted";
export type AtlasEntryStatus = "pending_review" | "active" | "inactive" | "rejected";

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
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** Back-compat alias — older imports may still reference this name. */
export type AtlasDemoListing = AtlasEntry;

/** Human label for a category value (known → friendly label, else Title Case). */
export function categoryLabel(category: string): string {
  return (
    CATEGORY_LABELS[category as AtlasCategory] ??
    category.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}
