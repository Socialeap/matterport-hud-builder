// =============================================================================
// Business-window response deadline
// =============================================================================
// The marketplace gives invited MSPs a "next business window" to respond
// Available / Not Available, instead of a rigid wall-clock SLA. This helper
// is the single source of truth on the client. The Postgres helper
// `public.compute_business_window_deadline(...)` mirrors this logic and is
// the authority used when writing `work_order_invites.respond_by`.
//
// Rules (MVP, no federal-holiday awareness):
//   * Mon-Thu before 2:00pm  -> deadline = same day 5:00pm
//   * Mon-Thu at/after 2:00pm -> deadline = next business day 12:00pm
//   * Fri before 2:00pm       -> deadline = Fri 5:00pm
//   * Fri at/after 2:00pm     -> deadline = following Monday 12:00pm
//   * Sat or Sun              -> deadline = Monday 12:00pm
//
// Holiday calendaring is a documented future enhancement.
// =============================================================================

export interface BusinessWindowOptions {
  /** IANA timezone for the property's market. Defaults to the platform default. */
  timeZone?: string;
  /** Reference "now". Defaults to `new Date()`. Useful in tests. */
  now?: Date;
}

/**
 * The platform default. Most MSPs and agents we serve are US East coast.
 * MVP only — a future enhancement may swap this per-MSP / per-property.
 */
export const DEFAULT_MARKETPLACE_TZ = "America/New_York";

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0..6, 0 = Sunday
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  // Intl gives us localized components without us having to ship a tz library.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayShort = get("weekday");
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    // Intl reports "24" for midnight under hour12:false on some runtimes; clamp.
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: weekdayMap[weekdayShort] ?? new Date(date).getUTCDay(),
  };
}

/**
 * Build a Date that represents `year/month/day @ hour:00` in the given IANA
 * timezone. We do this by guessing UTC, then correcting once we know the
 * offset at that instant.
 */
function makeZonedDate(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  timeZone: string,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, 0, 0, 0));
  const got = zonedParts(guess, timeZone);
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, 0, 0, 0);
  const gotAsUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, 0, 0);
  const offset = desiredAsUtc - gotAsUtc;
  return new Date(guess.getTime() + offset);
}

function addDaysZoned(
  parts: Pick<ZonedParts, "year" | "month" | "day">,
  days: number,
  timeZone: string,
): Pick<ZonedParts, "year" | "month" | "day" | "weekday"> {
  const seed = makeZonedDate(parts.year, parts.month, parts.day, 12, timeZone);
  const next = new Date(seed.getTime() + days * 86_400_000);
  const p = zonedParts(next, timeZone);
  return { year: p.year, month: p.month, day: p.day, weekday: p.weekday };
}

function nextBusinessDay(
  parts: Pick<ZonedParts, "year" | "month" | "day" | "weekday">,
  timeZone: string,
): Pick<ZonedParts, "year" | "month" | "day" | "weekday"> {
  let cursor = parts;
  for (let i = 0; i < 8; i++) {
    cursor = addDaysZoned(cursor, 1, timeZone);
    if (cursor.weekday !== 0 && cursor.weekday !== 6) return cursor;
  }
  return cursor;
}

/**
 * Authoritative client-side deadline calculator. Mirrors the SQL helper.
 *
 * Naming alias: `getNextBusinessResponseDeadline` and `computeWorkOrderRespondBy`
 * are also exported as ergonomic synonyms.
 */
export function calculateBusinessResponseDeadline(
  options: BusinessWindowOptions = {},
): Date {
  const tz = options.timeZone ?? DEFAULT_MARKETPLACE_TZ;
  const now = options.now ?? new Date();
  const p = zonedParts(now, tz);

  const isWeekend = p.weekday === 0 || p.weekday === 6;
  const isFriday = p.weekday === 5;
  const before2pm = p.hour < 14;

  if (isWeekend) {
    const monday = nextBusinessDay(p, tz);
    return makeZonedDate(monday.year, monday.month, monday.day, 12, tz);
  }

  if (before2pm) {
    return makeZonedDate(p.year, p.month, p.day, 17, tz);
  }

  // After 2pm Mon-Fri -> next business day at 12pm.
  if (isFriday) {
    const monday = nextBusinessDay(p, tz);
    return makeZonedDate(monday.year, monday.month, monday.day, 12, tz);
  }
  const nextDay = nextBusinessDay(p, tz);
  return makeZonedDate(nextDay.year, nextDay.month, nextDay.day, 12, tz);
}

// Ergonomic aliases — products and emails can pick whichever name reads best.
export const getNextBusinessResponseDeadline = calculateBusinessResponseDeadline;
export const computeWorkOrderRespondBy = calculateBusinessResponseDeadline;

/**
 * Human-friendly description of a respond-by deadline, suitable for emails
 * and UI captions. e.g. "by Mon, May 19 · 12:00 PM"
 */
export function formatRespondByLabel(
  deadline: Date,
  timeZone: string = DEFAULT_MARKETPLACE_TZ,
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(deadline);
}
