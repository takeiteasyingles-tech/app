import { describe, expect, it } from 'vitest';
import { isUlid, newId, randomToken, toBase64Url, ulid, ulidTime } from '../src/ids';

describe('ids', () => {
  it('makes 26-char ulids that sort by time', () => {
    const a = ulid(1_700_000_000_000);
    const b = ulid(1_700_000_000_001);
    expect(a).toHaveLength(26);
    expect(isUlid(a)).toBe(true);
    expect(a < b).toBe(true);
    expect(ulidTime(a)).toBe(1_700_000_000_000);
  });

  it('is unique across many calls', () => {
    const set = new Set(Array.from({ length: 5000 }, () => newId()));
    expect(set.size).toBe(5000);
  });

  it('rejects out-of-range times', () => {
    expect(() => ulid(-1)).toThrow(RangeError);
    expect(() => ulid(2 ** 48)).toThrow(RangeError);
  });

  it('encodes base64url like Buffer does', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 31, 32]) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 37 + 11) & 255);
      expect(toBase64Url(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
    }
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
