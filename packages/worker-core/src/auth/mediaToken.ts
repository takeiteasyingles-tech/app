import { DURATIONS } from '@tie/shared';
import { fromBase64Url, toBase64Url, utf8 } from '../bytes';

// tie_m cookie: lets /m/* serve content media without a D1 lookup per range request.
// Value: `<expMs base36>.<userId>.<HMAC-SHA256 base64url>` over `m1.<exp>.<userId>`.

const VERSION = 'm1';
const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    if (!secret) throw new Error('MEDIA_TOKEN_KEY is not set');
    key = crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    keyCache.set(secret, key);
  }
  return key;
}

const payload = (exp: string, userId: string) => utf8(`${VERSION}.${exp}.${userId}`);

export interface MediaTokenClaims {
  userId: string;
  expiresAt: number;
}

export async function signMediaToken(
  secret: string,
  userId: string,
  now: number = Date.now(),
  ttlMs: number = DURATIONS.mediaTokenMs,
): Promise<{ token: string; expiresAt: number }> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) throw new TypeError('invalid user id for media token');
  const expiresAt = now + ttlMs;
  const exp = expiresAt.toString(36);
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), payload(exp, userId));
  return { token: `${exp}.${userId}.${toBase64Url(new Uint8Array(sig))}`, expiresAt };
}

/** Claims when the signature is valid and unexpired, else null. Uses subtle.verify (constant time). */
export async function verifyMediaToken(
  secret: string,
  token: string | null | undefined,
  now: number = Date.now(),
): Promise<MediaTokenClaims | null> {
  if (!token || token.length > 200) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [exp = '', userId = '', sigText = ''] = parts;
  if (!/^[0-9a-z]{1,12}$/.test(exp) || !/^[A-Za-z0-9_-]{1,64}$/.test(userId)) return null;
  const expiresAt = Number.parseInt(exp, 36);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;
  let sig: Uint8Array<ArrayBuffer>;
  try {
    sig = fromBase64Url(sigText);
  } catch {
    return null;
  }
  if (sig.length !== 32) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sig, payload(exp, userId));
  return ok ? { userId, expiresAt } : null;
}
