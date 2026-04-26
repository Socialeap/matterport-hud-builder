/**
 * Static, hand-curated "Industry Standards" library for the Vault Templates
 * wizard. These are seeds the user can clone as a starting point, then
 * customize. Pure UI / static data — no backend, no API calls.
 *
 * Each starter is a complete, save-ready VaultTemplate draft (minus the
 * persisted fields like id/version). The "Use Proven Template" wizard path
 * lets the user pick one, optionally rename, and save it as their own.
 */

import type { ExtractorId, JsonSchema } from "@/lib/extraction/provider";

export interface StarterTemplate {
  /** Stable id for selection state — not persisted to the DB. */
  id: string;
  /** Card title shown in the picker. */
  name: string;
  /** Short marketing tagline. */
  tagline: string;
  /** Long-form description for the picker detail panel. */
  description: string;
  /** Lucide icon name (resolved by the picker) — kept as a string to avoid
   *  bundling the entire icon set into this data file. */
  icon:
    | "Building2"
    | "Hotel"
    | "Building"
    | "Home"
    | "Users"
    | "Briefcase";
  /** Pre-filled label for the new template (the user can edit). */
  defaultLabel: string;
  /** doc_kind written to the saved template. */
  doc_kind: string;
  /** Default extractor — `pdfjs_heuristic` for all current starters. */
  extractor: ExtractorId;
  /** Full JSON Schema of fields the AI will pull from uploaded docs. */
  schema: JsonSchema;
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "starter-residential",
    name: "Residential Real Estate",
    tagline: "Single-family homes, condos, townhouses",
    description:
      "Built for residential listings and disclosures. Captures address, beds/baths, square footage, lot size, year built, HOA fees, taxes, recent updates, and school district.",
    icon: "Home",
    defaultLabel: "Residential Property Map",
    doc_kind: "residential_listing",
    extractor: "pdfjs_heuristic",
    schema: {
      type: "object",
      properties: {
        property_address: { type: "string", description: "Full street address" },
        list_price: { type: "number", description: "Listing price in USD" },
        bedrooms: { type: "number", description: "Number of bedrooms" },
        bathrooms: { type: "number", description: "Number of bathrooms (full + half/2)" },
        living_area_sqft: { type: "number", description: "Interior living area in square feet" },
        lot_size_sqft: { type: "number", description: "Lot size in square feet" },
        year_built: { type: "number", description: "Year of original construction" },
        property_type: { type: "string", description: "e.g. Single Family, Condo, Townhouse" },
        garage_spaces: { type: "number", description: "Number of garage parking spaces" },
        hoa_monthly_fee: { type: "number", description: "Monthly HOA fee in USD, if any" },
        annual_property_tax: { type: "number", description: "Annual property tax in USD" },
        school_district: { type: "string", description: "Name of the school district" },
        recent_updates: { type: "string", description: "Notable recent renovations or updates" },
        mls_number: { type: "string", description: "MLS listing identifier" },
      },
      required: ["property_address", "list_price", "bedrooms", "bathrooms"],
    },
  },
  {
    id: "starter-hospitality",
    name: "Hospitality / Boutique Hotel",
    tagline: "Hotels, B&Bs, vacation rentals, resorts",
    description:
      "Tuned for hospitality fact sheets and brochures. Captures room counts, room types, amenities, dining, F&B venues, event capacity, star rating, check-in policy, and seasonal rates.",
    icon: "Hotel",
    defaultLabel: "Hospitality Property Map",
    doc_kind: "hospitality_factsheet",
    extractor: "pdfjs_heuristic",
    schema: {
      type: "object",
      properties: {
        property_name: { type: "string", description: "Hotel or property name" },
        property_address: { type: "string", description: "Full street address" },
        total_rooms: { type: "number", description: "Total number of guest rooms" },
        room_types: { type: "string", description: "Comma-separated list of room categories (e.g. Standard, Suite, Penthouse)" },
        star_rating: { type: "number", description: "Star rating (1–5)" },
        check_in_time: { type: "string", description: "Standard check-in time (e.g. 3:00 PM)" },
        check_out_time: { type: "string", description: "Standard check-out time (e.g. 11:00 AM)" },
        amenities: { type: "string", description: "Comma-separated amenities (pool, spa, gym, business center)" },
        dining_venues: { type: "string", description: "On-site restaurants and bars" },
        event_capacity: { type: "number", description: "Max guests for largest event space" },
        meeting_rooms: { type: "number", description: "Number of meeting / conference rooms" },
        parking_available: { type: "string", description: "Parking type and fees (valet, self-park, free)" },
        pet_policy: { type: "string", description: "Pet policy summary" },
        seasonal_rate_low: { type: "number", description: "Lowest nightly rate (off-season) in USD" },
        seasonal_rate_high: { type: "number", description: "Highest nightly rate (peak season) in USD" },
      },
      required: ["property_name", "total_rooms"],
    },
  },
  {
    id: "starter-commercial-office",
    name: "Commercial Office",
    tagline: "Office buildings, business parks, corporate campuses",
    description:
      "Built for commercial leasing brochures and OMs. Captures building class, total RSF, available SF, floor plate, asking rent, NNN charges, parking ratio, walk score, and major tenants.",
    icon: "Building2",
    defaultLabel: "Commercial Office Map",
    doc_kind: "commercial_office_om",
    extractor: "pdfjs_heuristic",
    schema: {
      type: "object",
      properties: {
        property_name: { type: "string", description: "Building or campus name" },
        property_address: { type: "string", description: "Full street address" },
        building_class: { type: "string", description: "Building class (A, B, C, Trophy)" },
        total_rentable_sqft: { type: "number", description: "Total rentable square footage" },
        available_sqft: { type: "number", description: "Currently available square footage" },
        number_of_floors: { type: "number", description: "Total floors in the building" },
        typical_floor_plate_sqft: { type: "number", description: "Typical floor plate in square feet" },
        year_built: { type: "number", description: "Year of original construction" },
        year_renovated: { type: "number", description: "Year of most recent major renovation" },
        asking_rent_psf: { type: "number", description: "Asking rent per square foot per year (USD)" },
        nnn_charges_psf: { type: "number", description: "NNN / operating expenses per square foot per year (USD)" },
        parking_ratio: { type: "string", description: "Parking ratio (e.g. 3.5/1000 SF)" },
        walk_score: { type: "number", description: "Walk Score (0–100) if available" },
        major_tenants: { type: "string", description: "Comma-separated list of anchor tenants" },
        leed_certification: { type: "string", description: "LEED certification level, if any" },
      },
      required: ["property_name", "total_rentable_sqft"],
    },
  },
  {
    id: "starter-multifamily",
    name: "Multi-Family Housing",
    tagline: "Apartment complexes, garden-style, mid-rise",
    description:
      "Built for multi-family OMs and rent rolls. Captures total units, unit mix, average rent, occupancy, year built, amenities, parking, and operating financials.",
    icon: "Building",
    defaultLabel: "Multi-Family Property Map",
    doc_kind: "multifamily_om",
    extractor: "pdfjs_heuristic",
    schema: {
      type: "object",
      properties: {
        property_name: { type: "string", description: "Community or complex name" },
        property_address: { type: "string", description: "Full street address" },
        total_units: { type: "number", description: "Total number of rentable units" },
        unit_mix: { type: "string", description: "Unit mix (e.g. '40 studios, 80 1BR, 60 2BR')" },
        average_unit_sqft: { type: "number", description: "Average unit size in square feet" },
        average_monthly_rent: { type: "number", description: "Average monthly rent in USD" },
        current_occupancy_pct: { type: "number", description: "Current physical occupancy percentage (0–100)" },
        year_built: { type: "number", description: "Year of original construction" },
        year_renovated: { type: "number", description: "Year of most recent major renovation" },
        number_of_buildings: { type: "number", description: "Number of buildings in the community" },
        number_of_stories: { type: "number", description: "Typical number of stories per building" },
        parking_spaces: { type: "number", description: "Total parking spaces (covered + surface)" },
        community_amenities: { type: "string", description: "Comma-separated community amenities" },
        in_unit_amenities: { type: "string", description: "Comma-separated in-unit amenities" },
        gross_potential_rent: { type: "number", description: "Annual gross potential rent (USD)" },
        net_operating_income: { type: "number", description: "Annual net operating income (USD)" },
      },
      required: ["property_name", "total_units"],
    },
  },
  {
    id: "starter-coworking",
    name: "Coworking / Flex Workspace",
    tagline: "Coworking spaces, executive suites, flex offices",
    description:
      "Tuned for coworking marketing decks and membership menus. Captures location, capacity, membership tiers and pricing, amenities, meeting rooms, dedicated desks, and event spaces.",
    icon: "Users",
    defaultLabel: "Coworking Space Map",
    doc_kind: "coworking_brochure",
    extractor: "pdfjs_heuristic",
    schema: {
      type: "object",
      properties: {
        location_name: { type: "string", description: "Location or branch name" },
        property_address: { type: "string", description: "Full street address" },
        total_capacity: { type: "number", description: "Total member capacity" },
        total_sqft: { type: "number", description: "Total square footage of the space" },
        hot_desk_price_monthly: { type: "number", description: "Monthly hot desk membership in USD" },
        dedicated_desk_price_monthly: { type: "number", description: "Monthly dedicated desk price in USD" },
        private_office_price_starting: { type: "number", description: "Starting monthly price for a private office in USD" },
        number_of_meeting_rooms: { type: "number", description: "Number of bookable meeting rooms" },
        number_of_phone_booths: { type: "number", description: "Number of phone / focus booths" },
        event_space_capacity: { type: "number", description: "Max capacity for the largest event space" },
        operating_hours: { type: "string", description: "Standard operating hours (e.g. '24/7 for members')" },
        included_amenities: { type: "string", description: "Comma-separated included amenities (wifi, coffee, printing)" },
        wellness_amenities: { type: "string", description: "Wellness amenities (showers, bike storage, gym, mothers room)" },
        community_perks: { type: "string", description: "Member community perks and events" },
      },
      required: ["location_name", "total_capacity"],
    },
  },
];
