// PROD (spec 05 "Paid AI providers"): one runner for every AI call of both Workers, with the
// Workers AI shape (`run(model, inputs)`): a model id names its provider (AI_MODEL_ID_RE).
// - "@cf/…" goes to the Workers AI binding, unchanged.
// - "anthropic:<id>" goes to the Claude API (official SDK), "openai:<id>" to the OpenAI API (official
//   SDK), with the keys saved in Configurações → IA (sealed like the ElevenLabs key), else the
//   ANTHROPIC_API_KEY / OPENAI_API_KEY secrets.
// Chat inputs ({messages, response_format?, max_tokens?}) answer {response: text}; callers already
// pull the JSON out of it (extractJson) and validate it. Audio inputs ({audio: base64}) on an OpenAI
// model are transcribed and answer {text}. Claude has no speech-to-text: ASR stays on Workers AI or
// OpenAI.
import Anthropic from '@anthropic-ai/sdk';
import { aiProviderOf, SETTINGS } from '@tie/shared';
import OpenAI, { toFile } from 'openai';
import { all } from '../db';
import type { Env } from '../env';
import { openSecret } from '../secrets';

export interface AiRunner {
  run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export interface ProviderKeys {
  anthropic: string | null;
  openai: string | null;
  /** Where each key came from, for the admin (never the key itself). */
  source: { anthropic: 'settings' | 'env' | null; openai: 'settings' | 'env' | null };
}

type KeyEnv = Pick<Env, 'DB' | 'MEDIA_TOKEN_KEY' | 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY'>;
/** What the runner reads: the Workers AI binding, and D1 plus the sealing key for the provider keys. */
export type AiEnv = { AI?: unknown } & Partial<KeyEnv>;

/** The provider keys: the admin's (sealed in app_settings) first, then the Worker secrets. */
export async function readProviderKeys(env: KeyEnv): Promise<ProviderKeys> {
  const rows = await all<{ key: string; value: string }>(
    env.DB,
    'SELECT key, value FROM app_settings WHERE key IN (?, ?)',
    SETTINGS.aiKeyAnthropic,
    SETTINGS.aiKeyOpenai,
  );
  const sealed = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const anthropic = await openSecret(env.MEDIA_TOKEN_KEY, SETTINGS.aiKeyAnthropic, sealed(SETTINGS.aiKeyAnthropic));
  const openai = await openSecret(env.MEDIA_TOKEN_KEY, SETTINGS.aiKeyOpenai, sealed(SETTINGS.aiKeyOpenai));
  return {
    anthropic: anthropic ?? env.ANTHROPIC_API_KEY ?? null,
    openai: openai ?? env.OPENAI_API_KEY ?? null,
    source: {
      anthropic: anthropic ? 'settings' : env.ANTHROPIC_API_KEY ? 'env' : null,
      openai: openai ? 'settings' : env.OPENAI_API_KEY ? 'env' : null,
    },
  };
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

interface ChatMessage {
  role: string;
  content: string;
}

/** The JSON schema a caller asked for (Workers AI response_format), for the providers' prompt. */
function schemaOf(inputs: Record<string, unknown>): unknown {
  const rf = inputs.response_format as { type?: string; json_schema?: unknown } | undefined;
  return rf && rf.type === 'json_schema' ? rf.json_schema : null;
}

/**
 * The system text plus, when the caller asked for JSON, the schema to follow: every provider gets the
 * same contract and the caller's own validator (accept()) still checks the answer.
 */
function systemText(messages: ChatMessage[], schema: unknown): string {
  const sys = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  if (!schema) return sys;
  return `${sys}\n\nAnswer with one JSON object only (no prose, no code fence), following this JSON schema:\n${JSON.stringify(schema)}`;
}

/** user / assistant turns in order, starting with a user turn (the Claude API requires it). */
function turns(messages: ChatMessage[]): { role: 'user' | 'assistant'; content: string }[] {
  const out = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content ?? '') }));
  if (!out.length || out[0]?.role !== 'user') out.unshift({ role: 'user', content: '(início da conversa)' });
  return out;
}

async function runClaude(key: string, model: string, inputs: Record<string, unknown>): Promise<unknown> {
  const messages = (inputs.messages as ChatMessage[] | undefined) ?? [];
  const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 60_000 });
  // Thinking is always on with the current Claude models and counts toward max_tokens: leave room for
  // it above the answer the caller sized, and keep effort low (these are short, latency-bound calls).
  const answer = Number(inputs.max_tokens) || 1024;
  try {
    const res = await client.beta.messages.create({
      model,
      max_tokens: Math.min(32_000, Math.max(4096, answer * 4)),
      system: systemText(messages, schemaOf(inputs)),
      messages: turns(messages),
      output_config: { effort: 'low' },
      // A safety decline is re-run on a fallback model inside the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    if (res.stop_reason === 'refusal') throw new ProviderError('Claude declined the request', 'anthropic');
    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { response: text };
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (err instanceof Anthropic.APIError) {
      throw new ProviderError(`Claude API ${err.status ?? ''}: ${err.message}`, 'anthropic', err.status ?? undefined);
    }
    throw err;
  }
}

async function runOpenAI(key: string, model: string, inputs: Record<string, unknown>): Promise<unknown> {
  const client = new OpenAI({ apiKey: key, maxRetries: 1, timeout: 60_000 });
  try {
    if (typeof inputs.audio === 'string') {
      const bin = atob(inputs.audio);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const res = await client.audio.transcriptions.create({
        file: await toFile(bytes, 'take.wav', { type: 'audio/wav' }),
        model,
        language: typeof inputs.language === 'string' ? inputs.language : 'en',
      });
      return { text: res.text };
    }
    const messages = (inputs.messages as ChatMessage[] | undefined) ?? [];
    const schema = schemaOf(inputs);
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemText(messages, schema) },
        ...turns(messages).filter((m, i) => !(i === 0 && m.content === '(início da conversa)')),
      ],
      ...(schema ? { response_format: { type: 'json_object' as const } } : {}),
      max_completion_tokens: Math.min(32_000, Math.max(2048, (Number(inputs.max_tokens) || 1024) * 4)),
    });
    return { response: res.choices[0]?.message?.content ?? '' };
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      throw new ProviderError(`OpenAI API ${err.status ?? ''}: ${err.message}`, 'openai', err.status ?? undefined);
    }
    throw err;
  }
}

/** The runner every AI call goes through (see the header). */
export function aiRunner(env: AiEnv): AiRunner {
  let keys: Promise<ProviderKeys> | null = null;
  const keyFor = async (p: 'anthropic' | 'openai'): Promise<string> => {
    if (!env.DB || !env.MEDIA_TOKEN_KEY) throw new ProviderError(`no ${p} API key available here`, p);
    keys ??= readProviderKeys(env as KeyEnv);
    const k = (await keys)[p];
    if (!k) throw new ProviderError(`no ${p} API key saved (Configurações → IA)`, p);
    return k;
  };
  return {
    async run(model, inputs, options) {
      const provider = aiProviderOf(model);
      if (provider === 'anthropic')
        return runClaude(await keyFor('anthropic'), model.slice('anthropic:'.length), inputs);
      if (provider === 'openai') return runOpenAI(await keyFor('openai'), model.slice('openai:'.length), inputs);
      const ai = env.AI as unknown as AiRunner;
      return options === undefined ? ai.run(model, inputs) : ai.run(model, inputs, options);
    },
  };
}

/** The models a key can use (admin: test a key and fill the pickers). */
export async function listProviderModels(provider: 'anthropic' | 'openai', key: string): Promise<string[]> {
  try {
    if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 20_000 });
      const ids: string[] = [];
      for await (const m of client.models.list()) ids.push(m.id);
      return ids;
    }
    const client = new OpenAI({ apiKey: key, maxRetries: 0, timeout: 20_000 });
    const ids: string[] = [];
    for await (const m of client.models.list()) ids.push(m.id);
    return ids.sort();
  } catch (err) {
    if (err instanceof Anthropic.APIError || err instanceof OpenAI.APIError) {
      throw new ProviderError(err.message, provider, err.status ?? undefined);
    }
    throw err;
  }
}
