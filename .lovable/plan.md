
# Why the AI chat under-answers — and a fix that works for every property class

I parsed the uploaded `Chaska_Commons_Coworking.pdf` and traced the failed answers through `extract-property-doc → property_extractions → ask-runtime-logic → synthesize-answer`. The PDF contains plenty of facts the bot said it didn't have ("Built 1892", "Opened September 2025", "7 private offices", "$850–$1,200/mo", "Metronet gig-speed fiber", "full kitchen + Jones Coffee bar", `Walk Score 74/100`). The data is in the document — it just never reaches Gemini in a usable shape.

The same root causes apply to **every** property profile we ship (Residential, Hospitality, Commercial Office, Multi-Family, Coworking, Event Space — see `src/components/portal/ai-training-wizard/profiles.ts`), because the broken pieces sit *upstream of any one schema*: the chunker, the prose-miner, the runtime gate, and the synthesis prompt.

## Root causes (category-agnostic)

1. **Citation noise & header bleed in chunks.** PDFs (real-estate brochures, OMs, factsheets, MLS sheets, hotel one-pagers) routinely contain inline `[1, 2, 3]` reference markers and bold section headers (`Property Specifications`, `Amenities`, `Investment Highlights`, `Construction`, `Capacity & Layout`, etc.). Our chunker collapses whitespace and lets the next section's header bleed into the previous chunk, then the sentence splitter chokes on the brackets. We saw this in the parking answer: `…Ample free public parking located nearby in historic downtown Chaska. [2, 5, 7, 8, 10] Real Estate & Membership Details The property is positioned…`.

2. **Bullet/sub-bullet facts collapse into a single blob.** All six profiles use bulleted brochures. After whitespace collapse, `- Pricing: Private Offices ~$850–$1,200/mo / Dedicated Desks from $350 / Lounge $150–$250` becomes one evidence unit no specific question can match. Same problem in a hotel sheet (`- Room Types: King $289, Queen $249, Suite $499`), an office OM (`- Asking Rent: $32 NNN; CAM $7.50; Real Estate Taxes $4.20`), and a wedding venue (`- Capacity: Ceremony 200 / Reception seated 180 / Cocktail 250`).

3. **The runtime intent gate strands good raw chunks before synthesis.** In `src/lib/portal/ask-runtime-logic.mjs` `decideAnswer()`, when a query has a confidently classified intent but the chunk's *section label* (often a generic template label like "Coworking brochure" or "Hospitality factsheet") fails the intent allow-list, the chunk is dropped from `synthSource` and we return `STRICT_UNKNOWN_COPY`. This kills "When was this built?" / "Does this have a kitchen?" / "What's the cap rate?" / "How many guests can it hold?" alike — the answer is sitting in chunk 0 but never gets to Gemini.

4. **Synthesis prompt is too quick to fold.** The current system prompt tells Gemini "If the answer cannot be found in the context, say: 'I don't have that information…'". With our short chunk cap (5) and partial bullet evidence, Gemini errs on the side of refusal even when the answer is across two cards. We also cap context at 5 chunks, which is fine for long OMs but starves short brochures.

5. **Prose-miner has good real-estate coverage but big blind spots.** `supabase/functions/_shared/prose-miner.ts` already handles many label-driven facts (`list_price`, `noi`, `cap_rate`, `clear_height`, `parking_spaces`, etc.) and uses an alias map. It's missing a class of facts that show up across *multiple* property types and would unlock dozens of common questions deterministically (no Gemini needed).

6. **Synthesis may be silently disabled.** `synthesize-answer` only runs when both `__SYNTHESIS_URL__` and `__PRESENTATION_TOKEN__` are injected at HTML generation, which requires `PRESENTATION_TOKEN_SECRET` (≥ 32 chars) **and** `SUPABASE_SERVICE_ROLE_KEY` in the server env. If either is missing, the export ships in deterministic-only mode and you get exactly the symptom set above. I'll verify this in build mode.

7. **Two TS build errors are blocking the previous turn** (`get_my_service_polygon` / `set_my_service_polygon` not in the auto-generated `types.ts`). Quick `as never` cast on the two RPC call sites.

## What to ship — applies to ALL property profiles

### A. Cross-category chunk hygiene
*Files: `supabase/functions/_shared/document-cleaning.ts`, `supabase/functions/_shared/text-chunker.ts`*

- Strip inline citation markers (`\[\s*\d+(?:\s*,\s*\d+)*\s*\]`) before chunking AND after Groq cleaning. Helps every brochure, OM, factsheet, and listing sheet.
- Recognise Markdown bullet lines (`-`, `•`, `*`, numbered) BEFORE whitespace collapse. Each top-level bullet becomes one evidence unit; nested sub-bullets become their own units. Fixes the "all pricing in one chunk" / "all room types in one chunk" / "all capacity numbers in one chunk" failure mode shared by every category.
- Insert a hard break when a sentence ends and the next token sequence is `[A-Z][\w &]+:\s` (a new label), preventing section-header bleed.
- Penalise chunk `qualityScore` for: ending in an unmatched `[`, starting mid-sentence (lowercase first char), being > 80 % uppercase (footer / page-number pages).

### B. Prose-miner expansion that lights up every profile
*File: `supabase/functions/_shared/prose-miner.ts`*

Add patterns that recur across multiple categories. Each entry below names the categories it serves so it's clear we're not coworking-specific:

| New field(s) | Pattern intent | Categories served |
|---|---|---|
| `year_built`, `year_opened`, `year_renovated`, `year_completed` | `(?:built|constructed|established|completed|opened|renovated|delivered)\s+(?:in\s+)?(1[789]\d{2}\|20\d{2})` | Residential, Hospitality, Commercial Office, Multi-Family, Coworking, Event Space |
| `historical_period_label` | "historic", "circa 1892", "vintage", "newly built" | Residential, Hospitality, Coworking, Event Space |
| `internet_provider`, `internet_speed_class` | `Metronet`, `Spectrum`, `gig-speed`, `gigabit`, `\d+\s*(Mbps\|Gbps)` | Coworking, Multi-Family, Office, Hospitality |
| `room_count`, `suite_count` | `(\d+)\s+(?:guest\s+)?rooms?`, `(\d+)\s+suites?` | Hospitality |
| `private_office_count`, `dedicated_desk_count` | `(\d+)\s+private\s+offices?`, `(\d+)\s+dedicated\s+desks?` | Coworking |
| `ceremony_capacity`, `reception_capacity_seated`, `reception_capacity_standing`, `cocktail_capacity` | `(\d+)\s+(guests?\|seats?\|people)\s+(seated\|standing\|cocktail)` and the inverse | Event Space, Hospitality (ballrooms) |
| `conference_room_capacity` | `conference room.{0,40}(\d+)[–-](\d+)\s+people` | Coworking, Office, Hospitality |
| `ceiling_height_feet` | `ceilings?\s*\(?(\d+)\s*(?:feet\|ft|')` | Coworking, Office, Event Space, Loft Residential |
| `walk_score`, `bike_score`, `transit_score` | `Walk Score of\s*(\d+)`, `Bike Score of\s*(\d+)` | All |
| `kitchen_present`, `outdoor_space_present`, `pool_present`, `gym_present`, `pet_policy`, `parking_type` | Bullet-presence boolean / enum extraction | All |
| `address` (street + city/state/zip) | `\d+\s+[A-Z][\w .'-]+,\s*[A-Z][a-z]+,\s*[A-Z]{2}\s*\d{5}` | All |
| Price ranges (`*_price_min`, `*_price_max`) for any field whose source bullet says `$X – $Y` or `$X to $Y` | Generic range splitter that fires on any `*_price` / `*_rate` field | Coworking memberships, Hospitality room rates, Multi-Family unit rents, Event venue packages |
| `monthly_rent_min`, `monthly_rent_max` | `\$([\d,]+)\s*[–-]\s*\$([\d,]+)\s*(?:per\s+month|/mo|monthly)` | Multi-Family, Coworking, Residential rentals |
| `building_class` (A / B / C / Trophy) | Office class label patterns | Commercial Office |
| `tenant_mix`, `anchor_tenant` | `Anchor:\s*([A-Z][^\n]{2,40})` | Commercial Office, Retail-flavored multifamily |
| `historical_era`, `architect`, `developer_name` | `designed by\s+([A-Z][^\n,]{2,40})`, `developed by\s+…` | Hospitality, Office, Event Space |

These automatically turn into deterministic canonical Q&A pairs via `src/lib/rag/canonical-questions.ts` (existing pipeline — no new code), so questions like *"How many rooms does the hotel have?"*, *"What's the ceremony capacity?"*, *"What year was this built?"*, *"What's the cap rate?"*, *"What's the Walk Score?"* answer instantly with zero LLM cost — for every profile.

### C. Stop the runtime from starving synthesis
*File: `src/lib/portal/ask-runtime-logic.mjs`*

- In `rescoreChunksByIntent`: when a `raw_chunk`'s section label doesn't match the intent, *also* test the chunk content against `_INTENT_EVIDENCE_TERMS[intent]`. If 2+ evidence tokens are present, set `_intentMatched = true`. This rescues category-generic chunks (every profile uses generic template labels) when their *content* is on-topic.
- In `decideAnswer`: when `hasIntent && synthSource.length === 0 && allowedChunks.length > 0 && canSynthesize`, fall through to synthesis with `allowedChunks` instead of returning strict-unknown. The current "category-wrong-adjacency guard" is too aggressive when intent classification is right but section labels are weak — which they are for every MSP-cloned starter.

### D. Tighten the synthesis prompt + give it more cards
*File: `supabase/functions/synthesize-answer/index.ts`*

- Bump `MAX_TRUSTED_CHUNKS` from 5 → 8 (cost impact negligible at our chunk size; recall impact for short brochures is the whole point).
- Reword the system prompt so Gemini may *combine* multiple bullets:
  > "You are a helpful real-estate / property assistant. Answer the visitor's question using ONLY the context below. You may quote, paraphrase, and combine multiple context items. Be specific — include numbers, names, prices, capacities, dates, scores, and proper nouns when present in context. Only say 'I don't have that information in the provided documents.' when the answer is genuinely absent."
- Log `chunks_used` count and the first 80 chars of each card so we can verify what Gemini actually saw.

### E. Verify and surface synthesis-env state
- In default mode, run `compgen -e | rg -i 'PRESENTATION_TOKEN_SECRET|SERVICE_ROLE'` and inspect the latest export's HTML for `__SYNTHESIS_URL__`. If missing, surface a clear toast in the builder UI ("Smart answers disabled — set PRESENTATION_TOKEN_SECRET in Lovable Cloud to enable Gemini") instead of silent degradation. This already has a code path (`askAiWarning` in `src/lib/portal.functions.ts`); we just need to make sure it's piped to a visible toast, not just a console warn.

### F. Re-extract existing properties after deploy
The Coworking property — and any other properties already extracted before the fixes — has a stale `property_extractions` row. After the chunker + miner changes are live, the builder's existing "Re-train AI" path (`reindex` from `usePropertyExtractions`) regenerates them. I'll trigger it for the test property and confirm new chunks/fields land.

### G. Fix the two TS build errors
`src/routes/_authenticated.dashboard.branding.tsx:208` and `:379` call the new polygon RPCs that exist in the DB but not yet in the auto-generated `src/integrations/supabase/types.ts`. One-line cast per call:
```ts
await supabase.rpc("get_my_service_polygon" as never);
await supabase.rpc("set_my_service_polygon" as never, { p_geojson: ... });
```
The cast goes away on the next types regeneration; nothing else needed.

## Files I will touch

- `supabase/functions/_shared/document-cleaning.ts` — citation strip, header-bleed pass
- `supabase/functions/_shared/text-chunker.ts` — bullet-aware splitting, sub-bullet emission, quality penalty
- `supabase/functions/_shared/prose-miner.ts` — new cross-category field patterns (table above)
- `supabase/functions/extract-property-doc/index.ts` — log new counters; no behavior change beyond what the helpers do
- `supabase/functions/synthesize-answer/index.ts` — chunk cap, prompt rewrite, evidence logging
- `src/lib/portal/ask-runtime-logic.mjs` — content-token intent matching for raw chunks; soften strict-unknown gate
- `src/lib/portal.functions.ts` — surface `askAiWarning` to a visible toast when synthesis env is missing
- `src/routes/_authenticated.dashboard.branding.tsx` — TS cast for the two polygon RPCs

No DB schema changes, no RLS changes, no changes to provider templates / starter schemas (those already cover the right field surface — the bottleneck was extraction quality, not template breadth).

## Expected outcome across every property profile

- **Residential** ("When was this built?", "What's the price?", "Walk Score?", "How many bedrooms?") — answered deterministically from canonical Q&A.
- **Hospitality** ("How many rooms?", "When did the hotel open?", "Is there a pool?", "Room rates?") — answered deterministically or from synthesis with clean bullet evidence.
- **Commercial Office** ("What's the cap rate?", "Asking rent per sqft?", "Building class?", "Anchor tenant?") — already partially mined; new patterns close the gaps.
- **Multi-Family** ("How many units?", "Monthly rent range?", "Pet policy?", "Year built?") — new range and policy patterns light up.
- **Coworking** (test case) — all the failing questions in the chat transcript answer correctly post-deploy.
- **Event Space** ("Ceremony capacity?", "Reception seated?", "Catering provided?") — new capacity patterns + miner unlock these.

Approve and I'll implement in build mode and re-extract the test property afterward to confirm.
