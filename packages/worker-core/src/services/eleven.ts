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
