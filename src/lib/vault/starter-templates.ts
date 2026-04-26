/**
 * Static, hand-curated "Pre-Built Templates" library for the Vault Templates
 * wizard. These are exhaustive, save-ready VaultTemplate drafts (minus the
 * persisted fields like id/version) the user can clone with one click and
 * customize later. Pure UI / static data — no backend, no API calls.
 *
 * Each starter is intentionally field-rich (~30–40 fields) so the user gets
 * a finished, comprehensive map immediately. They can always trim what they
 * don't need from the AdvancedSettings raw JSON editor.
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
      "Comprehensive residential listing template covering pricing, dimensions, construction, systems, finishes, financials, and disclosures. Built from MLS, listing-sheet, and seller-disclosure conventions.",
    icon: "Home",
    defaultLabel: "Residential Property Map",
    doc_kind: "residential_listing",
    extractor: "pdfjs_heuristic",
    schema: {
      type: "object",
      properties: {
        // Identity
        property_address: { type: "string", description: "Full street address including city, state, ZIP" },
        mls_number: { type: "string", description: "MLS listing identifier" },
        listing_status: { type: "string", description: "Listing status (Active, Pending, Sold, etc.)" },
        property_type: { type: "string", description: "e.g. Single Family, Condo, Townhouse, Multi-Family" },
        // Pricing
        list_price: { type: "number", description: "Current listing price in USD" },
        price_per_sqft: { type: "number", description: "List price divided by living area, USD per sqft" },
        last_sold_price: { type: "number", description: "Most recent prior sale price in USD" },
        last_sold_date: { type: "date", description: "Most recent prior sale closing date (ISO 8601)" },
        days_on_market: { type: "number", description: "Number of days the listing has been active" },
        // Size & layout
        bedrooms: { type: "number", description: "Total number of bedrooms" },
        full_bathrooms: { type: "number", description: "Number of full bathrooms" },
        half_bathrooms: { type: "number", description: "Number of half bathrooms (powder rooms)" },
        living_area_sqft: { type: "number", description: "Interior living area in square feet" },
        lot_size_sqft: { type: "number", description: "Lot size in square feet" },
        stories: { type: "number", description: "Number of above-grade stories" },
        // Construction
        year_built: { type: "number", description: "Year of original construction" },
        year_renovated: { type: "number", description: "Year of most recent major renovation, if any" },
        foundation_type: { type: "string", description: "Foundation type (slab, crawlspace, basement, pier)" },
        basement_type: { type: "string", description: "Basement type (none, partial, full, walkout)" },
        basement_finished: { type: "boolean", description: "True if basement is finished" },
        roof_type: { type: "string", description: "Roof material (asphalt shingle, metal, tile, slate)" },
        roof_age_years: { type: "number", description: "Approximate age of the current roof in years" },
        exterior_material: { type: "string", description: "Primary exterior material (brick, stucco, vinyl, wood)" },
        // Systems
        heating_system: { type: "string", description: "Heating system type (forced air, radiant, heat pump, etc.)" },
        cooling_system: { type: "string", description: "Cooling system type (central AC, mini-split, none)" },
        water_source: { type: "string", description: "Water source (public, well, shared)" },
        sewer_type: { type: "string", description: "Sewer type (public sewer, septic)" },
        // Features
        garage_spaces: { type: "number", description: "Number of garage parking spaces" },
        parking_type: { type: "string", description: "Parking type (attached garage, detached, carport, street)" },
        pool: { type: "boolean", description: "True if the property has a pool" },
        fireplace_count: { type: "number", description: "Number of fireplaces" },
        view: { type: "string", description: "Notable views (mountain, water, city, none)" },
        waterfront: { type: "boolean", description: "True if the property is waterfront" },
        appliances_included: { type: "string", description: "Comma-separated list of appliances included in sale" },
        recent_updates: { type: "string", description: "Notable recent renovations or updates (free text)" },
        energy_features: { type: "string", description: "Energy efficiency features (solar, double-pane, etc.)" },
        accessibility_features: { type: "string", description: "Accessibility features (no-step entry, wide doorways, etc.)" },
        // Financials
        annual_property_tax: { type: "number", description: "Annual property tax in USD" },
        hoa_monthly_fee: { type: "number", description: "Monthly HOA fee in USD, if any" },
        hoa_includes: { type: "string", description: "What the HOA fee covers" },
        // Location & legal
        school_district: { type: "string", description: "Name of the school district" },
        zoning: { type: "string", description: "Zoning designation" },
        flood_zone: { type: "string", description: "FEMA flood zone designation, if any" },
        // Listing meta
        listing_agent: { type: "string", description: "Listing agent name" },
        listing_brokerage: { type: "string", description: "Listing brokerage name" },
        virtual_tour_url: { type: "string", description: "URL to a virtual tour, if available" },
      },
      required: ["property_address", "list_price", "bedrooms", "full_bathrooms", "living_area_sqft"],
    },
  },
  {
    id: "starter-hospitality",
    name: "Hospitality / Boutique Hotel",
    tagline: "Hotels, B&Bs, vacation rentals, resorts",
    description:
      "Exhaustive hospitality fact-sheet template covering room inventory, F&B, meeting & event space, amenities, rates, occupancy, brand & loyalty, location, and sustainability. Built for OTAs, sales sheets, and management decks.",
    icon: "Hotel",
    defaultLabel: "Hospitality Property Map",
    doc_kind: "hospitality_factsheet",
    extractor: "pdfjs_heuristic",
    schema: {
      type: "object",
      properties: {
        // Identity
        property_name: { type: "string", description: "Hotel or property name" },
        property_address: { type: "string", description: "Full street address including city, country" },
        brand_affiliation: { type: "string", description: "Brand or flag (Marriott, Hilton, IHG, independent, etc.)" },
        star_rating: { type: "number", description: "Star rating (1–5)" },
        year_opened: { type: "number", description: "Year the property opened" },
        year_renovated: { type: "number", description: "Year of most recent major renovation" },
        total_floors: { type: "number", description: "Total number of floors" },
        // Room inventory
        total_rooms: { type: "number", description: "Total number of guest rooms / keys" },
        room_types: { type: "string", description: "Comma-separated room categories (Standard, Deluxe, Suite, etc.)" },
        suite_count: { type: "number", description: "Number of suites" },
        accessible_rooms_count: { type: "number", description: "Number of ADA / accessible rooms" },
        largest_suite_sqft: { type: "number", description: "Square footage of the largest suite" },
        // Times & policy
        check_in_time: { type: "string", description: "Standard check-in time (e.g. 3:00 PM)" },
        check_out_time: { type: "string", description: "Standard check-out time (e.g. 11:00 AM)" },
        pet_policy: { type: "string", description: "Pet policy summary" },
        smoking_policy: { type: "string", description: "Smoking policy summary" },
        // F&B & amenities
        amenities: { type: "string", description: "Comma-separated amenities (pool, spa, gym, business center)" },
        dining_venues: { type: "string", description: "On-site restaurants and bars" },
        room_service_hours: { type: "string", description: "Room service availability hours" },
        breakfast_included: { type: "boolean", description: "True if breakfast is included in the standard rate" },
        wifi_included: { type: "boolean", description: "True if Wi-Fi is included in the standard rate" },
        fitness_center: { type: "boolean", description: "True if there is an on-site fitness center" },
        spa: { type: "boolean", description: "True if there is an on-site spa" },
        pool_count: { type: "number", description: "Number of pools (indoor + outdoor)" },
        beach_access: { type: "boolean", description: "True if the property has direct beach access" },
        kids_club: { type: "boolean", description: "True if there is a kids club / kids program" },
        concierge: { type: "boolean", description: "True if a concierge service is available" },
        // Meetings & events
        total_meeting_sqft: { type: "number", description: "Total meeting and event space in square feet" },
        meeting_rooms: { type: "number", description: "Number of meeting / conference rooms" },
        ballroom_sqft: { type: "number", description: "Largest ballroom square footage" },
        event_capacity: { type: "number", description: "Max guests for the largest event space" },
        // Rates & performance
        currency: { type: "string", description: "Reporting currency (e.g. USD, EUR)" },
        seasonal_rate_low: { type: "number", description: "Lowest nightly rate (off-season)" },
        seasonal_rate_high: { type: "number", description: "Highest nightly rate (peak season)" },
        average_daily_rate: { type: "number", description: "Average daily rate (ADR)" },
        occupancy_rate_pct: { type: "number", description: "Average occupancy rate as a percentage (0–100)" },
        // Loyalty & service
        loyalty_program: { type: "string", description: "Name of the loyalty program, if any" },
        languages_spoken: { type: "string", description: "Comma-separated languages staff speak" },
        // Location
        parking_available: { type: "string", description: "Parking type and fees (valet, self-park, free)" },
        distance_to_airport_km: { type: "number", description: "Driving distance to the nearest major airport in km" },
        nearest_airport_code: { type: "string", description: "IATA code of the nearest major airport" },
        sustainability_certifications: { type: "string", description: "Sustainability certifications (LEED, Green Key, EarthCheck)" },
      },
      required: ["property_name", "total_rooms", "property_address"],
    },
  },
  {
    id: "starter-commercial-office",
    name: "Commercial Office",
    tagline: "Office buildings, business parks, corporate campuses",
    description:
      "Comprehensive commercial-leasing OM template covering building specs, floor plate engineering, lease economics, parking & transit, tenant mix, and certifications. Built for institutional-grade offering memorandums.",
    icon: "Building2",
    defaultLabel: "Commercial Office Map",
    doc_kind: "commercial_office_om",
    extractor: "pdfjs_heuristic",
    schema: {
      type: "object",
      properties: {
        // Identity
        property_name: { type: "string", description: "Building or campus name" },
        property_address: { type: "string", description: "Full street address" },
        submarket: { type: "string", description: "Submarket / district (e.g. Midtown South, SoMa)" },
        building_class: { type: "string", description: "Building class (A, B, C, Trophy)" },
        // Size
        total_rentable_sqft: { type: "number", description: "Total rentable square footage" },
        available_sqft: { type: "number", description: "Currently available square footage" },
        max_contiguous_sqft: { type: "number", description: "Largest contiguous available block in sqft" },
        divisible_to_sqft: { type: "number", description: "Smallest divisible suite size in sqft" },
        number_of_floors: { type: "number", description: "Total floors in the building" },
        typical_floor_plate_sqft: { type: "number", description: "Typical floor plate in square feet" },
        // Engineering
        ceiling_height_ft: { type: "number", description: "Finished ceiling height in feet" },
        slab_to_slab_ft: { type: "number", description: "Slab-to-slab height in feet" },
        column_spacing_ft: { type: "string", description: "Typical column spacing (e.g. 30x30)" },
        floor_load_psf: { type: "number", description: "Live floor load capacity in pounds per square foot" },
        elevators_passenger: { type: "number", description: "Number of passenger elevators" },
        elevators_freight: { type: "number", description: "Number of freight elevators" },
        hvac_type: { type: "string", description: "HVAC system type (VAV, fan-coil, central plant)" },
        hvac_after_hours_cost: { type: "number", description: "After-hours HVAC cost (USD per hour)" },
        power_density_watts_psf: { type: "number", description: "Electrical capacity in watts per square foot" },
        fiber_providers: { type: "string", description: "Comma-separated fiber / telecom carriers in the building" },
        // Construction
        year_built: { type: "number", description: "Year of original construction" },
        year_renovated: { type: "number", description: "Year of most recent major renovation" },
        lobby_renovated: { type: "boolean", description: "True if the lobby was renovated within the last 5 years" },
        // Lease economics
        asking_rent_psf: { type: "number", description: "Asking rent per square foot per year (USD)" },
        nnn_charges_psf: { type: "number", description: "NNN / operating expenses per square foot per year (USD)" },
        base_year: { type: "number", description: "Base year for operating expense pass-throughs" },
        expense_stop_psf: { type: "number", description: "Expense stop in USD per sqft, if applicable" },
        lease_type: { type: "string", description: "Lease type (Full Service, Modified Gross, NNN)" },
        vacancy_rate_pct: { type: "number", description: "Current building vacancy as a percentage (0–100)" },
        // Parking & transit
        parking_ratio: { type: "string", description: "Parking ratio (e.g. 3.5/1000 SF)" },
        parking_total_spaces: { type: "number", description: "Total parking spaces" },
        parking_monthly_rate: { type: "number", description: "Monthly parking rate per space in USD" },
        bike_storage: { type: "boolean", description: "True if secure bike storage is provided" },
        ev_charging_stations: { type: "number", description: "Number of EV charging stations" },
        walk_score: { type: "number", description: "Walk Score (0–100)" },
        transit_score: { type: "number", description: "Transit Score (0–100)" },
        // Tenancy & certs
        major_tenants: { type: "string", description: "Comma-separated list of anchor tenants" },
        leed_certification: { type: "string", description: "LEED certification level, if any" },
        wired_certification: { type: "string", description: "WiredScore certification level, if any" },
        security_features: { type: "string", description: "Security features (24/7 staff, key card, turnstiles)" },
      },
      required: ["property_name", "total_rentable_sqft", "asking_rent_psf"],
    },
  },
  {
    id: "starter-multifamily",
    name: "Multi-Family Housing",
    tagline: "Apartment complexes, garden-style, mid-rise",
    description:
      "Institutional multi-family OM template covering unit mix by bedroom count, rents, occupancy, financials, amenities, and acquisition metrics (cap rate, price per unit). Built for rent-roll + T-12 backed offerings.",
    icon: "Building",
    defaultLabel: "Multi-Family Property Map",
    doc_kind: "multifamily_om",
    extractor: "pdfjs_heuristic",
    schema: {
      type: "object",
      properties: {
        // Identity
        property_name: { type: "string", description: "Community or complex name" },
        property_address: { type: "string", description: "Full street address" },
        // Inventory
        total_units: { type: "number", description: "Total number of rentable units" },
        unit_mix: { type: "string", description: "Unit mix summary (e.g. '40 studios, 80 1BR, 60 2BR')" },
        studio_count: { type: "number", description: "Number of studio units" },
        one_br_count: { type: "number", description: "Number of 1-bedroom units" },
        two_br_count: { type: "number", description: "Number of 2-bedroom units" },
        three_br_count: { type: "number", description: "Number of 3-bedroom units" },
        four_br_plus_count: { type: "number", description: "Number of 4+ bedroom units" },
        average_unit_sqft: { type: "number", description: "Average unit size in square feet" },
        average_studio_sqft: { type: "number", description: "Average studio square footage" },
        // Rents
        average_monthly_rent: { type: "number", description: "Average monthly rent across all units in USD" },
        average_1br_rent: { type: "number", description: "Average monthly rent for 1BR units in USD" },
        average_2br_rent: { type: "number", description: "Average monthly rent for 2BR units in USD" },
        average_3br_rent: { type: "number", description: "Average monthly rent for 3BR units in USD" },
        rent_per_sqft: { type: "number", description: "Average rent per square foot in USD" },
        average_lease_term_months: { type: "number", description: "Average lease term in months" },
        concessions_offered: { type: "string", description: "Current rental concessions (e.g. '1 month free on 13-mo lease')" },
        utilities_included: { type: "string", description: "Utilities included in rent (water, trash, gas, electric, none)" },
        // Occupancy
        current_occupancy_pct: { type: "number", description: "Current physical occupancy percentage (0–100)" },
        leased_occupancy_pct: { type: "number", description: "Leased occupancy percentage (0–100)" },
        economic_occupancy_pct: { type: "number", description: "Economic occupancy percentage (0–100)" },
        vacancy_loss_pct: { type: "number", description: "Vacancy loss percentage (0–100)" },
        // Construction
        year_built: { type: "number", description: "Year of original construction" },
        year_renovated: { type: "number", description: "Year of most recent major renovation" },
        year_last_rehab: { type: "number", description: "Year of most recent unit-level rehab program" },
        number_of_buildings: { type: "number", description: "Number of buildings in the community" },
        number_of_stories: { type: "number", description: "Typical number of stories per building" },
        total_acreage: { type: "number", description: "Total site acreage" },
        density_units_per_acre: { type: "number", description: "Units per acre density" },
        // Parking & amenities
        parking_spaces: { type: "number", description: "Total parking spaces (covered + surface)" },
        parking_ratio: { type: "string", description: "Parking ratio (e.g. 1.5 per unit)" },
        garages_count: { type: "number", description: "Number of detached garages" },
        community_amenities: { type: "string", description: "Comma-separated community amenities" },
        in_unit_amenities: { type: "string", description: "Comma-separated in-unit amenities" },
        washer_dryer_in_unit: { type: "boolean", description: "True if washer/dryer is in-unit standard" },
        pet_friendly: { type: "boolean", description: "True if pets are allowed" },
        pet_fees: { type: "string", description: "Pet fees and deposits summary" },
        // Financials & deal metrics
        gross_potential_rent: { type: "number", description: "Annual gross potential rent in USD" },
        net_operating_income: { type: "number", description: "Annual net operating income in USD" },
        operating_expenses_annual: { type: "number", description: "Annual operating expenses in USD" },
        expense_ratio_pct: { type: "number", description: "Operating expense ratio as a percentage (0–100)" },
        cap_rate_pct: { type: "number", description: "Capitalization rate as a percentage (0–100)" },
        price_per_unit: { type: "number", description: "Asking or sale price per unit in USD" },
        year_acquired: { type: "number", description: "Year the current owner acquired the asset" },
      },
      required: ["property_name", "total_units", "average_monthly_rent"],
    },
  },
  {
    id: "starter-coworking",
    name: "Coworking / Flex Workspace",
    tagline: "Coworking spaces, executive suites, flex offices",
    description:
      "Comprehensive coworking template covering capacity, membership tiers and pricing, meeting rooms, amenities, hours & access, perks, and accessibility. Built for marketing decks, membership menus, and broker tour books.",
    icon: "Users",
    defaultLabel: "Coworking Space Map",
    doc_kind: "coworking_brochure",
    extractor: "pdfjs_heuristic",
    schema: {
      type: "object",
      properties: {
        // Identity
        location_name: { type: "string", description: "Location or branch name" },
        property_address: { type: "string", description: "Full street address" },
        brand_operator: { type: "string", description: "Brand or operator (WeWork, Industrious, independent, etc.)" },
        total_floors: { type: "number", description: "Total floors occupied by the location" },
        total_sqft: { type: "number", description: "Total square footage of the space" },
        // Capacity
        total_capacity: { type: "number", description: "Total member capacity" },
        total_workstations: { type: "number", description: "Total individual workstations across all tiers" },
        total_private_offices: { type: "number", description: "Number of private office suites" },
        largest_private_office_capacity: { type: "number", description: "Capacity of the largest private office" },
        // Pricing
        day_pass_price: { type: "number", description: "Single-day drop-in pass price in USD" },
        hot_desk_price_monthly: { type: "number", description: "Monthly hot desk membership in USD" },
        dedicated_desk_price_monthly: { type: "number", description: "Monthly dedicated desk price in USD" },
        private_office_price_starting: { type: "number", description: "Starting monthly price for a private office in USD" },
        virtual_office_price_monthly: { type: "number", description: "Monthly virtual office / mailing address price in USD" },
        enterprise_plans_available: { type: "boolean", description: "True if enterprise / team-of-50+ plans are offered" },
        // Meeting & specialty rooms
        number_of_meeting_rooms: { type: "number", description: "Number of bookable meeting rooms" },
        meeting_room_credits_included: { type: "number", description: "Meeting room credits included with standard membership per month" },
        meeting_room_hourly_rate: { type: "number", description: "Standard hourly rate for non-credit meeting room bookings in USD" },
        number_of_phone_booths: { type: "number", description: "Number of phone / focus booths" },
        event_space_capacity: { type: "number", description: "Max capacity for the largest event space" },
        podcast_studio: { type: "boolean", description: "True if a podcast / recording studio is available" },
        photo_studio: { type: "boolean", description: "True if a photo studio is available" },
        kitchen_count: { type: "number", description: "Number of member kitchens / pantries" },
        // Amenities & perks
        included_amenities: { type: "string", description: "Comma-separated included amenities (wifi, coffee, printing)" },
        printing_credits_included: { type: "number", description: "Print credits included per month" },
        mailing_address_service: { type: "boolean", description: "True if a business mailing address service is offered" },
        wellness_amenities: { type: "string", description: "Wellness amenities (showers, gym, mothers' room, meditation room)" },
        gym_access: { type: "boolean", description: "True if on-site or partner gym access is included" },
        bike_storage: { type: "boolean", description: "True if secure bike storage is available" },
        parking_available: { type: "string", description: "Parking availability and rates (free, paid, none)" },
        childcare: { type: "boolean", description: "True if on-site childcare is available" },
        pet_friendly: { type: "boolean", description: "True if dogs / pets are allowed" },
        // Hours & access
        operating_hours: { type: "string", description: "Standard staffed operating hours" },
        hours_24_7: { type: "boolean", description: "True if members have 24/7 access" },
        weekend_access: { type: "boolean", description: "True if weekend access is included with standard membership" },
        member_app: { type: "boolean", description: "True if there is a member app for bookings & community" },
        // Community & location
        community_perks: { type: "string", description: "Member community perks and partner discounts" },
        languages_supported: { type: "string", description: "Comma-separated languages spoken by staff" },
        transit_distance_min: { type: "number", description: "Walking minutes to the nearest major transit station" },
        neighborhood_perks: { type: "string", description: "Notable nearby restaurants, gyms, hotels, attractions" },
        sustainability_features: { type: "string", description: "Sustainability features (LEED, recycled materials, etc.)" },
        accessibility_features: { type: "string", description: "Accessibility features (step-free entry, ADA restrooms, etc.)" },
      },
      required: ["location_name", "total_capacity", "hot_desk_price_monthly"],
    },
  },
];
