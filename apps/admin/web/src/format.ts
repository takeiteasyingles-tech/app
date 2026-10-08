// pt-BR formatting for the panel. Dates show in São Paulo time, like every server-side "today".
const TZ = 'America/Sao_Paulo';

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: TZ });
const dateOnly = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: TZ });
const longDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short', timeZone: TZ });
const rel = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
const int = new Intl.NumberFormat('pt-BR');
const pct = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

export const fmtDateTime = (ms: number | null | undefined): string => (ms == null ? '—' : dateTime.format(ms));
export const fmtDate = (ms: number | null | undefined): string => (ms == null ? '—' : dateOnly.format(ms));
export const fmtLong = (ms: number | null | undefined): string => (ms == null ? '—' : longDate.format(ms));
export const fmtInt = (n: number | null | undefined): string => (n == null ? '—' : int.format(n));
export const fmtPct = (x: number): string => pct.format(x);

/** "há 5 minutos", "ontem", "em 3 dias". */
export function fmtAgo(ms: number | null | undefined, now = Date.now()): string {
  if (ms == null) return '—';
  const d = (ms - now) / 1000;
  const a = Math.abs(d);
  if (a < 45) return 'agora';
  if (a < 3600) return rel.format(Math.round(d / 60), 'minute');
  if (a < 86_400) return rel.format(Math.round(d / 3600), 'hour');
  if (a < 30 * 86_400) return rel.format(Math.round(d / 86_400), 'day');
  if (a < 365 * 86_400) return rel.format(Math.round(d / (30 * 86_400)), 'month');
  return rel.format(Math.round(d / (365 * 86_400)), 'year');
}

export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[u]}`;
}

/** 95_000 → "1:35"; 3_725_000 → "1:02:05". */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Seconds → "12 min" / "1 h 05 min". */
export function fmtMinutes(secs: number): string {
  const m = Math.ceil(secs / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** yyyy-mm-dd (São Paulo) for <input type=date>. */
export function toDateInput(ms: number | null | undefined): string {
  if (ms == null) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(ms)
    .slice(0, 10);
  return parts;
}

/** yyyy-mm-dd → end of that day in São Paulo (UTC-3, no DST since 2019), as unix ms. */
export function fromDateInputEnd(v: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return Date.parse(`${v}T23:59:59-03:00`);
}

/** yyyy-mm-dd → start of that day in São Paulo, as unix ms. */
export function fromDateInputStart(v: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return Date.parse(`${v}T00:00:00-03:00`);
}

export const plural = (n: number, one: string, many: string): string => `${fmtInt(n)} ${n === 1 ? one : many}`;
