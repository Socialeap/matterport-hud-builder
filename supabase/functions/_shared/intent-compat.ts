// Mirror of the field-compatibility matrix that lives in
// `src/lib/portal/ask-intents.mjs` (FIELD_COMPAT). Used by
// `synthesize-answer/index.ts` so the edge-side `pickTrustedChunks`
// can apply the same allow/exclude gates the client uses to filter
// canonical and curated hits — without pulling the .mjs runtime
// source into Deno (where its IIFE constraints make import painful).
//
// The two tables MUST stay in lockstep; `tests/intent-compat-parity.test.mjs`
// fails the build if any pattern drifts. The duplication is deliberate:
// the .mjs module is hot-inlined into the visitor HTML and cannot have
// imports, while this TS file has full Deno-native imports.

interface IntentRule {
  allow: RegExp[];
  exclude: RegExp[];
}

export const FIELD_COMPAT: Record<string, IntentRule> = {
  booking: {
    allow: [
      /^(booking|reservation|reserve|book_now)(_url|_link)?$/,
      /^book_now$/,
    ],
    exclude: [
      /^agent.*/, /^broker.*/, /^listing.*/,
      /^address$/, /^.*location$/,
      /^number_of_.*/, /^.*_count$/,
      /^price.*/, /^.*_price$/,
    ],
  },
  contact_agent: {
    allow: [
      /^agent(_|$).*/, /^broker(_|$).*/, /^listing_agent.*/,
      /^contact(_|$).*/,
    ],
    exclude: [
      /^booking.*/, /^reservation.*/,
      /^developer.*/, /^designer.*/, /^architect.*/,
    ],
  },
  location: {
    allow: [
      /^(property_)?(address|location|street_address)$/,
      /^(city|state|postal_code|zip|country)$/,
    ],
    exclude: [
      /^.*_count$/, /^number_of_.*/,
      /^restaurant.*/, /^ballroom.*/, /^amenit.*/,
      /^designer.*/, /^architect.*/, /^agent.*/,
    ],
  },
  neighborhood: {
    allow: [
      /^neighborhood.*/, /^area.*/, /^district.*/,
      /^nearby.*/, /^local_area.*/,
    ],
    exclude: [
      /^address.*/, /^.*_count$/, /^number_of_.*/, /^agent.*/,
    ],
  },
  property_name: {
    allow: [
      /^(property_)?name$/, /^space_name$/, /^venue_name$/,
      /^building_name$/, /^listing_title$/, /^title$/,
    ],
    exclude: [
      /^agent.*/, /^broker.*/, /^contact.*/, /^address.*/,
      /^.*_count$/, /^number_of_.*/, /^price.*/, /^.*_price$/,
    ],
  },
  amenity_presence: {
    allow: [
      /^has_.*/, /^amenit.*/, /^features(_list)?$/,
      /^facilities.*/, /^.*_available$/,
    ],
    exclude: [
      /^number_of_.*/, /^.*_count$/,
      /^address.*/, /^agent.*/, /^price.*/, /^booking.*/,
    ],
  },
  amenity_count: {
    allow: [
      /^number_of_amenit.*/, /^amenity_count$/, /^amenit.*_count$/,
    ],
    exclude: [
      /^number_of_rooms$/, /^number_of_ballrooms$/,
      /^number_of_restaurants$/, /^address.*/,
    ],
  },
  rooms_count: {
    allow: [
      /^number_of_rooms$/, /^rooms$/, /^room_count$/,
      /^total_rooms$/, /^guest_rooms?(_count)?$/,
    ],
    exclude: [
      /^number_of_ballrooms$/, /^number_of_restaurants$/,
      /^number_of_bathrooms$/, /^number_of_bedrooms$/,
      /^address.*/, /^price.*/, /^booking.*/,
    ],
  },
  ballrooms_count: {
    allow: [
      /^number_of_ballrooms$/, /^ballrooms$/, /^ballroom_count$/,
      /^event_space.*_count$/,
    ],
    exclude: [
      /^number_of_rooms$/, /^number_of_restaurants$/,
      /^number_of_bathrooms$/, /^address.*/,
    ],
  },
  restaurant_presence: {
    allow: [
      /^has_restaurant.*/, /^restaurants(_list|_names)?$/,
      /^dining.*/, /^food_and_beverage.*/,
    ],
    exclude: [
      /^number_of_(rooms|ballrooms|bathrooms|floors|amenit).*/,
      /^address.*/, /^agent.*/,
    ],
  },
  restaurant_count: {
    allow: [
      /^number_of_restaurants$/, /^restaurants_count$/,
      /^restaurant_count$/, /^dining_count$/,
    ],
    exclude: [
      /^number_of_rooms$/, /^number_of_ballrooms$/, /^address.*/,
    ],
  },
  restaurant_location: {
    allow: [
      /^restaurant(_\w+)?_floor$/, /^restaurant_location$/,
      /^dining_location$/, /^restaurant_floor_locations?$/,
    ],
    exclude: [
      /^number_of_restaurants$/, /^restaurants_count$/,
      /^address.*/, /^number_of_(rooms|ballrooms|floors).*/,
    ],
  },
  floor_level: {
    allow: [
      /^.*_floor$/, /^floor_of_.*/, /^level_of_.*/,
      /^floor_level$/, /^number_of_floors$/,
    ],
    exclude: [
      /^number_of_restaurants$/, /^number_of_rooms$/, /^address.*/,
    ],
  },
  history_opening: {
    allow: [
      /^opening_(date|year)$/, /^opened_(on|in)$/,
      /^date_opened$/, /^first_opened.*/,
    ],
    exclude: [
      /^year_built$/, /^construction_year$/, /^address.*/,
    ],
  },
  year_built: {
    allow: [
      /^year_built$/, /^construction_year$/,
      /^built_in$/, /^year_constructed$/,
    ],
    exclude: [
      /^opening_.*/, /^opened_.*/, /^address.*/, /^agent.*/,
    ],
  },
  designer_architect: {
    allow: [
      /^(interior_)?designer.*/, /^architect.*/,
      /^designed_by$/, /^interior_designer.*/,
    ],
    exclude: [
      /^agent.*/, /^broker.*/, /^listing.*/, /^contact.*/,
      /^developer.*/,
    ],
  },
  developer: {
    allow: [
      /^developer.*/, /^developed_by$/,
      /^builder.*/, /^construction_company$/,
    ],
    exclude: [
      /^designer.*/, /^architect.*/, /^agent.*/, /^broker.*/,
    ],
  },
  pricing: {
    allow: [
      /^price.*/, /^.*_price$/, /^rate.*/, /^cost.*/,
      /^nightly_rate$/, /^room_rate$/, /^adr$/,
      /^.*fee.*/, /^.*fees.*/, /^.*package.*/,
      /^bar_service.*/, /^catering.*/, /^site_fee.*/,
      /^.*_per_person$/,
      /^lease_rate$/, /^rent$/, /^cam_charges$/, /^nnn_charges$/,
      /^noi$/, /^cap_rate$/,
    ],
    exclude: [
      /^number_of_.*/, /^address.*/, /^agent.*/,
    ],
  },
  unit_count: {
    allow: [
      /^number_of_units$/, /^units$/, /^unit_count$/,
      /^apartment_count$/, /^suite_count$/,
    ],
    exclude: [
      /^number_of_rooms$/, /^number_of_bedrooms$/, /^number_of_bathrooms$/,
      /^price.*/, /^.*_price$/, /^address.*/,
    ],
  },
  property_dimension: {
    allow: [
      /^square_feet$/, /^sqft$/, /^living_area$/,
      /^rentable_square_feet$/, /^building_square_feet$/,
      /^lot_size$/, /^property_size_acres$/, /^acreage$/,
      /^clear_height$/, /^ceiling_height$/, /^frontage$/,
      /^traffic_count$/,
    ],
    exclude: [
      /^price.*/, /^.*_price$/, /(^|_)fees?($|_)/, /^agent.*/,
    ],
  },
  investment_metric: {
    allow: [
      /^noi$/, /^cap_rate$/, /^occupancy_rate$/,
      /^cash_flow$/, /^gross_income$/, /^net_operating_income$/,
    ],
    exclude: [
      /^agent.*/, /^address.*/, /^number_of_rooms$/,
    ],
  },
  zoning_context: {
    allow: [
      /^zoning$/, /^zoned$/, /^land_use$/, /^permitted_use.*/,
      /^restrictions?$/, /^use_restrictions?$/,
    ],
    exclude: [
      /^price.*/, /^.*_price$/, /^agent.*/, /^number_of_.*/,
    ],
  },
  space_capacity: {
    allow: [
      /^.*capacity.*/, /^.*occupancy.*/,
      /^.*guest.*/, /^.*guests.*/,
      /^.*pavilion.*/, /^.*deck.*/, /^.*ceremony.*/, /^.*reception.*/,
      /^.*seated.*/, /^.*lodging.*/, /^.*accommodation.*/,
      /^minimum_guests$/, /^maximum_guests$/,
    ],
    exclude: [
      /^price.*/, /^.*_price$/, /(^|_)fees?($|_)/, /^.*cost.*/, /^rate.*/,
      /^address.*/, /^agent.*/, /^parking.*/,
    ],
  },
  catering_service: {
    allow: [
      /^catering.*/, /^in_house_catering.*/, /^on_site_catering.*/,
      /^buffet.*/, /^food_service.*/, /^dining.*/,
    ],
    exclude: [
      /^bar_service.*/, /^cocktail.*/, /^number_of_.*/, /^address.*/, /^agent.*/,
    ],
  },
  island_context: {
    allow: [
      /^.*island.*/, /^.*inholding.*/, /^surrounding.*/,
      /^land_.*/, /^zoning.*/, /^jurisdiction.*/,
      /^national_forest.*/,
    ],
    exclude: [
      /^price.*/, /^.*_price$/, /(^|_)fees?($|_)/, /^number_of_.*/, /^agent.*/,
    ],
  },
  availability: {
    allow: [
      /^availability.*/, /^available_.*/, /^is_available$/,
    ],
    exclude: [
      /^number_of_.*/, /^address.*/, /^price.*/,
    ],
  },
  parking: {
    allow: [
      /^parking.*/, /^valet.*/, /^self_parking$/, /^garage.*/,
    ],
    exclude: [
      /^address.*/, /^number_of_(?!parking).*/,
    ],
  },
  accessibility: {
    allow: [
      /^accessibility.*/, /^ada.*/,
      /^wheelchair.*/, /^accessible.*/,
    ],
    exclude: [
      /^address.*/, /^agent.*/, /^number_of_(?!accessible).*/,
    ],
  },
  summary: {
    allow: [
      /^(property_)?(description|summary|overview)$/,
    ],
    exclude: [
      /^number_of_.*/, /^price.*/,
    ],
  },
  dining_recommendation: {
    allow: [
      /menu/, /food/, /dish/, /cuisine/, /signature.*/,
      /^restaurant_name$/, /^restaurant_names?$/,
      /^dining.*/, /^food_and_beverage.*/,
    ],
    exclude: [
      /^number_of_.*/, /^.*_count$/,
      /^address.*/, /^location$/, /^agent.*/, /^booking.*/,
      /^price.*/, /^.*_price$/,
    ],
  },
  bar_program: {
    allow: [
      /cocktail/, /bar(_|$)/, /drink/, /beverage/, /spirits/,
      /wine/, /mixology/,
    ],
    exclude: [
      /^number_of_.*/, /^.*_count$/,
      /^address.*/, /^agent.*/, /^booking.*/, /^restaurant_floor.*/,
    ],
  },
  history_story: {
    allow: [
      /history/, /historical/, /heritage/, /legacy/, /story/,
      /backstory/, /^historical_reference$/, /^narrative.*/,
    ],
    exclude: [
      /^number_of_.*/, /^.*_count$/,
      /^address.*/, /^agent.*/, /^price.*/, /^booking.*/,
    ],
  },
  design_inspiration: {
    allow: [
      /inspiration/, /concept/, /design_(story|theme|inspiration)/,
      /theme/, /motif/, /^neighborhood_inspiration$/,
    ],
    exclude: [
      /^number_of_.*/, /^.*_count$/,
      /^address.*/, /^agent.*/, /^price.*/, /^booking.*/,
    ],
  },
  brand_chain: {
    allow: [
      /^hotel_chain$/, /^brand(_|$).*/, /^chain$/,
      /^affiliation.*/, /^operator.*/, /^franchise.*/,
    ],
    exclude: [
      /^number_of_.*/, /^.*_count$/,
      /^address.*/, /^agent.*/, /^price.*/,
    ],
  },
  comparison: { allow: [], exclude: [] },
  unknown: { allow: [], exclude: [] },
};

export function intentAllows(fieldName: string, intent: string): boolean {
  if (!fieldName) return false;
  if (!intent || intent === "unknown") return true;
  const rules = FIELD_COMPAT[intent];
  if (!rules) return true;
  const name = String(fieldName).toLowerCase();
  for (const re of rules.exclude) {
    if (re.test(name)) return false;
  }
  if (rules.allow.length === 0) return true;
  for (const re of rules.allow) {
    if (re.test(name)) return true;
  }
  return false;
}
