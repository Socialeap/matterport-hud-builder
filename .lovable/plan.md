# Add Event Space Pre-Built Template

## Goal
Add a 6th pre-built Property Map called **Event Space** to the "Use a Pre-Built Template" picker, covering reception halls, wedding venues, party/event venues. Mirrors the structure of the existing 5 starters (Residential, Hospitality, Commercial Office, Multi-Family, Coworking) so it shows up automatically in:
- Vault Templates wizard → "Pre-Built Templates" grid (`LibraryPath`)
- AI Training Wizard → "Property Profile" picker (`ProfileStep`)

No schema migrations, no backend changes — pure additive static data plus one new icon binding.

## Files to change

### 1. `src/lib/vault/starter-templates.ts`
Append a new `StarterTemplate` entry to the `STARTER_TEMPLATES` array:
- `id: "starter-event-space"`
- `name: "Event Space / Reception Venue"`
- `tagline: "Wedding venues, reception halls, party & event spaces"`
- `description`: short blurb about foundational venue facts + differentiating amenities used by the AI to answer planner questions and convince visitors to book.
- `icon: "Building2"` (already supported by the icon union — no type change needed; matches the other "venue-like" starters)
- `defaultLabel: "Event Space Map"`
- `doc_kind: "event_space_factsheet"`
- `extractor: "pdfjs_heuristic"`
- `schema`: JSON Schema with all fields below, grouped by section comments matching the pattern of existing starters. Field types: capacities/dimensions = `number`, dates/times/free-text lists = `string`, yes/no features = `boolean`. Each field gets a one-line `description` so the LLM extractor can find it in uploaded PDFs.

**Schema fields (grouped):**

Capacity & Space — `max_total_capacity`, `banquet_capacity`, `cocktail_capacity`, `theater_capacity`, `classroom_capacity`, `total_sqft`, `ceiling_height_ft`, `breakout_rooms_count`

Location & Access — `venue_address`, `neighborhood`, `onsite_parking_spaces`, `valet_parking_available` (bool), `transit_distance_min`, `loading_dock_access` (string — describes dock + vendor entry)

Operations & Rules — `loadin_loadout_windows`, `event_duration_limit`, `noise_curfew`, `exclusive_catering_required` (bool), `outside_vendor_policy`, `liquor_license_status`, `bar_rules`, `host_insurance_required` (bool), `booking_deposit_terms`, `cancellation_policy`

Accessibility — `ada_compliant` (bool), `elevator_access` (bool), `ramp_locations`, `accessible_restrooms` (bool), `wheelchair_seating_areas`

Wedding & Party Specifics — `bridal_suite` (bool), `groom_ready_room` (bool), `indoor_ceremony_space` (bool), `outdoor_ceremony_space` (bool), `grand_staircase` (bool), `scenic_views` (string), `photography_locations` (string)

Audio / Visual / Tech — `builtin_sound_system` (bool), `wireless_microphones_count`, `projection_or_led_walls` (string), `custom_lighting` (string), `guest_wifi` (bool), `livestream_hybrid_support` (bool), `band_dj_power_drops` (bool)

Dining & Hospitality — `onsite_commercial_kitchen` (bool), `event_coordination_services` (string), `menu_tasting_room` (bool), `premium_bar_packages` (string), `specialty_cocktail_options` (string), `late_night_food_setup` (string), `dessert_station_available` (bool)

Vibe & Atmosphere — `dance_floor` (string — permanent / portable / size), `stage_dimensions`, `coat_check_staffed` (bool), `outdoor_fire_pits_heaters` (bool), `cigar_or_cocktail_lounge` (bool), `rooftop_or_terrace_access` (bool)

`required: ["venue_address", "max_total_capacity", "total_sqft"]`

### 2. `src/components/portal/ai-training-wizard/profiles.ts`
Add the matching Property Profile so the AI Training Wizard surfaces the same option (resolution is by `docKind`, so this hooks into the new starter automatically):
- Extend `CategoryKey` union with `"event_space"`.
- Append to `PROFILE_CATEGORIES`:
  ```ts
  {
    key: "event_space",
    label: "Event Space",
    tagline: "Wedding/reception hall, party venue",
    icon: Building2,            // already imported
    starterId: "starter-event-space",
    docKind: "event_space_factsheet",
  }
  ```

No other call sites need changes — `LibraryPath`, `ProfileStep`, `resolveProfileTemplate`, and the wizard hub all iterate the arrays generically.

## Verification
- Pre-Built Templates grid renders 6 cards (was 5); Event Space card shows the field count badge automatically.
- Selecting it pre-fills the wizard's Name & Save step with `Event Space Map` / `event_space_factsheet` and the full schema.
- AI Training Wizard's Profile step shows Event Space as a 6th option; choosing it on first use clones the new starter into `vault_templates` via the existing `resolveProfileTemplate` flow (no new code path).
- TypeScript: `icon: "Building2"` is already in the icon union; `CategoryKey` union extension is the only type surface that changes, and it's only consumed inside the wizard.

## Out of scope
- No DB migration (templates are cloned per-provider on first use, same as today).
- No changes to extract-property-doc or RAG indexing — they read schema generically.
- No copy changes to the wizard chrome.
