// Signed pronunciation attempt tokens. /api/pronounce issues one when the request names a phraseId;
// /api/progress/mic (S2) and /api/extras/:id/dub (S6) can verify it, so an "ia" score is only
// accepted when this server actually produced it for this user and phrase.
//
// Token: `a1.<payload b64url>.<HMAC-SHA256 b64url>`, payload = JSON {u, p, s, e}. The HMAC key is
// derived from MEDIA_TOKEN_KEY with a distinct label, so a media cookie can never pass as an attempt.
import { fromBase64Url, toBase64Url, utf8 } from '@tie/worker-core';

const VERSION = 'a1';
const LABEL = 'tie-attempt-token-v1';
export const ATTEMPT_TTL_MS = 10 * 60_000;

export interface AttemptClaims {
  userId: string;
  phraseId: string;
  score: number;
  /** Expiry, unix ms. */
  exp: number;
}

const keys = new Map<string, Promise<CryptoKey>>();

function attemptKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    if (!secret) throw new Error('MEDIA_TOKEN_KEY is not set');
    key = (async () => {
      const base = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
      ]);
      const derived = new Uint8Array(await crypto.subtle.sign('HMAC', base, utf8(LABEL)));
      return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    })();
    keys.set(secret, key);
  }
  return key;
}

export async function signAttempt(
  secret: string,
  claims: Omit<AttemptClaims, 'exp'>,
  now: number = Date.now(),
  ttlMs: number = ATTEMPT_TTL_MS,
): Promise<string> {
  const body = { u: claims.userId, p: claims.phraseId, s: claims.score, e: now + ttlMs };
  const payload = toBase64Url(utf8(JSON.stringify(body)));
  const sig = await crypto.subtle.sign('HMAC', await attemptKey(secret), utf8(`${VERSION}.${payload}`));
  return `${VERSION}.${payload}.${toBase64Url(new Uint8Array(sig))}`;
}

/**
 * Claims of a valid, unexpired token, else null. Callers must still compare userId with the
 * session and phraseId/score with the request body (see attemptMatches).
 */
export async function verifyAttempt(
  secret: string,
  token: string | null | undefined,
  now: number = Date.now(),
): Promise<AttemptClaims | null> {
  if (!token || token.length > 600) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, payload = '', sigText = ''] = parts;
  let sig: Uint8Array<ArrayBuffer>;
  let claims: { u?: unknown; p?: unknown; s?: unknown; e?: unknown };
  try {
    sig = fromBase64Url(sigText);
    if (sig.length !== 32) return null;
    const ok = await crypto.subtle.verify('HMAC', await attemptKey(secret), sig, utf8(`${VERSION}.${payload}`));
    if (!ok) return null;
    claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
  } catch {
    return null;
  }
  const { u, p, s, e } = claims;
  if (typeof u !== 'string' || typeof p !== 'string' || typeof s !== 'number' || typeof e !== 'number') return null;
  if (!Number.isInteger(s) || s < 0 || s > 10 || e <= now) return null;
  return { userId: u, phraseId: p, score: s, exp: e };
}

/** True when the token is valid for this user, phrase and score. */
export async function attemptMatches(
  secret: string,
  token: string | null | undefined,
  expected: { userId: string; phraseId: string; score: number },
  now: number = Date.now(),
): Promise<boolean> {
  const c = await verifyAttempt(secret, token, now);
  return !!c && c.userId === expected.userId && c.phraseId === expected.phraseId && c.score === expected.score;
}
