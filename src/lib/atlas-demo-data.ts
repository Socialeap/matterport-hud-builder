/**
 * Atlas Demo MVP — shared types + display labels.
 *
 * Listings are NO LONGER hard-coded here. They live in the admin-managed
 * `atlas_demo_listings` table (see the migration) and are read at runtime:
 *   - public route  → src/lib/atlas-demo.functions.ts (active rows only)
 *   - admin CRUD    → src/routes/_authenticated.admin.atlas-demo.tsx
 *
 * `AtlasDemoListing` mirrors the `atlas_demo_listings` row shape, with column
 * names kept close to the future `atlas_entries` table (PRD) so it can migrate
 * cleanly later. `category` is free text in the DB; the known values below drive
 * the public icon/label mapping, with a safe fallback for anything else.
 */

export type AtlasCategory =
  | 'cafe'
  | 'restaurant'
  | 'hotel'
  | 'event_space'
  | 'gallery'
  | 'wellness'
  | 'retail'
  | 'other'

export const CATEGORY_LABELS: Record<AtlasCategory, string> = {
  cafe: 'Café & Coffee',
  restaurant: 'Restaurant & Dining',
  hotel: 'Boutique Hotel & Stay',
  event_space: 'Event & Private Space',
  gallery: 'Gallery & Culture',
  wellness: 'Wellness & Studio',
  retail: 'Retail Showroom',
  other: 'Space',
}

/** Ordered options for the admin category <select>. */
export const CATEGORY_OPTIONS: AtlasCategory[] = [
  'cafe', 'restaurant', 'hotel', 'event_space', 'gallery', 'wellness', 'retail', 'other',
]

/** A row of `atlas_demo_listings`. Shape kept close to future `atlas_entries`. */
export interface AtlasDemoListing {
  id: string
  title: string
  address: string | null
  city: string | null
  region: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
  category: string
  summary: string | null
  /** Hosted 3D presentation URL the listing opens (≈ atlas_entries.canonical_url). */
  presentation_url: string | null
  hero_image_url: string | null
  tags: string[] | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

/** Human label for a category value (known → friendly label, else Title Case). */
export function categoryLabel(category: string): string {
  return (
    CATEGORY_LABELS[category as AtlasCategory] ??
    category.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  )
}
