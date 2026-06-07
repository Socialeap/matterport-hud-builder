// Pure logic for the Atlas install promotion — engagement gating, dismiss
// cooldown, and platform branch. No DOM/React here so it is unit-testable
// (tests/pwa-install.test.mjs); the React component layers UI on top.
//
// Storage is a versioned localStorage key (passed in, so tests inject a
// fake). We persist only non-sensitive counters/timestamps — never tokens,
// PINs, or user data.

var STORAGE_KEY = "f3d_pwa_install_v1";
var DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
var RETURN_VISIT_THRESHOLD = 2; // promotion may show from the 2nd visit

function _read(storage) {
  try {
    if (!storage) return {};
    var raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_e) {
    return {};
  }
}

function _write(storage, state) {
  try {
    if (!storage) return;
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_e) {
    // storage full / unavailable / private mode — promotion is optional
  }
}

// Record a launch/visit. Call once per Atlas session load. Returns the new
// visit count.
function recordVisit(storage) {
  var state = _read(storage);
  state.visits = (typeof state.visits === "number" ? state.visits : 0) + 1;
  _write(storage, state);
  return state.visits;
}

// Record meaningful engagement (a presentation modal was opened). This is
// the strongest "interested" signal and unlocks promotion this session.
function recordEngagement(storage) {
  var state = _read(storage);
  state.engaged = true;
  _write(storage, state);
}

// Remember a dismissal so we honor the cooldown.
function recordDismissal(storage, now) {
  var state = _read(storage);
  state.dismissedAt = typeof now === "number" ? now : 0;
  _write(storage, state);
}

function isInCooldown(storage, now) {
  var state = _read(storage);
  if (typeof state.dismissedAt !== "number" || state.dismissedAt <= 0) return false;
  var ts = typeof now === "number" ? now : 0;
  return ts - state.dismissedAt < DISMISS_COOLDOWN_MS;
}

// Decide whether the install promotion may be shown.
//   opts.standalone   — already installed/standalone → never show
//   opts.engagedNow   — a presentation was opened this session
//   opts.now          — current epoch ms (for the cooldown check)
// Shows when: not standalone, not in cooldown, AND (engaged this session
// OR engaged previously OR a return visit). Never on first cold load with
// zero engagement.
function shouldPromote(storage, opts) {
  var o = opts || {};
  if (o.standalone === true) return false;
  if (isInCooldown(storage, o.now)) return false;
  var state = _read(storage);
  var engaged = o.engagedNow === true || state.engaged === true;
  var returning = (typeof state.visits === "number" ? state.visits : 0) >= RETURN_VISIT_THRESHOLD;
  return engaged || returning;
}

export {
  STORAGE_KEY,
  DISMISS_COOLDOWN_MS,
  RETURN_VISIT_THRESHOLD,
  recordVisit,
  recordEngagement,
  recordDismissal,
  isInCooldown,
  shouldPromote,
};
