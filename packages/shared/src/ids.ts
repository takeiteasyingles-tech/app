// ULID-style ids: 10 chars of millisecond timestamp + 16 chars of randomness, Crockford base32.
// Lexicographic order follows creation time, which keeps D1 primary-key indexes append-friendly.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RANDOM_LEN = 16;
const MAX_TIME = 2 ** 48 - 1;

interface CryptoLike {
  getRandomValues<T extends Uint8Array>(array: T): T;
}

function cryptoApi(): CryptoLike {
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!c?.getRandomValues) throw new Error('crypto.getRandomValues is not available');
  return c;
}

export function randomBytes(length: number): Uint8Array {
  return cryptoApi().getRandomValues(new Uint8Array(length));
}

function encodeTime(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_TIME) throw new RangeError(`invalid ulid time: ${ms}`);
  let out = '';
  let t = ms;
  for (let i = 0; i < TIME_LEN; i++) {
    out = ALPHABET.charAt(t % 32) + out;
    t = Math.floor(t / 32);
  }
  return out;
}

function encodeRandom(): string {
  // 16 base32 chars = 80 bits; masking each byte to 5 bits keeps the distribution uniform.
  const bytes = randomBytes(RANDOM_LEN);
  let out = '';
  for (const b of bytes) out += ALPHABET.charAt(b & 31);
  return out;
}

/** 26-char time-sortable id. */
export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

/** Default id generator for every D1 row id created at runtime. */
export const newId = ulid;

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && ULID_RE.test(value);
}

/** Timestamp (unix ms) encoded in a ulid. */
export function ulidTime(id: string): number {
  if (!isUlid(id)) throw new TypeError('not a ulid');
  let t = 0;
  for (const ch of id.slice(0, TIME_LEN)) t = t * 32 + ALPHABET.indexOf(ch);
  return t;
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64URL.charAt((n >> 18) & 63) + B64URL.charAt((n >> 12) & 63);
    out += B64URL.charAt((n >> 6) & 63) + B64URL.charAt(n & 63);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += B64URL.charAt((n >> 18) & 63) + B64URL.charAt((n >> 12) & 63);
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += B64URL.charAt((n >> 18) & 63) + B64URL.charAt((n >> 12) & 63) + B64URL.charAt((n >> 6) & 63);
  }
  return out;
}

/** Opaque random token (session, reset link, invite). 32 bytes → 43 base64url chars. */
export function randomToken(byteLength = 32): string {
  return toBase64Url(randomBytes(byteLength));
}
