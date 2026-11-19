// Sealed settings: third-party API keys kept in app_settings, encrypted with AES-GCM under a key
// derived (HKDF) from a Worker secret (MEDIA_TOKEN_KEY). The setting key is bound as additional data,
// so a sealed value cannot be moved to another setting. Sealed values are never returned by any API.

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

/** Encrypts `plaintext` for the setting `label`. Output: `v1.<iv>.<ciphertext>` (base64url). */
export async function sealSecret(secret: string, label: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(label) },
    await aesKey(secret),
    utf8(plaintext),
  );
  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ct))}`;
}

/** Decrypts a sealed value; null when missing, malformed or sealed under another key/label. */
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

/** The last 4 characters, shown in the admin so staff can tell which key is saved. */
export const secretHint = (plaintext: string): string => plaintext.slice(-4);
