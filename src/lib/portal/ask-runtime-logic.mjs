// Pure decision ladder for the Ask AI runtime. Orchestrates intent
// routing, exact/action answers, canonical-QA matching with field
// compatibility guards, and chunk-based grounding. Knows nothing about
// DOM, fetch, Orama, or transformers — those live in the IIFE and are
// injected as callbacks.
//
// Same rules as the other .mjs modules: no imports, no TS syntax.

// Tier 1 (canonical) thresholds. Same values the current pipeline uses.
var TIER1_SOFT = 0.55;
var TIER1_FLOOR = 0.45;
var TIER1_FIELD_BOOST = 0.10;
// Tier 2 (curated) minimum score for outright win.
var TIER2_MIN = 0.50;
var RRF_K = 60;

// Phase A — raw-chunk escalation. When canonical missed the soft floor
// AND a raw_chunk hit scored well above the synthesis-trigger band, we
// return the chunk content directly and skip the synthesize-answer
// edge call entirely. This is the cost-control path: an obviously
// matching paragraph from the source PDF doesn't need an LLM rewrite.
//
// The threshold is intentionally tighter than TIER1_SOFT to avoid
// pre-empting a synthesis pass that could produce a better-worded
// answer. Tuned against the test fixture; expect to adjust once
// real-traffic confidence histograms are available.
var RAW_CHUNK_DIRECT_FLOOR = 0.62;

// Value-bearing intents — a confidently classified intent on the query
// side is itself strong evidence the candidate field is correct. For
// these intents we accept any tier-1 hit above the hard floor (0.45),
// because tier1Rank already filtered the list through intentAllows.
// This is what lets "what's a good food to eat there?" hit
// `menu_highlight` even when cosine is in the 0.45–0.55 band.
var VALUE_BEARING_INTENTS = {
  dining_recommendation: true,
  bar_program: true,
  history_story: true,
  design_inspiration: true,
  brand_chain: true,
  designer_architect: true,
  developer: true,
  pricing: true,
  space_capacity: true,
  catering_service: true,
  island_context: true,
  parking: true,
  accessibility: true,
  summary: true,
  amenity_presence: true,
  restaurant_presence: true,
  year_built: true,
  history_opening: true,
};

// Per-intent strict-unknown copy for value-bearing misses.
var VALUE_INTENT_MISS_COPY = {
  dining_recommendation: "I don't have details on the menu or dining at this property yet.",
  bar_program: "I don't have details on the bar or cocktail program for this property yet.",
  history_story: "I don't have a historical backstory on file for this property yet.",
  design_inspiration: "I don't have details on the design inspiration for this property yet.",
  brand_chain: "I don't have brand or chain details for this property yet.",
  space_capacity: "I don't have capacity details for that space yet.",
  catering_service: "I don't have catering details for this property yet.",
  island_context: "I don't have land or island-context details for this property yet.",
};

// Per-action-intent miss copy. Keyed by intent. Shown when the intent
// is an action intent but the brain lacks the required data — the
// ladder terminates here instead of falling through to semantic tiers.
var ACTION_MISS_COPY = {
  booking: "I don't have a booking link for this property yet. Please contact us directly to reserve.",
  contact_agent: "I don't have contact info for this property yet.",
  location: "I don't have an address on file for this property.",
  neighborhood: "I don't have neighborhood info for this property yet.",
};

// Copy for the strict unknown fallback (semantic tiers all miss).
var STRICT_UNKNOWN_COPY = "I don't have that detail for this property yet. Try rephrasing, or contact us for more info.";

// Dot product on L2-normalized vectors (== cosine on normalized inputs).
function _dot(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  var s = 0;
  for (var i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function _queryTokens(q) {
  var t = String(q || "")
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, " ")
    .split(/\s+/);
  var out = {};
  for (var i = 0; i < t.length; i++) {
    if (t[i] && t[i].length >= 3) out[t[i]] = true;
  }
  return out;
}

function _fieldMatchesTokens(field, tokens) {
  if (!field) return false;
  var parts = String(field).toLowerCase().split(/[_\s-]+/);
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].length >= 3 && tokens[parts[i]]) return true;
    if (parts[i].length >= 4 && parts[i].slice(-1) === "s" && tokens[parts[i].slice(0, -1)]) return true;
  }
  return false;
}

function _intentMatchesChunkSection(section, intent, intentAllowsFn) {
  if (!intentAllowsFn) return true;
  if (!intent || intent === "unknown") return true;
  // chunk `section` often carries a field name or a document label with
  // a field suffix — run it through intentAllows as-is.
  var s = String(section || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  return intentAllowsFn(s, intent);
}

var _EVIDENCE_STOPWORDS = {
  what: true,
  whats: true,
  when: true,
  where: true,
  which: true,
  who: true,
  how: true,
  much: true,
  many: true,
  does: true,
  doe: true,
  this: true,
  that: true,
  there: true,
  they: true,
  have: true,
  with: true,
  about: true,
  property: true,
  ranch: true,
};

var _INTENT_EVIDENCE_TERMS = {
  pricing: ["price", "cost", "fee", "fees", "rate", "rates", "package", "packages", "site", "bar", "service", "catering", "person"],
  space_capacity: ["capacity", "hold", "holds", "guest", "guests", "people", "seated", "seat", "seats", "deck", "pavilion", "ceremony", "reception", "accommodating"],
  catering_service: ["catering", "buffet", "food", "dining", "per", "person", "mandatory", "available"],
  island_context: ["island", "surrounded", "inholding", "forest", "jurisdiction", "land", "federal", "oversight"],
  amenity_presence: ["available", "amenity", "amenities", "feature", "features", "on-site", "onsite"],
  restaurant_presence: ["restaurant", "dining", "food", "bar", "on-site", "onsite"],
  bar_program: ["bar", "cocktail", "drink", "beverage", "service"],
};

function _expandedEvidenceTokens(query, intent) {
  var raw = _queryTokens(query);
  var out = {};
  for (var t in raw) {
    if (!Object.prototype.hasOwnProperty.call(raw, t)) continue;
    if (_EVIDENCE_STOPWORDS[t]) continue;
    out[t] = true;
    if (t.length > 4 && t.slice(-1) === "s") out[t.slice(0, -1)] = true;
  }
  var extras = _INTENT_EVIDENCE_TERMS[intent] || [];
  for (var i = 0; i < extras.length; i++) out[extras[i]] = true;
  return out;
}

function _splitEvidenceSentences(content) {
  var clean = String(content || "")
    .replace(/[•●]\s*/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return [];
  var matches = clean.match(/[^.!?]+[.!?]?/g) || [clean];
  var out = [];
  for (var i = 0; i < matches.length; i++) {
    var s = matches[i].replace(/^[\s:;,\-–—)]+/, "").trim();
    if (!s || s.length < 18) continue;
    out.push(s);
  }
  return out;
}

function _scoreEvidenceSentence(sentence, tokens) {
  var s = String(sentence || "").toLowerCase();
  if (!s) return 0;
  var score = 0;
  for (var t in tokens) {
    if (!Object.prototype.hasOwnProperty.call(tokens, t)) continue;
    if (s.indexOf(t) >= 0) score += 1;
  }
  if (/\$[\d,]+/.test(s)) score += 1;
  if (/\b\d{2,5}\s+(guests|people|attendees|seated)\b/.test(s)) score += 1;
  if (/:\s/.test(sentence)) score += 0.25;
  // Mid-sentence sliding-window fragments are the main UX failure; keep
  // them as candidates, but prefer complete-looking evidence.
  if (/^[a-z(]/.test(sentence)) score -= 0.75;
  return score;
}

function _looksSpecificQuery(query, terms) {
  var q = String(query || "").toLowerCase();
  for (var i = 0; i < terms.length; i++) {
    if (q.indexOf(terms[i]) >= 0) return true;
  }
  return false;
}

function extractiveChunkAnswer(query, content, intent) {
  var sentences = _splitEvidenceSentences(content);
  if (!sentences.length) return String(content || "").trim();
  var tokens = _expandedEvidenceTokens(query, intent);
  var scored = [];
  for (var i = 0; i < sentences.length; i++) {
    var score = _scoreEvidenceSentence(sentences[i], tokens);
    if (score > 0) scored.push({ idx: i, score: score, text: sentences[i] });
  }
  if (!scored.length) {
    return sentences.slice(0, 2).join(" ").slice(0, 500).trim();
  }
  scored.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.idx - b.idx;
  });
  var specificPricing = _looksSpecificQuery(query, ["bar", "catering", "site fee", "site fees", "buyout", "accommodation"]);
  var limit = (intent === "pricing" && !specificPricing) ? 3 : 1;
  var picked = scored.slice(0, limit);
  picked.sort(function (a, b) { return a.idx - b.idx; });
  return picked.map(function (p) { return p.text; }).join(" ").slice(0, 700).trim();
}

// Reciprocal Rank Fusion. Identical formula to the current __dqaRRF.
function rrf(tier1List, tier3List) {
  var bag = {};
  for (var i = 0; i < tier1List.length; i++) {
    var key = "t1:" + ((tier1List[i].qa && (tier1List[i].qa.id || tier1List[i].qa.field)) || i);
    bag[key] = { kind: "tier1", rank: i, score: 1 / (RRF_K + i), item: tier1List[i] };
  }
  for (var j = 0; j < tier3List.length; j++) {
    var k2 = "t3:" + (tier3List[j].id || j);
    bag[k2] = { kind: "tier3", rank: j, score: 1 / (RRF_K + j), item: tier3List[j] };
  }
  var arr = [];
  for (var key2 in bag) {
    if (Object.prototype.hasOwnProperty.call(bag, key2)) arr.push(bag[key2]);
  }
  arr.sort(function (a, b) { return b.score - a.score; });
  return arr;
}

// Exact/action answer resolution. Called before any embedding.
// Returns { path, text, sourceLabel, href } | null.
function resolveAction(brain, intent) {
  if (!brain) return null;
  if (intent === "booking") {
    var href = (brain.actions && brain.actions.bookingUrl) || null;
    if (!href && brain.actions) href = brain.actions.officialWebsite;
    if (href) {
      return {
        path: "action",
        intent: intent,
        text: "You can book this property here: " + href,
        href: href,
        sourceLabel: "Booking",
      };
    }
    return null;
  }
  if (intent === "contact_agent") {
    var agent = brain.agent || {};
    var actions = brain.actions || {};
    var contactName = agent.name || "the property team";
    var email = agent.email || actions.email;
    var phone = agent.phone || actions.phone;
    if (email || phone) {
      var bits = [];
      if (email) bits.push("email " + email);
      if (phone) bits.push("call " + phone);
      return {
        path: "action",
        intent: intent,
        text: "You can reach " + contactName + ": " + bits.join(" or ") + ".",
        href: email ? ("mailto:" + email) : ("tel:" + phone),
        sourceLabel: "Contact",
      };
    }
    return null;
  }
  if (intent === "location") {
    var addr = brain.address;
    if (addr) {
      return {
        path: "action",
        intent: intent,
        text: "It's located at " + addr + ".",
        href: brain.actions && brain.actions.directionsUrl,
        sourceLabel: "Directions",
      };
    }
    return null;
  }
  if (intent === "neighborhood") {
    var mapUrl = brain.actions && brain.actions.neighborhoodMapUrl;
    // Look for neighborhood-tagged fields too.
    var fields = brain.fields || {};
    var keys = Object.keys(fields);
    for (var i = 0; i < keys.length; i++) {
      if (/^(neighborhood|area|district|nearby|local_area)/.test(keys[i].toLowerCase())) {
        var val = fields[keys[i]];
        if (val != null && String(val).trim()) {
          return {
            path: "action",
            intent: intent,
            text: String(val),
            href: mapUrl,
            sourceLabel: keys[i],
          };
        }
      }
    }
    if (mapUrl) {
      return {
        path: "action",
        intent: intent,
        text: "See the neighborhood map for what's nearby.",
        href: mapUrl,
        sourceLabel: "Directions",
      };
    }
    return null;
  }
  return null;
}

// Tier 1 — canonical-QA scoring with intent filter.
// Returns sorted array of {qa, score} above the hard floor.
function tier1Rank(queryVec, query, canonicalQAs, intent, intentAllowsFn) {
  if (!canonicalQAs || !canonicalQAs.length) return [];
  var tokens = _queryTokens(query);
  var scored = [];
  for (var i = 0; i < canonicalQAs.length; i++) {
    var qa = canonicalQAs[i];
    if (!qa) continue;
    // Intent filter: if this query has a non-unknown intent and the
    // QA's field is disqualified for it, drop it entirely.
    if (intent && intent !== "unknown" && qa.field && intentAllowsFn) {
      if (!intentAllowsFn(qa.field, intent)) continue;
    }
    // Score: cosine when we have an embedding + query vector, else
    // fall back to a lexical-only score (tokens + field match).
    var s;
    if (Array.isArray(qa.embedding) && Array.isArray(queryVec)) {
      s = _dot(queryVec, qa.embedding);
    } else {
      s = 0;
      // Lexical floor: match query tokens against the question text.
      var qwords = _queryTokens(qa.question || "");
      var overlap = 0, total = 0;
      for (var t in tokens) {
        if (Object.prototype.hasOwnProperty.call(tokens, t)) {
          total++;
          if (qwords[t]) overlap++;
        }
      }
      if (total) s = 0.40 + 0.30 * (overlap / total); // crude but deterministic
    }
    if (_fieldMatchesTokens(qa.field, tokens)) s += TIER1_FIELD_BOOST;
    if (s >= TIER1_FLOOR) scored.push({ qa: qa, score: s });
  }
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored;
}

// Curated-QA filter that post-filters hits returned by an Orama-style
// searcher. Applied when the search result's QA has a field or an
// anchor-id that can be mapped to a field name. When no field is
// available we keep the hit (curated answers are often intent-agnostic).
function curatedFilter(hits, intent, intentAllowsFn) {
  if (!hits || !hits.length) return [];
  if (!intent || intent === "unknown" || !intentAllowsFn) return hits.slice();
  var out = [];
  for (var i = 0; i < hits.length; i++) {
    var h = hits[i];
    var key = (h.field || h.source_anchor_id || "").toString().toLowerCase();
    if (!key) { out.push(h); continue; }
    // Normalize anchor ids like "property-address" to "property_address".
    var normalized = key.replace(/[^a-z0-9_]+/g, "_");
    if (intentAllowsFn(normalized, intent)) out.push(h);
  }
  return out;
}

// Intent-aware chunk rescoring. Boosts chunks whose section matches
// the intent; penalizes (does NOT eliminate) chunks whose section is
// explicitly excluded by the intent.
function rescoreChunksByIntent(chunks, intent, intentAllowsFn) {
  if (!chunks || !chunks.length) return [];
  if (!intent || intent === "unknown" || !intentAllowsFn) return chunks.slice();
  var out = [];
  for (var i = 0; i < chunks.length; i++) {
    var c = chunks[i];
    var section = String(c.source || c.section || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    if (!section) { out.push(c); continue; }
    var allowed = intentAllowsFn(section, intent);
    var newScore = Number(c.score || 0);
    if (allowed) newScore += 0.05;
    else newScore -= 0.10;
    out.push({
      id: c.id,
      source: c.source,
      section: c.section || c.source,
      content: c.content,
      templateLabel: c.templateLabel,
      score: newScore,
      _intentAllowed: allowed,
    });
  }
  out.sort(function (a, b) { return b.score - a.score; });
  return out;
}

// Assemble synthesis chunks: tier-3 (doc chunks) first, then tier-1
// canonical hints. Dedupe by id. Caps at 5 (current synthesize-answer
// limit).
function assembleSynthChunks(tier3, tier1) {
  var out = [];
  var seen = {};
  function pushOne(o) {
    if (!o || !o.id) return;
    if (seen[o.id]) return;
    seen[o.id] = true;
    out.push(o);
  }
  for (var i = 0; i < tier3.length && out.length < 5; i++) {
    var t3 = tier3[i];
    pushOne({
      id: t3.id,
      section: t3.source || t3.section || "",
      content: t3.content || "",
      score: t3.score,
    });
  }
  for (var j = 0; j < tier1.length && out.length < 5; j++) {
    var tqa = tier1[j].qa;
    if (!tqa) continue;
    pushOne({
      id: tqa.id || tqa.field || ("t1-" + j),
      section: tqa.source_anchor_id || tqa.field || "canonical",
      content: (tqa.question || "") + " " + (tqa.answer || ""),
      score: tier1[j].score,
    });
  }
  return out;
}

// Main orchestrator. Returns a plain-data decision; the caller renders.
//
// inputs = {
//   brain,             // PropertyBrain
//   query,             // raw string
//   queryVec,          // number[] | null
//   intent,            // string
//   intentAllows,      // (field, intent) -> boolean
//   curatedHits,       // optional: Orama-ranked curated hits, pre-fetched
//   chunkHits,         // optional: Orama-ranked chunk hits, pre-fetched
//   canSynthesize,     // boolean: is __SYNTHESIS_URL__ available?
// }
//
// output = {
//   path,              // "action" | "canonical" | "curated" | "chunk" | "synthesis" | "strict_unknown" | "unknown"
//   text,              // string — what to render (or empty when synthesis is driving)
//   intent,
//   strictUnknown,     // boolean
//   needsSynthesis,    // boolean
//   synthChunks,       // array — passed to the fetch body
//   sourceLabel,       // optional
//   anchorId,          // optional (curated wins)
//   href,              // optional (action hits)
// }
function decideAnswer(inputs) {
  var brain = inputs.brain || {};
  var query = inputs.query || "";
  var queryVec = inputs.queryVec || null;
  var intent = inputs.intent || "unknown";
  var intentAllowsFn = inputs.intentAllows;
  var curatedHits = inputs.curatedHits || [];
  var chunkHits = inputs.chunkHits || [];
  var canSynthesize = !!inputs.canSynthesize;

  // Step 1 — exact/action path (pre-embedding).
  if (intent === "booking" || intent === "contact_agent" || intent === "location" || intent === "neighborhood") {
    var action = resolveAction(brain, intent);
    if (action) {
      return {
        path: "action",
        text: action.text,
        intent: intent,
        strictUnknown: false,
        needsSynthesis: false,
        synthChunks: [],
        sourceLabel: action.sourceLabel,
        href: action.href || null,
      };
    }
    // Action intent matched but data missing → strict unknown. Do not
    // fall through to semantic tiers (which would produce adjacency
    // garbage like "number_of_rooms" for a booking query).
    return {
      path: "strict_unknown",
      text: ACTION_MISS_COPY[intent] || STRICT_UNKNOWN_COPY,
      intent: intent,
      strictUnknown: true,
      needsSynthesis: false,
      synthChunks: [],
    };
  }

  // Step 3 — Tier 1 canonical-QA with intent guard.
  var tier1 = tier1Rank(queryVec, query, (brain.canonicalQAs || []), intent, intentAllowsFn);
  var tier1Best = tier1.length ? tier1[0] : null;
  // Soft-floor acceptance: for value-bearing intents we trust the
  // intentAllows filter that tier1Rank already applied. Anything still
  // in the list is a category-correct candidate, so accept above the
  // hard floor (TIER1_FLOOR) instead of TIER1_SOFT. For everything
  // else we keep the stricter SOFT threshold.
  var t1Threshold = (VALUE_BEARING_INTENTS[intent] ? TIER1_FLOOR : TIER1_SOFT);
  if (tier1Best && tier1Best.score >= t1Threshold) {
    return {
      path: "canonical",
      text: tier1Best.qa.answer || "",
      intent: intent,
      strictUnknown: false,
      needsSynthesis: false,
      synthChunks: [],
      sourceLabel: tier1Best.qa.source_anchor_id || tier1Best.qa.field || null,
    };
  }

  // Step 3.5 — raw-chunk direct escalation. Only triggers when:
  //   - canonical missed the soft floor (or returned nothing), AND
  //   - a chunk classified as `raw_chunk` (or with kind unset, for
  //     legacy rows that pre-date Phase A) scored above the direct
  //     floor AND is intent-allowed.
  // This deliberately runs BEFORE curated/synthesis so we get the
  // cost-control win without breaking the curated tier when curated
  // has a stronger semantic match. We bias toward synthesis whenever
  // the chunk score is in the borderline band by setting the floor
  // tighter than TIER1_SOFT.
  if (chunkHits && chunkHits.length) {
    var bestRaw = null;
    for (var rc = 0; rc < chunkHits.length; rc++) {
      var hit = chunkHits[rc];
      if (!hit) continue;
      var hitKind = hit.kind || "raw_chunk"; // legacy rows -> raw_chunk
      if (hitKind !== "raw_chunk") continue;
      if (Number(hit.score || 0) < RAW_CHUNK_DIRECT_FLOOR) continue;
      // Respect intent allow-list if the section can be classified.
      if (intentAllowsFn && intent && intent !== "unknown") {
        var sect = String(hit.section || hit.source || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_");
        if (sect && !intentAllowsFn(sect, intent)) continue;
      }
      bestRaw = hit;
      break;
    }
    if (bestRaw) {
      return {
        path: "chunk",
        text: extractiveChunkAnswer(query, bestRaw.content || "", intent),
        intent: intent,
        strictUnknown: false,
        needsSynthesis: false,
        synthChunks: [],
        sourceLabel: bestRaw.source || bestRaw.section || null,
      };
    }
  }

  // Step 4 — Tier 2 curated hybrid search (caller supplied hits).
  var curatedFiltered = curatedFilter(curatedHits, intent, intentAllowsFn);
  var tier2Best = null;
  for (var c = 0; c < curatedFiltered.length; c++) {
    var ch = curatedFiltered[c];
    if (Number(ch.score || 0) >= TIER2_MIN) { tier2Best = ch; break; }
  }
  if (tier2Best) {
    return {
      path: "curated",
      text: tier2Best.answer || "",
      intent: intent,
      strictUnknown: false,
      needsSynthesis: false,
      synthChunks: [],
      anchorId: tier2Best.source_anchor_id || null,
    };
  }

  // Step 5 — Tier 3 chunk rescoring.
  var chunksRescored = rescoreChunksByIntent(chunkHits, intent, intentAllowsFn);

  var hasIntent = intent && intent !== "unknown";
  var allowedChunks = [];
  for (var k = 0; k < chunksRescored.length; k++) {
    if (chunksRescored[k]._intentAllowed !== false) allowedChunks.push(chunksRescored[k]);
  }

  // Category-wrong-adjacency guard: when we have a classified intent but
  // NO chunks survived the allow-list AND tier1 produced nothing, prefer
  // strict unknown over leaking a nearby chunk. This is the explicit
  // anti-pattern the spec calls out ("prefer 'I don't know' over wrong
  // adjacency").
  if (hasIntent && allowedChunks.length === 0 && tier1.length === 0) {
    return {
      path: "strict_unknown",
      text: VALUE_INTENT_MISS_COPY[intent] || STRICT_UNKNOWN_COPY,
      intent: intent,
      strictUnknown: true,
      needsSynthesis: false,
      synthChunks: [],
    };
  }

  // When intent is unknown we deliberately fall back to unfiltered
  // chunks to preserve pre-refactor behavior (conservative soft-miss).
  var synthSource = hasIntent ? allowedChunks : chunksRescored;

  // Step 6 — Intent-gated synthesis. Only fire when:
  //  - synthesis endpoint is available,
  //  - we have at least one intent-allowed chunk (or intent is unknown),
  //  - at least one chunk survived.
  if (canSynthesize && synthSource.length > 0) {
    var synthChunks = assembleSynthChunks(synthSource, tier1);
    if (synthChunks.length > 0) {
      return {
        path: "synthesis",
        text: "",
        intent: intent,
        strictUnknown: false,
        needsSynthesis: true,
        synthChunks: synthChunks,
      };
    }
  }

  // Step 7 — RRF fallback on intent-filtered tiers (or all tiers when
  // intent is unknown).
  var fusionTier3 = hasIntent ? allowedChunks : chunksRescored;
  var fused = rrf(tier1, fusionTier3);
  if (fused.length > 0) {
    var top = fused[0];
    if (top.kind === "tier1") {
      var qa = top.item.qa;
      return {
        path: "canonical",
        text: qa.answer || "",
        intent: intent,
        strictUnknown: false,
        needsSynthesis: false,
        synthChunks: [],
        sourceLabel: qa.source_anchor_id || qa.field || null,
      };
    }
    var chunk = top.item;
    return {
      path: "chunk",
      text: extractiveChunkAnswer(query, chunk.content || "", intent),
      intent: intent,
      strictUnknown: false,
      needsSynthesis: false,
      synthChunks: [],
      sourceLabel: chunk.source || chunk.section || null,
    };
  }

  // Step 8 — nothing. Strict unknown.
  return {
    path: "strict_unknown",
    text: STRICT_UNKNOWN_COPY,
    intent: intent,
    strictUnknown: true,
    needsSynthesis: false,
    synthChunks: [],
  };
}

export {
  TIER1_SOFT,
  TIER1_FLOOR,
  TIER1_FIELD_BOOST,
  TIER2_MIN,
  RAW_CHUNK_DIRECT_FLOOR,
  RRF_K,
  ACTION_MISS_COPY,
  STRICT_UNKNOWN_COPY,
  rrf,
  resolveAction,
  tier1Rank,
  curatedFilter,
  rescoreChunksByIntent,
  assembleSynthChunks,
  extractiveChunkAnswer,
  decideAnswer,
};
