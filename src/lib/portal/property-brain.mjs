// Property Brain adapter. Composes a per-property knowledge projection
// at runtime from the already-injected window globals:
//   - window.__PROPERTY_EXTRACTIONS__  (per property_uuid: extraction rows)
//   - window.__QA_DATABASE__           (host-curated QAs, shared)
//   - the base64-decoded config        (properties[], agent, brand, etc.)
//
// This is a projection, not new data. Payload size of the generated HTML
// is unchanged. Rebuilt on tab change; cached by the IIFE caller.
//
// Same rules as ask-intents.mjs: no imports, no TS syntax.

function _firstNonEmpty(/* any number of values */) {
  for (var i = 0; i < arguments.length; i++) {
    var v = arguments[i];
    if (v == null) continue;
    if (typeof v === "string") {
      var s = v.trim();
      if (s) return s;
    } else if (typeof v === "number" && isFinite(v)) {
      return v;
    } else if (Array.isArray(v) && v.length) {
      return v;
    } else if (typeof v === "object" && Object.keys(v).length) {
      return v;
    }
  }
  return null;
}

function _toNumber(v) {
  if (v == null) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  var n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : null;
}

function _splitNames(v) {
  if (v == null) return [];
  if (Array.isArray(v)) {
    var out = [];
    for (var i = 0; i < v.length; i++) {
      if (v[i] == null) continue;
      var s = typeof v[i] === "string" ? v[i] : String(v[i]);
      s = s.trim();
      if (s) out.push(s);
    }
    return out;
  }
  if (typeof v === "string") {
    return v.split(/[,;\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  return [];
}

function _mergeFields(entries) {
  var merged = {};
  for (var e = 0; e < entries.length; e++) {
    var f = (entries[e] && entries[e].fields) || {};
    var keys = Object.keys(f);
    for (var k = 0; k < keys.length; k++) {
      // First-wins merge — higher-priority extractions are injected first.
      // (extractions ordering matches the order of loadExtractionsByProperty.)
      if (merged[keys[k]] == null) merged[keys[k]] = f[keys[k]];
    }
  }
  return merged;
}

function _mergeProvenance(entries) {
  var out = [];
  for (var e = 0; e < entries.length; e++) {
    var p = entries[e] && entries[e].field_provenance;
    if (p && typeof p === "object") out.push(p);
  }
  return out;
}

function _collectCanonicalQAs(entries, tagIntentsFn) {
  var out = [];
  for (var e = 0; e < entries.length; e++) {
    var qas = (entries[e] && entries[e].canonical_qas) || [];
    for (var q = 0; q < qas.length; q++) {
      var it = qas[q];
      if (!it) continue;
      var intents = tagIntentsFn ? tagIntentsFn(it) : [];
      out.push({
        id: it.id || (it.field ? "field:" + it.field : ""),
        field: it.field || "",
        question: it.question || "",
        answer: it.answer || "",
        source_anchor_id: it.source_anchor_id || "",
        embedding: Array.isArray(it.embedding) ? it.embedding : null,
        intents: intents,
      });
    }
    var candidateQAs = _collectCandidateQAs(entries[e], tagIntentsFn);
    for (var cq = 0; cq < candidateQAs.length; cq++) out.push(candidateQAs[cq]);
  }
  return out;
}

function _humanizeFieldName(field) {
  return String(field || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

function _candidateQuestions(field) {
  var label = _humanizeFieldName(field);
  if (!label) return [];
  var out = [
    "What is the " + label + "?",
    "What's the " + label + "?",
    "Tell me about the " + label + ".",
    label.charAt(0).toUpperCase() + label.slice(1) + "?",
  ];
  var lower = String(field || "").toLowerCase();
  if (/price|cost|fee|rate|rent|tax|noi|cap_rate|payment|charge/.test(lower)) {
    out.push(
      "How much is the " + label + "?",
      "How much does the " + label + " cost?",
      "What's the cost?"
    );
  }
  if (/size|area|sqft|square|acre|height|frontage|width|depth/.test(lower)) {
    out.push(
      "How big is the " + label + "?",
      "What's the size?",
      "What are the dimensions?"
    );
  }
  if (/capacity|occupancy|guest|seat|people|unit|room|bed|bath|parking|space|dock|door|loading/.test(lower)) {
    out.push(
      "How many " + label + "?",
      "How many " + label + " are there?",
      "What's the " + label + " count?",
      "What's the capacity?"
    );
  }
  return out;
}

function _formatCandidateAnswer(field, value, evidence, confidence) {
  var label = _humanizeFieldName(field);
  var raw = (typeof value === "object") ? JSON.stringify(value) : String(value);
  var answer = label ? ("The " + label + " is " + raw + ".") : raw;
  if (evidence && typeof evidence === "string") {
    var ev = evidence.trim().replace(/\s+/g, " ");
    if (ev && ev.length <= 180 && answer.toLowerCase().indexOf(ev.toLowerCase()) < 0) {
      answer += " Source note: " + ev;
    }
  }
  if (typeof confidence === "number" && confidence < 0.85) {
    answer = "The documents indicate that " + answer.charAt(0).toLowerCase() + answer.slice(1);
  }
  return answer;
}

function _collectCandidateQAs(entry, tagIntentsFn) {
  var candidates = (entry && entry.candidate_fields) || [];
  if (!Array.isArray(candidates) || !candidates.length) return [];
  var out = [];
  var seen = {};
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    if (!c || typeof c !== "object") continue;
    var field = typeof c.key === "string" ? c.key.trim() : "";
    if (!/^[a-z][a-z0-9_]*$/.test(field)) continue;
    var value = c.value;
    if (value == null || value === "" || typeof value === "object") continue;
    var confidence = typeof c.confidence === "number" ? c.confidence : 0;
    // Medium-confidence candidates are useful, but only when there is
    // enough confidence to beat raw prose. Lower values stay out of the
    // visitor-facing answer path and remain available to builder UI.
    if (confidence < 0.72) continue;
    var questions = _candidateQuestions(field);
    var answer = _formatCandidateAnswer(field, value, c.evidence, confidence);
    var intents = tagIntentsFn ? tagIntentsFn({ field: field }) : [];
    for (var q = 0; q < questions.length; q++) {
      var question = questions[q];
      var key = field + "::" + question.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      out.push({
        id: "candidate:" + field + ":" + q,
        field: field,
        question: question,
        answer: answer,
        source_anchor_id: "candidate:" + field,
        embedding: null,
        intents: intents,
      });
    }
  }
  return out;
}

function _collectChunks(entries) {
  var out = [];
  for (var e = 0; e < entries.length; e++) {
    var entry = entries[e] || {};
    var label = entry.template_label || "Document";
    var chunks = entry.chunks || [];
    for (var c = 0; c < chunks.length; c++) {
      var ch = chunks[c];
      if (!ch) continue;
      out.push({
        id: (ch.id ? String(ch.id) : ("chunk-" + e + "-" + c)),
        section: ch.section || "section",
        content: String(ch.content || ""),
        embedding: Array.isArray(ch.embedding) ? ch.embedding : null,
        templateLabel: label,
        // Phase A — propagate metadata when present. Old chunks omit it
        // and the runtime treats missing `kind` as `raw_chunk`.
        kind: (ch.kind === "raw_chunk" || ch.kind === "field_chunk") ? ch.kind : undefined,
        source: (typeof ch.source === "string" && ch.source) ? ch.source : undefined,
      });
    }
  }
  return out;
}

function _resolveAddress(configPropertyEntry, fields) {
  var cp = configPropertyEntry || {};
  var nameAsAddress = _looksLikeStreetAddress(cp.name) ? cp.name : null;
  // Preference: explicit extracted/user address fields -> address-like
  // property.name fallback -> broad location. Some builder flows store
  // the full street address in `name` and only "City, ST" in location.
  return _firstNonEmpty(
    fields.address,
    fields.property_address,
    fields.street_address,
    cp.address,
    cp.streetAddress,
    nameAsAddress,
    cp.location,
    fields.location
  );
}

function _looksLikeStreetAddress(v) {
  if (typeof v !== "string") return false;
  var s = v.trim();
  return /\b\d{1,6}\s+[A-Za-z0-9]/.test(s) && /,\s*[A-Z]{2}\b|[A-Z]{2}\s+\d{5}\b/i.test(s);
}

function _directionsUrl(address) {
  if (!address || typeof address !== "string") return null;
  return "https://maps.google.com/maps?q=" + encodeURIComponent(address);
}

function _pickUrl(fields, keys) {
  for (var i = 0; i < keys.length; i++) {
    var v = fields[keys[i]];
    if (typeof v === "string") {
      var s = v.trim();
      if (s) {
        if (/^https?:\/\//i.test(s)) return s;
        if (/^www\./i.test(s)) return "https://" + s;
      }
    }
  }
  return null;
}

function _pickPhone(fields, agent) {
  var keys = ["phone_number", "reservations_phone", "contact_phone", "phone", "telephone"];
  for (var i = 0; i < keys.length; i++) {
    var v = fields[keys[i]];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (agent && typeof agent.phone === "string" && agent.phone.trim()) return agent.phone.trim();
  return null;
}

function _pickEmail(fields, agent) {
  var keys = ["email", "contact_email", "reservations_email"];
  for (var i = 0; i < keys.length; i++) {
    var v = fields[keys[i]];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (agent && typeof agent.email === "string" && agent.email.trim()) return agent.email.trim();
  return null;
}

function _buildEntities(fields) {
  var restaurantNames = _splitNames(
    fields.restaurants != null
      ? fields.restaurants
      : (fields.restaurant_names != null ? fields.restaurant_names : fields.dining_options)
  );
  var ballroomNames = _splitNames(
    fields.ballrooms != null
      ? fields.ballrooms
      : (fields.ballroom_names != null ? fields.ballroom_names : fields.event_spaces)
  );
  var amenityNames = _splitNames(
    fields.amenities != null
      ? fields.amenities
      : (fields.amenity_list != null
        ? fields.amenity_list
        : (fields.features_list != null ? fields.features_list : fields.facilities))
  );

  var restaurants = [];
  for (var i = 0; i < restaurantNames.length; i++) {
    var rn = restaurantNames[i];
    var floorKey = "restaurant_" + rn.toLowerCase().replace(/[^a-z0-9]+/g, "_") + "_floor";
    restaurants.push({
      name: rn,
      floor: (fields[floorKey] != null ? String(fields[floorKey]) : (fields.restaurant_floor != null ? String(fields.restaurant_floor) : null)),
      raw: rn,
    });
  }
  var ballrooms = [];
  for (var j = 0; j < ballroomNames.length; j++) {
    ballrooms.push({ name: ballroomNames[j], capacity: null, raw: ballroomNames[j] });
  }
  var amenities = [];
  for (var k = 0; k < amenityNames.length; k++) {
    amenities.push({ name: amenityNames[k], raw: amenityNames[k] });
  }

  var roomsCount = _toNumber(
    fields.number_of_rooms != null
      ? fields.number_of_rooms
      : (fields.rooms != null ? fields.rooms : fields.guest_rooms)
  );
  var floorsCount = _toNumber(
    fields.number_of_floors != null
      ? fields.number_of_floors
      : (fields.floors != null ? fields.floors : fields.stories)
  );

  return {
    restaurants: restaurants,
    ballrooms: ballrooms,
    amenities: amenities,
    rooms: roomsCount != null
      ? { count: roomsCount, raw: fields.number_of_rooms != null ? fields.number_of_rooms : fields.rooms }
      : null,
    floors: floorsCount != null
      ? { count: floorsCount, raw: fields.number_of_floors != null ? fields.number_of_floors : fields.floors }
      : null,
  };
}

function buildPropertyBrain(inputs) {
  // inputs = {
  //   propertyIndex: number,
  //   propertyUuid: string | null,
  //   configProperty: object | null,     // C.properties[i]
  //   agent: object,                     // C.agent
  //   brandName: string,
  //   extractionEntries: array,          // extractions filtered to this property
  //   curatedQAs: array,                 // window.__QA_DATABASE__
  //   hasDocs: boolean,
  //   hasQA: boolean,
  //   tagIntents: function               // ask-intents.tagQAIntents
  // }
  var cp = inputs.configProperty || {};
  var agent = inputs.agent || {};
  var extractionEntries = inputs.extractionEntries || [];
  var fields = _mergeFields(extractionEntries);
  var fieldProvenance = _mergeProvenance(extractionEntries);
  var canonicalQAs = _collectCanonicalQAs(extractionEntries, inputs.tagIntents);
  var chunks = _collectChunks(extractionEntries);

  var address = _resolveAddress(cp, fields);
  var directionsUrl = _directionsUrl(address);

  var bookingUrl = _pickUrl(fields, [
    "booking_url", "reservation_url", "reserve_url", "book_now_url",
  ]);
  var officialWebsite = _pickUrl(fields, [
    "official_website", "website", "url", "homepage",
  ]);
  if (!officialWebsite && typeof agent.website === "string" && agent.website.trim()) {
    // Last-resort fallback — agent website is NOT the property's, so we
    // only use it when nothing else is available.
    officialWebsite = agent.website.trim();
  }
  var phone = _pickPhone(fields, agent);
  var email = _pickEmail(fields, agent);

  var templateLabels = [];
  for (var te = 0; te < extractionEntries.length; te++) {
    var lbl = extractionEntries[te] && extractionEntries[te].template_label;
    if (lbl && templateLabels.indexOf(lbl) === -1) templateLabels.push(lbl);
  }

  return {
    propertyIndex: inputs.propertyIndex,
    propertyUuid: inputs.propertyUuid || null,
    propertyName: (cp.propertyName || cp.name || "property"),
    tourName: inputs.brandName || "",
    // Reserved for PR-2 (backend cache + token). Do not populate here.
    sourceContextHash: null,
    presentationToken: null,
    address: address || null,
    directionsUrl: directionsUrl,
    neighborhoodEnabled: !!cp.enableNeighborhoodMap,
    agent: {
      name: (typeof agent.name === "string" && agent.name.trim()) ? agent.name.trim() : null,
      titleRole: (typeof agent.titleRole === "string" && agent.titleRole.trim()) ? agent.titleRole.trim() : null,
      email: (typeof agent.email === "string" && agent.email.trim()) ? agent.email.trim() : null,
      phone: (typeof agent.phone === "string" && agent.phone.trim()) ? agent.phone.trim() : null,
      welcomeNote: (typeof agent.welcomeNote === "string" && agent.welcomeNote.trim()) ? agent.welcomeNote.trim() : null,
      website: (typeof agent.website === "string" && agent.website.trim()) ? agent.website.trim() : null,
      social: {
        linkedin: agent.linkedin || null,
        twitter: agent.twitter || null,
        instagram: agent.instagram || null,
        facebook: agent.facebook || null,
        tiktok: agent.tiktok || null,
      },
    },
    actions: {
      bookingUrl: bookingUrl,
      officialWebsite: officialWebsite,
      phone: phone,
      email: email,
      directionsUrl: directionsUrl,
      neighborhoodMapUrl: (cp.enableNeighborhoodMap && address) ? directionsUrl : null,
    },
    canonicalQAs: canonicalQAs,
    fields: fields,
    fieldProvenance: fieldProvenance,
    entities: _buildEntities(fields),
    chunks: chunks,
    curatedQAs: inputs.curatedQAs || [],
    hasDocs: !!inputs.hasDocs,
    hasQA: !!inputs.hasQA,
    extractionTemplates: templateLabels,
  };
}

export { buildPropertyBrain };
