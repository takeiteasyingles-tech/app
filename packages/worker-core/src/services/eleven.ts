// ElevenLabs client (PROD, spec 05 "ElevenLabs voices"): the assistants' cloned voices for TTS.
// The API key is sealed in app_settings (secrets.ts), with the Worker secret ELEVENLABS_API_KEY as fallback.

import { ELEVEN_DEFAULT_MODEL, ELEVEN_MODELS, SETTINGS } from '@tie/shared';
import { all } from '../db';
import type { Env } from '../env';
import { openSecret } from '../secrets';

const API = 'https://api.elevenlabs.io/v1';
const VOICE_ID_RE = /^[A-Za-z0-9]{8,40}$/;

export type ElevenModel = (typeof ELEVEN_MODELS)[number];

export interface ElevenConfig {
  apiKey: string | null;
  model: ElevenModel;
  /** {assistantKey: voiceId}. */
  voices: Record<string, string>;
  /** Where the key came from: typed in the admin ('settings') or the Worker secret ('env'). */
  source: 'settings' | 'env' | null;
}

/** A voice of the account (GET /voices). */
export interface ElevenVoiceInfo {
  id: string;
  name: string;
  category: string;
  gender: string | null;
  accent: string | null;
  description: string | null;
}

/** A voice of the public Voice Library (GET /shared-voices). */
export interface ElevenLibraryVoice extends ElevenVoiceInfo {
  ownerId: string;
  language: string | null;
  /** Only ElevenLabs' own sample bucket URLs (isElevenSampleUrl); null otherwise. */
  previewUrl: string | null;
}

/** Start/end (seconds) of each whitespace-separated word of the spoken text. */
export interface WordSpan {
  s: number;
  e: number;
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

const isModel = (m: string | null | undefined): m is ElevenModel =>
  (ELEVEN_MODELS as readonly string[]).includes(m as string);

type ElevenEnv = Pick<Env, 'MEDIA_TOKEN_KEY' | 'ELEVENLABS_API_KEY' | 'ELEVENLABS_MODEL' | 'ELEVENLABS_VOICES'>;

/** The key (settings first, then env), the model and the voice map. */
export async function readElevenConfig(db: D1Database, env: ElevenEnv): Promise<ElevenConfig> {
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
    const j = (await r.json()) as { detail?: string | { status?: string; message?: string } };
    return typeof j.detail === 'string' ? j.detail : (j.detail?.status ?? j.detail?.message);
  } catch {
    return undefined;
  }
}

const VOICE_SETTINGS = { stability: 0.45, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true };

/** Text to speech (MP3 44.1 kHz 128 kbps). */
export async function elevenSpeak(apiKey: string, model: string, voiceId: string, text: string): Promise<Uint8Array> {
  const r = await fetch(`${API}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: model, voice_settings: VOICE_SETTINGS }),
  });
  if (!r.ok) throw new ElevenError(`ElevenLabs TTS ${r.status}`, r.status, await detailOf(r));
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length === 0) throw new ElevenError('ElevenLabs TTS returned no audio', 502);
  return bytes;
}

/** Character timings → one span per word of `text`; null when the alignment does not match the text. */
function wordSpans(text: string, chars: string[], starts: number[], ends: number[]): WordSpan[] | null {
  if (chars.length !== text.length || starts.length !== chars.length || ends.length !== chars.length) return null;
  const out: WordSpan[] = [];
  const re = /\S+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const s = starts[m.index] as number;
    const e = ends[m.index + m[0].length - 1] as number;
    if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
    out.push({ s, e: Math.max(s, e) });
  }
  return out;
}

/** Text to speech with per-word timings (for karaoke-style highlighting). `words` is null without alignment. */
export async function elevenSpeakTimed(
  apiKey: string,
  model: string,
  voiceId: string,
  text: string,
): Promise<{ audio: Uint8Array<ArrayBuffer>; words: WordSpan[] | null }> {
  const r = await fetch(`${API}/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ text, model_id: model, voice_settings: VOICE_SETTINGS }),
  });
  if (!r.ok) throw new ElevenError(`ElevenLabs TTS ${r.status}`, r.status, await detailOf(r));
  const j = (await r.json()) as {
    audio_base64?: unknown;
    alignment?: {
      characters?: unknown;
      character_start_times_seconds?: unknown;
      character_end_times_seconds?: unknown;
    } | null;
  };
  if (typeof j.audio_base64 !== 'string' || !j.audio_base64)
    throw new ElevenError('ElevenLabs TTS returned no audio', 502);
  const bin = atob(j.audio_base64);
  const audio = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) audio[i] = bin.charCodeAt(i);
  const a = j.alignment;
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
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

/** Instant voice clone from one sample; returns the new voice id. */
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

const str = (v: unknown, max = 200): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

const ELEVEN_SAMPLE_HOSTS = ['storage.googleapis.com'];
const ELEVEN_SAMPLE_PATH = /^\/eleven-public-(prod|cdn)\//;

/** Library previews are only passed on when they point at ElevenLabs' public sample bucket. */
export function isElevenSampleUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return (
      url.protocol === 'https:' && ELEVEN_SAMPLE_HOSTS.includes(url.hostname) && ELEVEN_SAMPLE_PATH.test(url.pathname)
    );
  } catch {
    return false;
  }
}

type Json = Record<string, unknown>;

/** The account's voices, sorted by name. */
export async function elevenListVoices(apiKey: string): Promise<ElevenVoiceInfo[]> {
  const r = await fetch(`${API}/voices`, { headers: { 'xi-api-key': apiKey, Accept: 'application/json' } });
  if (!r.ok) throw new ElevenError(`ElevenLabs voices ${r.status}`, r.status, await detailOf(r));
  const j = (await r.json()) as { voices?: unknown };
  const list = (Array.isArray(j.voices) ? j.voices : []) as Json[];
  const out: ElevenVoiceInfo[] = [];
  for (const v of list) {
    const id = str(v.voice_id, 40);
    if (!id || !VOICE_ID_RE.test(id)) continue;
    const labels = (v.labels && typeof v.labels === 'object' ? v.labels : {}) as Json;
    out.push({
      id,
      name: str(v.name, 100) ?? id,
      category: str(v.category, 40) ?? 'premade',
      gender: str(labels.gender, 40),
      accent: str(labels.accent, 60),
      description: str(v.description, 300) ?? str(labels.description, 300),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Searches the public Voice Library (English voices). */
export async function elevenSearchLibrary(
  apiKey: string,
  opts: { q?: string; gender?: string; size?: number } = {},
): Promise<ElevenLibraryVoice[]> {
  const p = new URLSearchParams({ page_size: String(opts.size ?? 30), language: 'en' });
  if (opts.q) p.set('search', opts.q);
  if (opts.gender) p.set('gender', opts.gender);
  const r = await fetch(`${API}/shared-voices?${p}`, { headers: { 'xi-api-key': apiKey, Accept: 'application/json' } });
  if (!r.ok) throw new ElevenError(`ElevenLabs library ${r.status}`, r.status, await detailOf(r));
  const j = (await r.json()) as { voices?: unknown };
  const list = (Array.isArray(j.voices) ? j.voices : []) as Json[];
  const out: ElevenLibraryVoice[] = [];
  for (const v of list) {
    const id = str(v.voice_id, 40);
    const ownerId = str(v.public_owner_id, 100);
    if (!id || !VOICE_ID_RE.test(id) || !ownerId || !/^[A-Za-z0-9]{8,100}$/.test(ownerId)) continue;
    const preview = str(v.preview_url, 600);
    out.push({
      id,
      ownerId,
      name: str(v.name, 100) ?? id,
      category: str(v.category, 40) ?? 'library',
      gender: str(v.gender, 40),
      accent: str(v.accent, 60),
      language: str(v.language, 20),
      description: str(v.description, 300) ?? str(v.descriptive, 300),
      previewUrl: preview && isElevenSampleUrl(preview) ? preview : null,
    });
  }
  return out;
}

/** Adds a Voice Library voice to the account; returns its voice id there. */
export async function elevenAddLibraryVoice(
  apiKey: string,
  ownerId: string,
  voiceId: string,
  name: string,
): Promise<string> {
  const r = await fetch(`${API}/voices/add/${encodeURIComponent(ownerId)}/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_name: name }),
  });
  if (!r.ok) throw new ElevenError(`ElevenLabs add voice ${r.status}`, r.status, await detailOf(r));
  const j = (await r.json()) as { voice_id?: unknown };
  const id = typeof j.voice_id === 'string' ? j.voice_id : voiceId;
  if (!VOICE_ID_RE.test(id)) throw new ElevenError('ElevenLabs add voice: no voice id', 502);
  return id;
}
