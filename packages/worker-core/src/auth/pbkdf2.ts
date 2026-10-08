import { PBKDF2_ITERATIONS } from '@tie/shared';
import { fromBase64, timingSafeEqual, toBase64, utf8 } from '../bytes';

// Format: pbkdf2-sha256$100000$<salt b64>$<hash b64>. Workers caps PBKDF2 at 100k iterations.

const SCHEME = 'pbkdf2-sha256';
const SALT_BYTES = 16;
const HASH_BYTES = 32;

/** NFKC so the same password typed on different keyboards (accents, full-width) hashes the same. */
function normalize(password: string): Uint8Array<ArrayBuffer> {
  return utf8(password.normalize('NFKC'));
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', normalize(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `${SCHEME}$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

interface Parsed {
  iterations: number;
  salt: Uint8Array<ArrayBuffer>;
  hash: Uint8Array;
}

export function parseHash(stored: string): Parsed | null {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== SCHEME) return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS) return null;
  try {
    const salt = fromBase64(parts[2] ?? '');
    const hash = fromBase64(parts[3] ?? '');
    if (salt.length < SALT_BYTES || hash.length !== HASH_BYTES) return null;
    return { iterations, salt, hash };
  } catch {
    return null;
  }
}

/** False for a wrong password and for a malformed or missing stored hash. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parsed = stored ? parseHash(stored) : null;
  if (!parsed) {
    await dummyVerify(password);
    return false;
  }
  const actual = await derive(password, parsed.salt, parsed.iterations);
  return timingSafeEqual(actual, parsed.hash);
}

const DUMMY_SALT = new Uint8Array(SALT_BYTES);

/** Burns the same CPU as a real verify, so login timing does not reveal whether an email exists. */
export async function dummyVerify(password: string): Promise<false> {
  await derive(password, DUMMY_SALT, PBKDF2_ITERATIONS);
  return false;
}
