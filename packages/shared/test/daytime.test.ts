import { describe, expect, it } from 'vitest';
import { dayOfMonth, isValidTimeZone, localDate, period, previousDate, yesterday } from '../src/domain/daytime';

describe('daytime', () => {
  it('localDate follows the user timezone, not UTC', () => {
    const t = Date.UTC(2026, 9, 7, 2, 30); // 2026-10-07 02:30 UTC
    expect(localDate('UTC', t)).toBe('2026-10-07');
    expect(localDate('America/Sao_Paulo', t)).toBe('2026-10-06');
    expect(localDate('Asia/Tokyo', t)).toBe('2026-10-07');
    expect(localDate('Pacific/Kiritimati', Date.UTC(2026, 11, 31, 11))).toBe('2027-01-01');
    expect(localDate('America/Los_Angeles', Date.UTC(2027, 0, 1, 5))).toBe('2026-12-31');
  });

  it('yesterday and previousDate use calendar arithmetic', () => {
    expect(previousDate('2026-03-01')).toBe('2026-02-28');
    expect(previousDate('2024-03-01')).toBe('2024-02-29');
    expect(previousDate('2026-01-01')).toBe('2025-12-31');
    // US DST starts 2026-03-08: the day before 03-09 local is still 03-08.
    expect(yesterday('America/New_York', Date.UTC(2026, 2, 9, 4, 30))).toBe('2026-03-08');
    expect(yesterday('America/Sao_Paulo', Date.UTC(2026, 9, 7, 2, 30))).toBe('2026-10-05');
  });

  it('period is YYYY-MM in the timezone', () => {
    expect(period('America/Sao_Paulo', Date.UTC(2026, 10, 1, 1))).toBe('2026-10');
    expect(period('UTC', Date.UTC(2026, 10, 1, 1))).toBe('2026-11');
  });

  it('dayOfMonth and timezone validation', () => {
    expect(dayOfMonth('2026-10-07')).toBe(7);
    expect(dayOfMonth('2026-10-30')).toBe(30);
    expect(isValidTimeZone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(() => localDate('Mars/Olympus', 0)).toThrow(RangeError);
  });
});
