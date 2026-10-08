// Local calendar dates in the user's timezone. The prototype used the UTC date
// (toISOString().slice(0, 10)); production keys streaks, daily stats and quota periods by the
// user's tz. 'en-CA' formats as YYYY-MM-DD.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(tz, f);
  }
  return f;
}

/** YYYY-MM-DD in `tz` at instant `ms`. Throws RangeError for an unknown tz. */
export function localDate(tz: string, ms: number): string {
  const parts = formatter(tz).formatToParts(new Date(ms));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Calendar day before a YYYY-MM-DD date. */
export function previousDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Local date of the day before `ms` in `tz` (calendar arithmetic, safe across DST). */
export function yesterday(tz: string, ms: number): string {
  return previousDate(localDate(tz, ms));
}

/** Quota period YYYY-MM in `tz`. */
export function period(tz: string, ms: number): string {
  return localDate(tz, ms).slice(0, 7);
}

/** Day of the month of a YYYY-MM-DD date. */
export function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

/** True when `tz` is an IANA zone this runtime knows. */
export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}
