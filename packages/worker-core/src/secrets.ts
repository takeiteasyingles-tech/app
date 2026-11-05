// Secrets that staff type into the admin (e.g. the ElevenLabs API key) and that the Workers keep in
// app_settings: sealed with AES-256-GCM under a key derived (HKDF-SHA-256) from MEDIA_TOKEN_KEY, which
// docs/DEPLOY.md requires to be the same on both Workers, so tie-admin seals and tie-app opens. A sealed
// value never leaves the Workers; the admin only ever shows its last characters.
import { fromBase64Url, toBase64Url, utf8 } from './bytes';

const VERSION = 'v1';
const keys = new Map<string, Promise<CryptoKey>>();

function aesKey(secret: string): Promise<CryptoKey> {
  let k = keys.get(secret);
  if (!k) {
    k = crypto.subtle
      .importKey('raw', utf8(secret), 'HKDF', false, ['deriveKey'])
      .then((ikm) =>
        crypto.subtle.deriveKey(
          { name: 'HKDF', hash: 'SHA-256', salt: utf8('tie-app-settings'), info: utf8('sealed setting v1') },
          ikm,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt'],
        ),
      );
    keys.set(secret, k);
  }
  return k;
}

/** 'v1.<iv>.<ciphertext>' (base64url), bound to `label` (the setting key) as additional data. */
export async function sealSecret(secret: string, label: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(label) },
    await aesKey(secret),
    utf8(plaintext),
  );
  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ct))}`;
}

/** The plaintext, or null when the value is missing, malformed, or sealed with another key or label. */
export async function openSecret(
  secret: string,
  label: string,
  sealed: string | null | undefined,
): Promise<string | null> {
  if (!sealed) return null;
  const [v, iv, ct] = sealed.split('.');
  if (v !== VERSION || !iv || !ct) return null;
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(iv), additionalData: utf8(label) },
      await aesKey(secret),
      fromBase64Url(ct),
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/** What the admin may show of a secret: its last 4 characters. */
export const secretHint = (plaintext: string): string => plaintext.slice(-4);
