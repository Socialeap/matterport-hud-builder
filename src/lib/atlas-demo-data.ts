/**
 * Atlas Demo MVP — curated SAMPLE listing data.
 *
 * This is the ONLY source of Atlas listings for the Phase-0 demo. It is static,
 * truthful sample data — clearly labeled "demo" (visibility_tier: 'demo') — used
 * to show how real spaces will appear in the public Atlas discovery layer. None
 * of these represent a specific prospect, and no business-specific preview is
 * claimed.
 *
 * SWAP-LATER CONTRACT
 * -------------------
 * `AtlasEntry` is intentionally shaped like the future `atlas_entries` table
 * proposed in ATLAS_LAYER_PRD_CHECKLIST.md (snake_case columns, same statuses
 * and visibility tiers). When Atlas PR-1 lands the real table + a public
 * "active verified entries" view, the demo array below can be replaced by a
 * Supabase read with the SAME shape, e.g.:
 *
 *     const { data } = await supabase
 *       .from('atlas_public_entries')        // public, RLS-safe view
 *       .select('*')
 *       .eq('listing_status', 'active')
 *
 * The UI consumes `AtlasEntry[]` and should not need to change.
 */

export type AtlasListingStatus =
  | 'draft'
  | 'pending_verification'
  | 'verified'
  | 'active'
  | 'inactive'
  | 'suspended'

export type AtlasVisibilityTier = 'demo' | 'organic' | 'premium_provider' | 'sponsored'

export type AtlasCategory =
  | 'cafe'
  | 'restaurant'
  | 'hotel'
  | 'event_space'
  | 'gallery'
  | 'wellness'
  | 'retail'

/** One public Atlas listing. Mirrors the future `atlas_entries` row shape. */
export interface AtlasEntry {
  id: string
  /** Links back to the discovered Map Oracle property (null for pure samples). */
  property_id: string | null
  /** The saved model / presentation this listing opens (null in the demo). */
  presentation_id: string | null
  provider_id: string | null
  client_id: string | null
  slug: string
  title: string
  category: AtlasCategory
  summary: string
  listing_status: AtlasListingStatus
  visibility_tier: AtlasVisibilityTier
  source: string
  /** Platform-hosted canonical presentation route. Null in the MVP (no live tour). */
  canonical_url: string | null
  external_verified_url: string | null
  latitude: number
  longitude: number
  city: string
  region: string
  country: string
  tags: string[]
  amenities: string[]
  capacity: number | null
  /** A genuine hero photo when one exists; null → the UI renders a styled placeholder. */
  hero_image_url: string | null
  verified_at: string | null
  published_at: string | null
  inactive_at: string | null
  created_at: string
  updated_at: string
}

export const CATEGORY_LABELS: Record<AtlasCategory, string> = {
  cafe: 'Café & Coffee',
  restaurant: 'Restaurant & Dining',
  hotel: 'Boutique Hotel & Stay',
  event_space: 'Event & Private Space',
  gallery: 'Gallery & Culture',
  wellness: 'Wellness & Studio',
  retail: 'Retail Showroom',
}

// Stable demo timestamps (no runtime Date.now so SSR output is deterministic).
const VERIFIED_AT = '2026-05-15T16:00:00.000Z'
const PUBLISHED_AT = '2026-05-16T16:00:00.000Z'
const CREATED_AT = '2026-05-10T16:00:00.000Z'
const UPDATED_AT = '2026-05-20T16:00:00.000Z'

/** Shared demo defaults so each entry below stays focused on what differs. */
function demoEntry(
  e: Pick<
    AtlasEntry,
    | 'id' | 'slug' | 'title' | 'category' | 'summary'
    | 'latitude' | 'longitude' | 'city' | 'region'
    | 'tags' | 'amenities' | 'capacity'
  >,
): AtlasEntry {
  return {
    property_id: null,
    presentation_id: null,
    provider_id: null,
    client_id: null,
    listing_status: 'active',
    visibility_tier: 'demo',
    source: 'demo_sample',
    canonical_url: null,
    external_verified_url: null,
    country: 'US',
    hero_image_url: null,
    verified_at: VERIFIED_AT,
    published_at: PUBLISHED_AT,
    inactive_at: null,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    ...e,
  }
}

/** Curated, clearly-sample Atlas listings (≥3 required; 6 for a credible spread). */
export const DEMO_ATLAS_ENTRIES: AtlasEntry[] = [
  demoEntry({
    id: 'demo-greenhouse-cafe',
    slug: 'greenhouse-cafe',
    title: 'The Greenhouse Café',
    category: 'cafe',
    summary:
      'A plant-filled corner café — see the light, the layout, and the patio before you pick your table.',
    latitude: 30.2672,
    longitude: -97.7431,
    city: 'Austin',
    region: 'TX',
    tags: ['coffee', 'patio', 'brunch', 'wifi'],
    amenities: ['Outdoor patio', 'Free Wi-Fi', 'Wheelchair accessible'],
    capacity: 48,
  }),
  demoEntry({
    id: 'demo-harbor-house-hotel',
    slug: 'harbor-house-hotel',
    title: 'Harbor House Boutique Hotel',
    category: 'hotel',
    summary:
      'Walk the lobby, courtyard, and a sample suite — help guests choose with confidence before they book.',
    latitude: 32.7765,
    longitude: -79.9311,
    city: 'Charleston',
    region: 'SC',
    tags: ['boutique', 'waterfront', 'rooftop'],
    amenities: ['Rooftop bar', 'Courtyard', 'Pet friendly', 'Valet parking'],
    capacity: 32,
  }),
  demoEntry({
    id: 'demo-atrium-events',
    slug: 'atrium-event-space',
    title: 'The Atrium Event Space',
    category: 'event_space',
    summary:
      'Let planners explore the floor plan, staging, and flow for weddings and private events — fewer site-visit questions.',
    latitude: 33.749,
    longitude: -84.388,
    city: 'Atlanta',
    region: 'GA',
    tags: ['weddings', 'corporate', 'private-events'],
    amenities: ['Catering kitchen', 'AV system', 'Bridal suite', 'Step-free access'],
    capacity: 220,
  }),
  demoEntry({
    id: 'demo-lumen-gallery',
    slug: 'lumen-gallery',
    title: 'Lumen Gallery',
    category: 'gallery',
    summary:
      'Move through the current exhibition room by room — bring the experience to people who can’t visit in person.',
    latitude: 41.8781,
    longitude: -87.6298,
    city: 'Chicago',
    region: 'IL',
    tags: ['art', 'exhibition', 'culture'],
    amenities: ['Wheelchair accessible', 'Guided audio', 'Gift shop'],
    capacity: 120,
  }),
  demoEntry({
    id: 'demo-stillwater-wellness',
    slug: 'stillwater-wellness-studio',
    title: 'Stillwater Yoga & Wellness',
    category: 'wellness',
    summary:
      'Show the calm — studios, changing rooms, and amenities — so first-timers feel comfortable before they arrive.',
    latitude: 39.7392,
    longitude: -104.9903,
    city: 'Denver',
    region: 'CO',
    tags: ['yoga', 'spa', 'classes'],
    amenities: ['Showers', 'Lockers', 'Mat rental', 'Tea lounge'],
    capacity: 40,
  }),
  demoEntry({
    id: 'demo-form-field-showroom',
    slug: 'form-and-field-showroom',
    title: 'Form & Field Showroom',
    category: 'retail',
    summary:
      'Browse the showroom floor and featured collections online — turn a walk-through into a shopping experience.',
    latitude: 40.6782,
    longitude: -73.9442,
    city: 'Brooklyn',
    region: 'NY',
    tags: ['furniture', 'design', 'showroom'],
    amenities: ['Design consults', 'Step-free access', 'Delivery'],
    capacity: 60,
  }),
]

/**
 * The demo's listing source. In Atlas PR-1 this becomes an async Supabase read
 * against the public `atlas_entries` view; the return shape (`AtlasEntry[]`)
 * stays the same so the UI is unaffected.
 */
export function getDemoAtlasEntries(): AtlasEntry[] {
  return DEMO_ATLAS_ENTRIES
}
