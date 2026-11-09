// ElevenLabs (cloned assistant voices), shared by tie-app (/api/tts) and tie-admin (Configurações →
// Vozes: test and clone). The configuration lives in app_settings (SETTINGS.eleven*), written by the
// admin; the API key is sealed (secrets.ts). The env vars ELEVENLABS_* stay as a fallback.
import { ELEVEN_DEFAULT_MODEL, ELEVEN_MODELS, type ElevenModel, SETTINGS } from '@tie/shared';
import { all } from '../db';
import type { Env } from '../env';
import { openSecret } from '../secrets';

const API = 'https://api.elevenlabs.io/v1';
export const VOICE_ID_RE = /^[A-Za-z0-9]{8,40}$/;

export interface ElevenConfig {
  apiKey: string | null;
  model: ElevenModel;
  /** assistant key → ElevenLabs voice id */
  voices: Record<string, string>;
  /** Where the key came from. */
  source: 'settings' | 'env' | null;
}

function parseVoices(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, id] of Object.entries(v)) if (typeof id === 'string' && VOICE_ID_RE.test(id)) out[k] = id;
    return out;
  } catch {
    return {};
  }
}

const isModel = (m: unknown): m is ElevenModel => (ELEVEN_MODELS as readonly unknown[]).includes(m);

/** The admin settings, falling back key by key to the ELEVENLABS_* env vars. */
export async function readElevenConfig(
  db: D1Database,
  env: Pick<Env, 'MEDIA_TOKEN_KEY' | 'ELEVENLABS_API_KEY' | 'ELEVENLABS_VOICES' | 'ELEVENLABS_MODEL'>,
): Promise<ElevenConfig> {
  const rows = await all<{ key: string; value: string }>(
    db,
    'SELECT key, value FROM app_settings WHERE key IN (?, ?, ?)',
    SETTINGS.elevenKey,
    SETTINGS.elevenVoices,
    SETTINGS.elevenModel,
  );
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const sealed = get(SETTINGS.elevenKey);
  const stored = await openSecret(env.MEDIA_TOKEN_KEY, SETTINGS.elevenKey, sealed);
  if (sealed && !stored) {
    // Sealed by tie-admin but unreadable here: MEDIA_TOKEN_KEY differs between the Workers (DEPLOY.md §5).
    console.warn(JSON.stringify({ level: 'warn', msg: 'eleven key unreadable: MEDIA_TOKEN_KEY mismatch?' }));
  }
  const apiKey = stored ?? env.ELEVENLABS_API_KEY ?? null;
  const voicesRaw = get(SETTINGS.elevenVoices);
  const model = get(SETTINGS.elevenModel) ?? env.ELEVENLABS_MODEL;
  return {
    apiKey,
    model: isModel(model) ? model : ELEVEN_DEFAULT_MODEL,
    voices: voicesRaw !== null ? parseVoices(voicesRaw) : parseVoices(env.ELEVENLABS_VOICES),
    source: stored ? 'settings' : env.ELEVENLABS_API_KEY ? 'env' : null,
  };
}

export class ElevenError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ElevenError';
  }
}

async function detailOf(r: Response): Promise<string | undefined> {
  try {
    const j = (await r.json()) as { detail?: { status?: string; message?: string } | string };
    return typeof j.detail === 'string' ? j.detail : (j.detail?.status ?? j.detail?.message);
  } catch {
    return undefined;
  }
}

/** Text → mp3 (44.1 kHz, 128 kbps) in the given voice. */
export async function elevenSpeak(
  apiKey: string,
  model: string,
  voiceId: string,
  text: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const r = await fetch(`${API}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true },
    }),
  });
  if (!r.ok) throw new ElevenError(`ElevenLabs TTS ${r.status}`, r.status, await detailOf(r));
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length === 0) throw new ElevenError('ElevenLabs TTS returned no audio', 502);
  return bytes;
}

export interface TimedSpeech {
  audio: Uint8Array<ArrayBuffer>;
  /** One span per whitespace-separated word of the text, or null when the alignment does not match it. */
  words: { s: number; e: number }[] | null;
}

/**
 * Character alignment → one span per whitespace-separated word of `text` (the same split the avatar's
 * lip sync uses). null when the alignment is not the text's characters one to one.
 */
export function wordSpans(
  text: string,
  chars: readonly string[],
  starts: readonly number[],
  ends: readonly number[],
): { s: number; e: number }[] | null {
  if (chars.length !== text.length || starts.length !== chars.length || ends.length !== chars.length) return null;
  const out: { s: number; e: number }[] = [];
  const re = /\S+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const s = starts[m.index] as number;
    const e = ends[m.index + m[0].length - 1] as number;
    if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
    out.push({ s, e: Math.max(s, e) });
  }
  return out;
}

/** Text → mp3 plus when each word is heard (ElevenLabs /with-timestamps; same voice and settings). */
export async function elevenSpeakTimed(
  apiKey: string,
  model: string,
  voiceId: string,
  text: string,
): Promise<TimedSpeech> {
  const r = await fetch(`${API}/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true },
    }),
  });
  if (!r.ok) throw new ElevenError(`ElevenLabs TTS ${r.status}`, r.status, await detailOf(r));
  const j = (await r.json()) as {
    audio_base64?: unknown;
    alignment?: {
      characters?: unknown;
      character_start_times_seconds?: unknown;
      character_end_times_seconds?: unknown;
    };
  };
  if (typeof j.audio_base64 !== 'string' || !j.audio_base64)
    throw new ElevenError('ElevenLabs TTS returned no audio', 502);
  const bin = atob(j.audio_base64);
  const audio = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) audio[i] = bin.charCodeAt(i);
  const a = j.alignment;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const words = a
    ? wordSpans(
        text,
        arr(a.characters).map(String),
        arr(a.character_start_times_seconds).map(Number),
        arr(a.character_end_times_seconds).map(Number),
      )
    : null;
  return { audio, words };
}

/** Instant Voice Clone from one sample: the new voice id (it lives in that ElevenLabs account). */
export async function elevenClone(apiKey: string, name: string, sample: File, description: string): Promise<string> {
  const fd = new FormData();
  fd.append('name', name);
  fd.append('description', description);
  fd.append('remove_background_noise', 'true');
  fd.append('files', sample, sample.name || 'sample.mp3');
  const r = await fetch(`${API}/voices/add`, { method: 'POST', headers: { 'xi-api-key': apiKey }, body: fd });
  if (!r.ok) throw new ElevenError(`ElevenLabs clone ${r.status}`, r.status, await detailOf(r));
  const j = (await r.json()) as { voice_id?: unknown };
  if (typeof j.voice_id !== 'string' || !VOICE_ID_RE.test(j.voice_id))
    throw new ElevenError('ElevenLabs clone: no voice id', 502);
  return j.voice_id;
}
