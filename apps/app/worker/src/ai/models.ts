// Workers AI model ids and the thin wrappers around env.AI.run (spec 04 §3.1).
// Model ids live in app_settings (SETTINGS.model*) so an admin can swap them without a deploy;
// DEFAULT_MODELS is the fallback. `npm run deploy` first runs scripts/checkModels.ts, which checks
// them against the account catalog (`wrangler ai models list`) and refuses to deploy a missing id.
// PROD (spec 05 "Paid AI providers"): an id may also be `anthropic:<model>` or `openai:<model>`; the
// worker-core aiRunner routes those to the provider's API. PROD (spec 05 "ElevenLabs voices"): TTS
// may use the ElevenLabs voices (ai.model.tts = TTS_ELEVEN, or a lesson/assistant voice).
import {
  AI_MODEL_ID_RE,
  aiProviderOf,
  DEFAULT_MODELS,
  ELEVEN_DEFAULT_KEY,
  ELEVEN_EXTRAS_KEY,
  ELEVEN_NARRATOR_KEY,
  ELEVEN_VOICE_ID_RE,
  type EpisodeVoices,
  FLAGS,
  parseRole,
  SETTINGS,
  TTS_ELEVEN,
} from '@tie/shared';
import {
  aiRunner,
  all,
  type ContentService,
  type Env,
  elevenSpeakTimed,
  type FlagSubject,
  isEnabled,
  one,
  readElevenConfig,
  type WordSpan,
} from '@tie/worker-core';

export interface Models {
  tutor: string;
  tutorFallback: string;
  asr: string;
  tts: string;
  guard: string;
  /** ai.model.tts is TTS_ELEVEN: every TTS line uses the ElevenLabs voices (default voice as fallback). */
  ttsEleven?: boolean;
}

type ModelRole = Exclude<keyof Models, 'ttsEleven'>;

const SETTING_KEYS: Record<ModelRole, string> = {
  tutor: SETTINGS.modelTutor,
  tutorFallback: SETTINGS.modelTutorFallback,
  asr: SETTINGS.modelAsr,
  tts: SETTINGS.modelTts,
  guard: SETTINGS.modelGuard,
};

const MODEL_ID_RE = AI_MODEL_ID_RE;
/** Which providers can serve each role: Claude has no ASR; TTS and the guard stay on Workers AI. */
const ROLE_OK: Record<ModelRole, (id: string) => boolean> = {
  tutor: () => true,
  tutorFallback: () => true,
  asr: (id) => aiProviderOf(id) !== 'anthropic',
  tts: (id) => aiProviderOf(id) === 'workers',
  guard: (id) => aiProviderOf(id) === 'workers',
};
const TTL_MS = 30_000;
let cache: { at: number; db: D1Database; models: Models } | null = null;

/** Clears the per-isolate cache (tests, or the isolate that served an admin settings write). */
export function invalidateModels(): void {
  cache = null;
}

/** Model ids from app_settings, cached per isolate for 30 s; malformed values fall back to the default. */
export async function loadModels(db: D1Database, now: number = Date.now()): Promise<Models> {
  if (cache && cache.db === db && now - cache.at < TTL_MS) return cache.models;
  const keys = Object.values(SETTING_KEYS);
  const rows = await all<{ key: string; value: string }>(
    db,
    `SELECT key, value FROM app_settings WHERE key IN (${keys.map(() => '?').join(',')})`,
    ...keys,
  );
  const byKey = new Map(rows.map((r) => [r.key, r.value.trim()]));
  const models = { ...DEFAULT_MODELS } as Models;
  for (const [name, key] of Object.entries(SETTING_KEYS) as [ModelRole, string][]) {
    const v = byKey.get(key);
    if (v && MODEL_ID_RE.test(v) && ROLE_OK[name](v)) models[name] = v;
  }
  if (byKey.get(SETTINGS.modelTts) === TTS_ELEVEN) models.ttsEleven = true;
  cache = { at: now, db, models };
  return models;
}

/** AI is on when the ai.enabled flag is on (for this subject) and the AI binding exists. */
export async function aiEnabled(env: Env, subject: FlagSubject = {}): Promise<boolean> {
  if (!hasAiBinding(env)) return false;
  return isEnabled(env.DB, FLAGS.aiEnabled, subject);
}

export function hasAiBinding(env: Pick<Env, 'AI'>): boolean {
  const ai = (env as { AI?: unknown }).AI;
  return !!ai && typeof (ai as { run?: unknown }).run === 'function';
}

/** env.AI.run with a model id read at runtime (the generated types only accept literal ids). */
export interface AiRunner {
  run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

/** Env the AI calls read: the AI binding, plus DB and the key secrets for the paid providers. */
export type AiEnv = Pick<Env, 'AI'> &
  Partial<Pick<Env, 'DB' | 'MEDIA_TOKEN_KEY' | 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY'>>;

/** Routes `anthropic:` / `openai:` ids to their provider, anything else to env.AI (worker-core llm.ts). */
export function runner(env: AiEnv): AiRunner {
  return aiRunner(env);
}

export class AiCallError extends Error {
  constructor(
    message: string,
    readonly model: string,
  ) {
    super(message);
    this.name = 'AiCallError';
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Extracts the JSON object a chat model returned (object, JSON string, or text with a fenced block). */
export function extractJson(response: unknown): unknown {
  if (response && typeof response === 'object') {
    const r = (response as { response?: unknown }).response;
    if (r !== undefined) return extractJson(r);
    return response;
  }
  if (typeof response !== 'string') return null;
  const text = response.trim();
  const candidates = [text];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export interface JsonCall<T> {
  messages: ChatMessage[];
  /** JSON schema for response_format (json_schema mode). */
  schema: Record<string, unknown>;
  /** Coerces and validates the parsed object; returns null when it does not fit the contract. */
  accept: (raw: unknown) => T | null;
  maxTokens: number;
  temperature?: number;
}

export interface JsonResult<T> {
  value: T;
  model: string;
  latencyMs: number;
}

/**
 * Runs the tutor model in JSON-schema mode and validates the answer; on an error or an answer
 * that fails validation it retries once on the fallback model. Throws AiCallError when both fail.
 */
export async function runJson<T>(env: AiEnv, models: Models, call: JsonCall<T>): Promise<JsonResult<T>> {
  const ai = runner(env);
  const started = Date.now();
  let lastError = 'no attempt';
  const tried = new Set<string>();
  for (const model of [models.tutor, models.tutorFallback]) {
    if (tried.has(model)) continue;
    tried.add(model);
    const t0 = Date.now();
    const log = (ok: boolean, why?: string) =>
      console.log(JSON.stringify({ level: 'info', msg: 'ai_call', model, ms: Date.now() - t0, ok, why }));
    try {
      const out = await ai.run(model, {
        messages: call.messages,
        response_format: { type: 'json_schema', json_schema: call.schema },
        max_tokens: call.maxTokens,
        temperature: call.temperature ?? 0.6,
      });
      const value = call.accept(extractJson(out));
      if (value !== null) {
        log(true);
        return { value, model, latencyMs: Date.now() - started };
      }
      lastError = `${model}: answer did not match the contract`;
      log(false, 'contract');
    } catch (err) {
      lastError = `${model}: ${err instanceof Error ? err.message : String(err)}`;
      log(false, lastError.slice(0, 200));
    }
  }
  throw new AiCallError(lastError, models.tutor);
}

/** Whisper transcript of a base64 WAV (language forced to English). */
export async function transcribe(env: AiEnv, model: string, audioB64: string): Promise<string> {
  const out = (await runner(env).run(model, { audio: audioB64, language: 'en' })) as { text?: unknown } | null;
  if (!out || typeof out.text !== 'string') throw new AiCallError('ASR returned no text', model);
  return out.text.trim();
}

/** Deepgram Aura speech as mp3 bytes; accepts the stream, buffer or base64 shapes the binding may return. */
export async function synthesize(
  env: AiEnv,
  model: string,
  text: string,
  speaker: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const out = await runner(env).run(model, { text, speaker, encoding: 'mp3' });
  let bytes: Uint8Array<ArrayBuffer> | null = null;
  if (out instanceof ReadableStream) bytes = new Uint8Array(await new Response(out).arrayBuffer());
  else if (out instanceof ArrayBuffer) bytes = new Uint8Array(out);
  else if (out instanceof Uint8Array) bytes = new Uint8Array(out);
  else if (out instanceof Response) bytes = new Uint8Array(await out.arrayBuffer());
  else if (out && typeof (out as { audio?: unknown }).audio === 'string') {
    const bin = atob((out as { audio: string }).audio);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  }
  if (!bytes || bytes.length === 0) throw new AiCallError('TTS returned no audio', model);
  return bytes;
}

// ---------- ElevenLabs voices ----------

export interface ElevenVoice {
  apiKey: string;
  model: string;
  voiceId: string;
  /** The default voice, tried when voiceId fails (only when it differs). */
  fallbackId?: string;
}

export interface ElevenPick {
  /** The assistant whose voice was asked for (resolveSpeaker), if any. */
  assistantKey: string | null;
  /** Lesson line role (narrator, a cast name, extras…), see parseRole(). */
  role: string | null;
  /** The episode's own voice for this role (lessonVoiceId). */
  lessonVoice: string | null;
  /** ai.model.tts = TTS_ELEVEN: use the default voice even for lines without a voice of their own. */
  everywhere: boolean;
}

/** The ElevenLabs voice for a TTS line, or null for the Workers AI voice (no key, or no voice fits). */
export async function elevenForRole(
  env: Parameters<typeof readElevenConfig>[1],
  db: D1Database,
  pick: ElevenPick,
): Promise<ElevenVoice | null> {
  if (!pick.assistantKey && !pick.role && !pick.lessonVoice && !pick.everywhere) return null;
  const cfg = await readElevenConfig(db, env);
  if (!cfg.apiKey) return null;
  const parsed = pick.role ? parseRole(pick.role) : null;
  const isNarration = !!parsed?.narrator;
  const narration = isNarration ? cfg.voices[ELEVEN_NARRATOR_KEY] : undefined;
  const fallback = pick.role || pick.everywhere ? cfg.voices[ELEVEN_DEFAULT_KEY] : undefined;
  const assistant = pick.assistantKey ? cfg.voices[pick.assistantKey] : undefined;
  const voiceId = parsed?.extras
    ? pick.lessonVoice || cfg.voices[ELEVEN_EXTRAS_KEY] || assistant || fallback
    : isNarration
      ? pick.lessonVoice || narration || fallback || assistant
      : pick.lessonVoice || assistant || fallback;
  if (!voiceId) return null;
  return {
    apiKey: cfg.apiKey,
    model: cfg.model,
    voiceId,
    ...(fallback && fallback !== voiceId ? { fallbackId: fallback } : {}),
  };
}

/**
 * The episode's own ElevenLabs voice for a lesson line role (episodes.voices, 0016): the published
 * snapshot's when there is one, else the D1 row. null when the episode sets none for that role.
 */
export async function lessonVoiceId(
  db: D1Database,
  content: ContentService,
  ep: number,
  role: string,
): Promise<string | null> {
  let voices: EpisodeVoices | null | undefined;
  try {
    voices = (await content.current()) ? ((await content.episode(ep))?.voices ?? null) : undefined;
  } catch {
    voices = undefined;
  }
  if (voices === undefined) {
    const row = await one<{ voices: string }>(
      db,
      "SELECT voices FROM episodes WHERE num = ? AND status = 'published'",
      ep,
    );
    try {
      voices = row ? (JSON.parse(row.voices) as EpisodeVoices | null) : null;
    } catch {
      voices = null;
    }
  }
  if (!voices) return null;
  const ok = (id: unknown): string | null => (typeof id === 'string' && ELEVEN_VOICE_ID_RE.test(id) ? id : null);
  const parsed = parseRole(role);
  if (parsed.extras) {
    const w = parsed.who.toLowerCase();
    const hit = w ? Object.entries(voices.extras?.cast ?? {}).find(([name]) => name.toLowerCase() === w) : undefined;
    return ok(hit?.[1]) ?? ok(voices.extras?.narrator);
  }
  if (parsed.narrator)
    return ok(parsed.step != null ? voices.steps?.[String(parsed.step)] : undefined) ?? ok(voices.narrator);
  const r = role.toLowerCase();
  const hit = Object.entries(voices.cast ?? {}).find(([name]) => name.toLowerCase() === r);
  return hit ? ok(hit[1]) : null;
}

/** ElevenLabs speech with word timings; failures surface as AiCallError like the Workers AI calls. */
export async function synthesizeEleven(
  v: ElevenVoice,
  text: string,
): Promise<{ audio: Uint8Array<ArrayBuffer>; words: WordSpan[] | null }> {
  try {
    return await elevenSpeakTimed(v.apiKey, v.model, v.voiceId, text);
  } catch (err) {
    throw new AiCallError(err instanceof Error ? err.message : 'ElevenLabs TTS failed', v.model);
  }
}

export interface GuardVerdict {
  safe: boolean;
  categories: string[];
}

/**
 * Llama Guard verdict for a learner message. The conversation sent is the learner's message alone:
 * Llama Guard 3 classifies the role of the LAST message, so appending the tutor's reply would turn
 * this into a check of the model's answer (response classification) and abusive learner text
 * would go unflagged.
 */
export async function guard(env: AiEnv, model: string, userText: string): Promise<GuardVerdict> {
  const messages: ChatMessage[] = [{ role: 'user', content: userText }];
  const out = await runner(env).run(model, { messages });
  const r = out && typeof out === 'object' ? (out as { response?: unknown }).response : out;
  if (r && typeof r === 'object') {
    const v = r as { safe?: unknown; categories?: unknown };
    const categories = Array.isArray(v.categories) ? v.categories.map(String).slice(0, 14) : [];
    return { safe: v.safe !== false, categories };
  }
  if (typeof r === 'string') {
    const text = r.trim().toLowerCase();
    if (text.startsWith('unsafe')) {
      const categories = (r.match(/S\d{1,2}/g) ?? []).slice(0, 14);
      return { safe: false, categories };
    }
    return { safe: true, categories: [] };
  }
  throw new AiCallError('guard returned nothing', model);
}

/** True when the model id looks valid (used by health and tests). */
export const isModelId = (v: string): boolean => MODEL_ID_RE.test(v);
