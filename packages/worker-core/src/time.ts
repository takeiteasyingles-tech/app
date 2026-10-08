import { DEFAULT_TZ } from '@tie/shared';

// All stored timestamps are unix ms. Calendar math (streaks, daily stats, quota periods) happens in
// the user's IANA timezone via Intl.DateTimeFormat('en-CA'), which formats as YYYY-MM-DD.

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const now = (): number => Date.now();

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Falls back to America/Sao_Paulo for unknown zones. */
export function safeTimeZone(tz: string | null | undefined): string {
  return tz && isValidTimeZone(tz) ? tz : DEFAULT_TZ;
}

/** Local calendar date YYYY-MM-DD of `ms` in `tz`. */
export function localDate(ms: number, tz: string): string {
  const parts = formatter(safeTimeZone(tz)).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Quota period YYYY-MM in `tz`. */
export function period(ms: number, tz: string): string {
  return localDate(ms, tz).slice(0, 7);
}

/** Shift a YYYY-MM-DD date by whole days (pure calendar math, no timezone involved). */
export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) throw new RangeError(`invalid date: ${date}`);
  return new Date(t + days * DAY).toISOString().slice(0, 10);
}

/** Whole days from date `a` to date `b` (both YYYY-MM-DD); positive when b is later. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}
