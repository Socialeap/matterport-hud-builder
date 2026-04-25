// Intent router + field-compatibility matrix for the Ask AI pipeline.
//
// This file is BOTH imported by Node tests AND read verbatim at request
// time by portal.functions.ts, then inlined into the downloaded HTML's
// browser IIFE. Constraints:
//   - No `import` / `require` / `export default` (browser IIFE target).
//   - No TypeScript syntax (annotations, `as`, `interface`, generics).
//   - All exports listed in the single `export { ... }` at the bottom.
//   - Zero external dependencies at runtime.
//
// The anti-drift guard in scripts/verify-portal-html.mjs fails the build
// if any of those rules are violated.

// Every pattern is matched against lowercased field names.
// `allow` is an OR over the regex list — at least one must match.
// `exclude` is a veto — any match disqualifies the field even if cosine
// is high. Known-failure exclusions are commented inline.
var FIELD_COMPAT = {
  booking: {
    allow: [
      /^(booking|reservation|reserve|book_now)(_url|_link)?$/,
      /^book_now$/,
    ],
    // "How do I book a room?" MUST NOT return number_of_rooms.
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
  amenity_presence: {
    allow: [
      /^has_.*/, /^amenit.*/, /^features(_list)?$/,
      /^facilities.*/, /^.*_available$/,
    ],
    // "Is there a theatre?" MUST NOT return the address.
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
    // "How many ballrooms?" MUST NOT return number_of_rooms.
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
    // "What floor is the restaurant?" MUST NOT return number_of_restaurants.
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
    // "Who was the designer?" MUST NOT return agent name.
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
    ],
    exclude: [
      /^number_of_.*/, /^address.*/, /^agent.*/,
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
  // ── Hospitality / experience intents (added in Ask AI v2) ──
  dining_recommendation: {
    allow: [
      /menu/, /food/, /dish/, /cuisine/, /signature.*/,
      /^restaurant_name$/, /^restaurant_names?$/,
      /^dining.*/, /^food_and_beverage.*/,
    ],
    // Don't recommend an address or a count when asked about food.
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

// Keyword patterns for classifyIntent. Each entry is a list of regexes
// that must hit the lowercased query text. First match wins, ordered
// by specificity (most specific first — e.g. restaurant_location must
// match before restaurant_presence).
var INTENT_PATTERNS = [
  { intent: "booking", patterns: [
    /\bbook(ing)?\b/, /\breserve\b/, /\breservation\b/,
    /\bmake\s+a\s+reservation\b/, /\bhow\s+do\s+i\s+book\b/,
  ]},
  { intent: "contact_agent", patterns: [
    /\bcontact\s+(the\s+)?(agent|broker|representative)\b/,
    /\b(who\s+is\s+the|meet\s+the)\s+(agent|broker|realtor)\b/,
    /\bagent'?s?\s+(email|phone|number|contact)\b/,
    /\b(how\s+do\s+i\s+)?(reach|contact)\s+(you|the\s+agent|someone)\b/,
    /\bbroker\b/, /\blisting\s+agent\b/,
  ]},
  { intent: "restaurant_location", patterns: [
    /\b(what|which)\s+floor\s+(is|are)\s+.*\b(restaurant|dining|bar|cafe)\b/,
    /\bwhere('s|\s+is)\s+the\s+(restaurant|bar|cafe|dining)\b/,
    /\brestaurant.*\bfloor\b/, /\bfloor.*\brestaurant\b/,
  ]},
  { intent: "restaurant_count", patterns: [
    /\bhow\s+many\s+(restaurants|dining\s+options|eateries)\b/,
    /\b(number\s+of|count\s+of)\s+restaurants?\b/,
  ]},
  { intent: "restaurant_presence", patterns: [
    /\b(is|are)\s+there\s+(a|any)?\s*(restaurants?|dining|bar|cafe)\b/,
    /\b(do\s+(they|you)\s+have|have\s+you\s+got)\s+(a\s+)?(restaurants?|dining|food)\b/,
    /\bwhere\s+can\s+i\s+eat\b/, /\bplaces?\s+to\s+eat\b/,
  ]},
  { intent: "ballrooms_count", patterns: [
    /\bhow\s+many\s+(ballrooms?|event\s+spaces?|banquet\s+halls?)\b/,
    /\b(number\s+of|count\s+of)\s+ballrooms?\b/,
    /\bballroom\s+count\b/,
  ]},
  { intent: "rooms_count", patterns: [
    /\bhow\s+many\s+(rooms|guest\s+rooms|keys|suites)\b/,
    /\b(number\s+of|count\s+of|total)\s+rooms\b/,
    /\broom\s+count\b/,
  ]},
  { intent: "amenity_count", patterns: [
    /\bhow\s+many\s+(amenities|features|facilities)\b/,
    /\b(number\s+of|count\s+of)\s+amenities\b/,
  ]},
  { intent: "amenity_presence", patterns: [
    /\b(is|are)\s+there\s+(a|any)?\s*(spa|gym|theatre|theater|pool|fitness|business\s+center|concierge|lounge)\b/,
    /\bdo(es)?\s+(it|this|they|you)\s+have\s+(a|an|any)\s+\w+/,
    /\bhas\s+(a|an|any)\s+\w+/,
  ]},
  { intent: "floor_level", patterns: [
    /\b(what|which)\s+floor\b/,
    /\b(what|which)\s+level\b/,
    /\bhow\s+many\s+floors\b/,
  ]},
  { intent: "history_opening", patterns: [
    /\bwhen\s+(did|was)\s+.*(open|opened|opening)\b/,
    /\bopening\s+(date|year)\b/,
    /\bwhen\s+did\s+.*first\s+open\b/,
  ]},
  { intent: "year_built", patterns: [
    /\bwhen\s+(was|were)\s+.*(built|constructed)\b/,
    /\b(what\s+year|year\s+of)\s+.*built\b/,
    /\bhow\s+old\s+is\s+(it|this)\b/,
    /\byear\s+built\b/,
  ]},
  { intent: "designer_architect", patterns: [
    /\bwho\s+(was|is)\s+the\s+(designer|architect|interior\s+designer)\b/,
    /\bwho\s+designed\s+(it|this)\b/,
    /\b(interior\s+)?designer\b/, /\barchitect\b/,
    /\bdesigned\s+by\b/,
  ]},
  { intent: "developer", patterns: [
    /\bwho\s+(developed|built)\s+(it|this|the\s+(property|hotel|building|place))\b/,
    /\bwho\s+is\s+the\s+developer\b/,
    /\bdeveloper\b/, /\bconstruction\s+company\b/,
  ]},
  { intent: "pricing", patterns: [
    /\bhow\s+much\s+(does|is|it\s+cost)\b/,
    /\b(price|cost|rate|rates)\s+(per|for|of)\b/,
    /\bnightly\s+rate\b/, /\broom\s+rate\b/, /\bwhat.+cost\b/,
  ]},
  { intent: "availability", patterns: [
    /\b(is\s+it|are\s+they)\s+available\b/,
    /\b(when\s+is\s+it|when\s+are\s+they)\s+available\b/,
    /\bavailability\b/, /\bany\s+(openings|dates)\b/,
  ]},
  { intent: "parking", patterns: [
    /\b(is\s+there|do\s+they\s+have)\s+parking\b/,
    /\bwhere\s+do\s+i\s+park\b/, /\bvalet\b/,
    /\bself[\s-]?parking\b/, /\bparking\b/,
  ]},
  { intent: "accessibility", patterns: [
    /\b(is\s+it|are\s+they)\s+(accessible|ada|wheelchair)\b/,
    /\bwheelchair\s+(accessible|access)\b/,
    /\b(ada|accessibility)\b/,
  ]},
  { intent: "neighborhood", patterns: [
    /\bwhat('s|\s+is)\s+(nearby|around|in\s+the\s+area)\b/,
    /\b(what|which)\s+neighborhood\b/,
    /\bneighborhood\b/, /\barea\s+like\b/, /\bnear\s+the\s+property\b/,
  ]},
  { intent: "location", patterns: [
    /\bwhere\s+(is|are|can\s+i\s+find)\s+(it|this|the\s+property)\b/,
    /\bwhat('s|\s+is)\s+the\s+address\b/,
    /\b(street|property)\s+address\b/,
    /\bhow\s+do\s+i\s+get\s+there\b/,
    /\b\s*location\b/, /\bdirections\b/,
  ]},
  { intent: "summary", patterns: [
    /\btell\s+me\s+about\s+(this|it|the\s+property)\b/,
    /\bdescribe\s+(this|it|the\s+property)\b/,
    /\bwhat\s+is\s+this\s+place\b/,
    /\boverview\b/, /\bsummary\b/,
  ]},
  { intent: "comparison", patterns: [
    /\bcompare\s+(these|the)\s+properties\b/,
    /\bwhat('s|\s+is)\s+the\s+difference\s+between\b/,
    /\bwhich\s+(is|has)\s+(bigger|larger|more|better)\b/,
  ]},
];

function normalizeQuery(q) {
  return String(q || "")
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeQuery(q) {
  var norm = normalizeQuery(q);
  if (!norm) return [];
  var parts = norm.split(" ");
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].length >= 3) out.push(parts[i]);
  }
  return out;
}

function classifyIntent(q) {
  if (!q) return { intent: "unknown", confidence: 0, tokens: [] };
  var raw = String(q).toLowerCase();
  for (var i = 0; i < INTENT_PATTERNS.length; i++) {
    var row = INTENT_PATTERNS[i];
    for (var p = 0; p < row.patterns.length; p++) {
      if (row.patterns[p].test(raw)) {
        return {
          intent: row.intent,
          confidence: 0.8,
          tokens: tokenizeQuery(q),
        };
      }
    }
  }
  return { intent: "unknown", confidence: 0, tokens: tokenizeQuery(q) };
}

function intentAllows(fieldName, intent) {
  if (!fieldName) return false;
  if (!intent || intent === "unknown") return true;
  var rules = FIELD_COMPAT[intent];
  if (!rules) return true;
  var name = String(fieldName).toLowerCase();
  var excl = rules.exclude || [];
  for (var e = 0; e < excl.length; e++) {
    if (excl[e].test(name)) return false;
  }
  var allow = rules.allow || [];
  if (allow.length === 0) return true;
  for (var a = 0; a < allow.length; a++) {
    if (allow[a].test(name)) return true;
  }
  return false;
}

function tagQAIntents(qa) {
  var field = (qa && qa.field) ? String(qa.field) : "";
  if (!field) return [];
  var hits = [];
  var names = Object.keys(FIELD_COMPAT);
  for (var i = 0; i < names.length; i++) {
    var intent = names[i];
    if (intent === "unknown" || intent === "comparison") continue;
    if (intentAllows(field, intent)) {
      var rules = FIELD_COMPAT[intent];
      if ((rules.allow || []).length > 0) hits.push(intent);
    }
  }
  return hits;
}

var ACTION_INTENTS = {
  booking: true,
  contact_agent: true,
  location: true,
  neighborhood: true,
};

function isActionIntent(intent) {
  return !!ACTION_INTENTS[intent];
}

export {
  FIELD_COMPAT,
  INTENT_PATTERNS,
  ACTION_INTENTS,
  normalizeQuery,
  tokenizeQuery,
  classifyIntent,
  intentAllows,
  tagQAIntents,
  isActionIntent,
};
