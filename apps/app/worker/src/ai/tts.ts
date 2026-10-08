// /api/tts helpers (spec 04 §3.1 "TTS"): speaker allowlist and the two cache layers.
// Allowlist = tts_speaker of the active assistants. `voice` may be an assistant key or one of those
// speakers; anything else is rejected, so clients cannot drive arbitrary model parameters.
// Cache: R2 tts/{sha256}.mp3 (durable, shared) and the Cache API (per colo, fast). Billing happens
// only on a miss in both.
import { fail, sha256Hex } from '@tie/worker-core';
import { activeAssistants } from './context';

export const SPEAKER_RE = /^[a-z][a-z0-9_-]{1,39}$/;

export interface SpeakerChoice {
  speaker: string;
  assistantKey: string | null;
}

export async function resolveSpeaker(db: D1Database, voice: string, gender: 'female' | 'male'): Promise<SpeakerChoice> {
  const list = await activeAssistants(db);
  const v = voice.trim().toLowerCase();
  const byKey = list.find((a) => a.key.toLowerCase() === v);
  if (byKey && SPEAKER_RE.test(byKey.ttsSpeaker)) return { speaker: byKey.ttsSpeaker, assistantKey: byKey.key };
  const bySpeaker = list.find((a) => a.ttsSpeaker.toLowerCase() === v);
  if (bySpeaker && SPEAKER_RE.test(bySpeaker.ttsSpeaker)) return { speaker: bySpeaker.ttsSpeaker, assistantKey: null };
  // Unknown names (e.g. the prototype's Gemini voices) never reach the model: the gender picks the
  // first active assistant's allowlisted speaker instead.
  const byGender = list.find((a) => a.gender === gender && SPEAKER_RE.test(a.ttsSpeaker));
  if (byGender) return { speaker: byGender.ttsSpeaker, assistantKey: null };
  throw fail('validation_failed', 'Voz não permitida.', { field: 'voice' });
}

/** Content key: model + speaker + text, so a model or voice swap never serves stale audio. */
export async function ttsKey(model: string, speaker: string, text: string): Promise<string> {
  return sha256Hex(`${model}\n${speaker}\n${text}`);
}

export const ttsR2Key = (hash: string): string => `tts/${hash}.mp3`;

/** Synthetic Cache API key (never fetched; only used as the cache lookup URL). */
const cacheUrl = (hash: string): string => `https://tts-cache.invalid/${hash}.mp3`;

function defaultCache(): Cache | null {
  try {
    return (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null;
  } catch {
    return null;
  }
}

export async function cacheGet(hash: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const cache = defaultCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(cacheUrl(hash));
    return hit ? new Uint8Array(await hit.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export async function cachePut(hash: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const cache = defaultCache();
  if (!cache) return;
  try {
    await cache.put(
      cacheUrl(hash),
      new Response(bytes, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=2592000' } }),
    );
  } catch {
    // Cache API is best effort (unavailable on some hosts).
  }
}

export async function r2Get(bucket: R2Bucket, hash: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const obj = await bucket.get(ttsR2Key(hash));
  return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
}

export async function r2Put(
  bucket: R2Bucket,
  hash: string,
  bytes: Uint8Array<ArrayBuffer>,
  speaker: string,
): Promise<void> {
  await bucket.put(ttsR2Key(hash), bytes, {
    httpMetadata: { contentType: 'audio/mpeg' },
    customMetadata: { speaker },
  });
}

/** TTS bill on a miss: ceil(chars / 15) seconds (spec 04 §3.1 "Quota"). */
export const ttsSeconds = (text: string): number => Math.max(1, Math.ceil(text.length / 15));
