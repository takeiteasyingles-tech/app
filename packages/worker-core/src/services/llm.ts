// Paid AI providers (PROD, spec 05 "Paid AI providers"): a model id `anthropic:<id>` or `openai:<id>`
// runs on that provider's API; any other id runs on Workers AI (env.AI). The runner takes and returns
// the Workers AI shapes (`{messages, response_format, max_tokens}` → `{response}`, `{audio}` → `{text}`),
// so callers do not care which provider answers. Keys are sealed in app_settings (secrets.ts), with the
// Worker secrets ANTHROPIC_API_KEY / OPENAI_API_KEY as fallback.

import Anthropic from '@anthropic-ai/sdk';
import { aiProviderOf, SETTINGS } from '@tie/shared';
import OpenAI, { toFile } from 'openai';
import { all } from '../db';
import type { Env } from '../env';
import { openSecret } from '../secrets';

export type PaidProvider = 'anthropic' | 'openai';

export interface ProviderKeys {
  anthropic: string | null;
  openai: string | null;
  /** Where each key came from: typed in the admin ('settings') or the Worker secret ('env'). */
  source: Record<PaidProvider, 'settings' | 'env' | null>;
}

type KeyEnv = Pick<Env, 'DB' | 'MEDIA_TOKEN_KEY' | 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY'>;

/** The provider keys: sealed settings first, then the Worker secrets. */
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
    readonly provider: PaidProvider,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

interface InMessage {
  role: string;
  content?: unknown;
}

/** Workers AI style inputs (chat or ASR). */
export type RunInputs = Record<string, unknown> & {
  messages?: InMessage[];
  response_format?: { type?: string; json_schema?: Record<string, unknown> };
  max_tokens?: unknown;
  audio?: unknown;
  language?: unknown;
};

function schemaOf(inputs: RunInputs): Record<string, unknown> | null {
  const rf = inputs.response_format;
  return rf && rf.type === 'json_schema' ? (rf.json_schema ?? null) : null;
}

/** The system messages in one text; with a schema, the JSON instruction is appended (no json_schema mode here). */
function systemText(messages: InMessage[], schema: Record<string, unknown> | null): string {
  const sys = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  if (!schema) return sys;
  return `${sys}\n\nAnswer with one JSON object only (no prose, no code fence), following this JSON schema:\n${JSON.stringify(schema)}`;
}

/** User/assistant turns; the conversation must start with a user turn. */
function turns(messages: InMessage[]): { role: 'user' | 'assistant'; content: string }[] {
  const out = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content ?? '') }));
  if (!out.length || out[0]?.role !== 'user') out.unshift({ role: 'user', content: '(início da conversa)' });
  return out;
}

/** Short calls (a Mic turn) fail fast so the caller can fall back; long ones (reports) get a retry. */
const isShort = (inputs: RunInputs) => (Number(inputs.max_tokens) || 1024) <= 1200;
const clientOpts = (inputs: RunInputs) =>
  isShort(inputs) ? { maxRetries: 0, timeout: 20_000 } : { maxRetries: 1, timeout: 90_000 };

async function runClaude(key: string, model: string, inputs: RunInputs): Promise<{ response: string }> {
  const messages = inputs.messages ?? [];
  const client = new Anthropic({ apiKey: key, ...clientOpts(inputs) });
  const answer = Number(inputs.max_tokens) || 1024;
  const thinking = model.startsWith('claude-sonnet-5-5')
    ? ({ type: 'between_tools' } as const)
    : model.startsWith('claude-haiku-5-5')
      ? ({ type: 'disabled' } as const)
      : undefined;
  const fallback = model.startsWith('claude-opus-5-5');
  try {
    const res = await client.beta.messages.create({
      model,
      max_tokens: Math.min(32_000, Math.max(thinking ? 1024 : 4096, answer * (thinking ? 2 : 4))),
      // The system text (persona, script, schema) repeats on every turn of a conversation: cached, so
      // the next turns start answering sooner.
      system: [{ type: 'text', text: systemText(messages, schemaOf(inputs)), cache_control: { type: 'ephemeral' } }],
      messages: turns(messages),
      output_config: { effort: 'low' },
      ...(thinking ? { thinking } : {}),
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    });
    if (res.stop_reason === 'refusal') throw new ProviderError('Claude declined the request', 'anthropic');
    const text = res.content
      .filter((b) => b.type === 'text')
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

async function runOpenAI(
  key: string,
  model: string,
  inputs: RunInputs,
): Promise<{ response: string } | { text: string }> {
  const client = new OpenAI({ apiKey: key, ...clientOpts(inputs) });
  const reasoning = /^(gpt-[56]|o\d)/.test(model) ? { reasoning_effort: 'low' as const } : {};
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
    const messages = inputs.messages ?? [];
    const schema = schemaOf(inputs);
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemText(messages, schema) },
        ...turns(messages).filter((m, i) => !(i === 0 && m.content === '(início da conversa)')),
      ],
      ...(schema ? { response_format: { type: 'json_object' as const } } : {}),
      ...reasoning,
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

/** env.AI.run with a model id read at runtime, routed to the model's provider. */
export interface ModelRunner {
  run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export type RunnerEnv = Pick<Env, 'AI'> & Partial<KeyEnv>;

/** A runner for this request; provider keys are read once, on the first paid call. */
export function aiRunner(env: RunnerEnv): ModelRunner {
  let keys: Promise<ProviderKeys> | null = null;
  const keyFor = async (p: PaidProvider): Promise<string> => {
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
        return runClaude(await keyFor('anthropic'), model.slice('anthropic:'.length), inputs as RunInputs);
      if (provider === 'openai') return runOpenAI(await keyFor('openai'), model.slice('openai:'.length), inputs);
      const ai = env.AI as unknown as ModelRunner;
      return options === undefined ? ai.run(model, inputs) : ai.run(model, inputs, options);
    },
  };
}

/** The model ids a key can use (admin "test key"); throws ProviderError when the key does not work. */
export async function listProviderModels(provider: PaidProvider, key: string): Promise<string[]> {
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
