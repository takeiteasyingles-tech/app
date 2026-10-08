// Workers AI model ids and the thin wrappers around env.AI.run (spec 04 §3.1).
// Model ids live in app_settings (SETTINGS.model*) so an admin can swap them without a deploy;
// DEFAULT_MODELS is the fallback. `npm run deploy` first runs scripts/checkModels.ts, which checks
// them against the account catalog (`wrangler ai models list`) and refuses to deploy a missing id.
import { DEFAULT_MODELS, FLAGS, SETTINGS } from '@tie/shared';
import { all, type Env, type FlagSubject, isEnabled } from '@tie/worker-core';

export interface Models {
  tutor: string;
  tutorFallback: string;
  asr: string;
  tts: string;
  guard: string;
}

const SETTING_KEYS: Record<keyof Models, string> = {
  tutor: SETTINGS.modelTutor,
  tutorFallback: SETTINGS.modelTutorFallback,
  asr: SETTINGS.modelAsr,
  tts: SETTINGS.modelTts,
  guard: SETTINGS.modelGuard,
};

const MODEL_ID_RE = /^@cf\/[a-z0-9._-]+\/[a-z0-9._-]+$/i;
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
  for (const [name, key] of Object.entries(SETTING_KEYS) as [keyof Models, string][]) {
    const v = byKey.get(key);
    if (v && MODEL_ID_RE.test(v)) models[name] = v;
  }
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

export function runner(env: Pick<Env, 'AI'>): AiRunner {
  return env.AI as unknown as AiRunner;
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
export async function runJson<T>(env: Pick<Env, 'AI'>, models: Models, call: JsonCall<T>): Promise<JsonResult<T>> {
  const ai = runner(env);
  const started = Date.now();
  let lastError = 'no attempt';
  const tried = new Set<string>();
  for (const model of [models.tutor, models.tutorFallback]) {
    if (tried.has(model)) continue;
    tried.add(model);
    try {
      const out = await ai.run(model, {
        messages: call.messages,
        response_format: { type: 'json_schema', json_schema: call.schema },
        max_tokens: call.maxTokens,
        temperature: call.temperature ?? 0.6,
      });
      const value = call.accept(extractJson(out));
      if (value !== null) return { value, model, latencyMs: Date.now() - started };
      lastError = `${model}: answer did not match the contract`;
    } catch (err) {
      lastError = `${model}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  throw new AiCallError(lastError, models.tutor);
}

/** Whisper transcript of a base64 WAV (language forced to English). */
export async function transcribe(env: Pick<Env, 'AI'>, model: string, audioB64: string): Promise<string> {
  const out = (await runner(env).run(model, { audio: audioB64, language: 'en' })) as { text?: unknown } | null;
  if (!out || typeof out.text !== 'string') throw new AiCallError('ASR returned no text', model);
  return out.text.trim();
}

/** Deepgram Aura speech as mp3 bytes; accepts the stream, buffer or base64 shapes the binding may return. */
export async function synthesize(
  env: Pick<Env, 'AI'>,
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
export async function guard(env: Pick<Env, 'AI'>, model: string, userText: string): Promise<GuardVerdict> {
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
