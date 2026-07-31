import { fromZonedTime } from 'date-fns-tz';

/**
 * Compute the next "Monday 09:00 local" UTC instant for a given IANA timezone.
 * Returns a Date whose `getTime()` is the UTC epoch at which the local wall
 * clock in `timezone` reads Monday 09:00 on the next upcoming Monday
 * (strictly > `from`).
 */
export function nextMondayNineAM(timezone: string, from: Date = new Date()): Date {
  // Search forward up to 8 days; a 9-day window always contains a Monday whose
  // 09:00 local is strictly after `from`.
  for (let i = 0; i < 9; i += 1) {
    const probe = new Date(from.getTime() + i * 86_400_000);
    const candidate = buildLocalWallClock(localCalendarDate(probe, timezone), timezone);
    if (candidate.getTime() <= from.getTime()) continue;
    // Check that in the target timezone, this instant is a Monday.
    if (isMondayInTZ(candidate, timezone)) return candidate;
  }
  // Unreachable given the 9-day window. Throwing beats the old fallback, which
  // returned 1 Jan of the following year — a "valid" Date that would have
  // silently parked the store's digest ~9 months out instead of failing loudly.
  throw new Error(
    `nextMondayNineAM: no Monday 09:00 found within 9 days of ${from.toISOString()} for ${timezone}`,
  );
}

/**
 * The calendar date (YYYY-MM-DD) that `instant` falls on *in `timezone`*.
 *
 * This has to be the timezone-local date rather than the UTC one: for an IST
 * store an instant at 22:00 UTC is already the next day locally, so iterating
 * on UTC dates can land the digest on the wrong local day.
 *
 * 'en-CA' is used only because it formats as ISO-style YYYY-MM-DD.
 */
function localCalendarDate(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * The real UTC instant at which the wall clock in `timezone` reads
 * `<isoDate> 09:00`.
 *
 * `fromZonedTime` is deliberately handed a STRING. Given a Date it reads that
 * Date's *local* (host-machine) field values, so building the input with
 * `Date.UTC(...)` offset every result by the host's own UTC offset — on an IST
 * dev machine every digest came out 5h30m late, while a UTC server showed no
 * symptom at all. A string is host-timezone independent.
 */
function buildLocalWallClock(isoDate: string, timezone: string): Date {
  return fromZonedTime(`${isoDate}T09:00:00`, timezone);
}

function isMondayInTZ(utcInstant: Date, timezone: string): boolean {
  // Use Intl with timezone to get the local weekday.
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(utcInstant);
  return weekday === 'Mon';
}
