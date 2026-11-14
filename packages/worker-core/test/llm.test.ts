// PROD (spec 05 "Paid AI providers"): the runner dispatches by model id and reads the sealed keys.
import { AI_MODEL_ID_RE, aiProviderOf, SETTINGS } from '@tie/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sealSecret } from '../src/secrets';
import { aiRunner, ProviderError, readProviderKeys } from '../src/services/llm';
import { FakeD1 } from './helpers/fakeD1';

const MK = 'k'.repeat(48);
const ANTHROPIC_KEY = 'sk-ant-test-0000000000000000000000-abcd';

async function dbWith(rows: Record<string, string>) {
  const sealed: { key: string; value: string }[] = [];
  for (const [k, v] of Object.entries(rows)) sealed.push({ key: k, value: await sealSecret(MK, k, v) });
  return new FakeD1((sql) => (sql.includes('FROM app_settings') ? sealed : [])).asD1();
}

afterEach(() => vi.unstubAllGlobals());

describe('model ids', () => {
  it('name their provider', () => {
    expect(AI_MODEL_ID_RE.test('@cf/meta/llama-3.3-70b-instruct-fp8-fast')).toBe(true);
    expect(AI_MODEL_ID_RE.test('anthropic:claude-opus-5-5')).toBe(true);
    expect(AI_MODEL_ID_RE.test('openai:whisper-1')).toBe(true);
    expect(AI_MODEL_ID_RE.test('claude-opus-5-5')).toBe(false);
    expect(AI_MODEL_ID_RE.test('anthropic:')).toBe(false);
    expect(aiProviderOf('anthropic:claude-opus-5-5')).toBe('anthropic');
    expect(aiProviderOf('openai:gpt-x')).toBe('openai');
    expect(aiProviderOf('@cf/a/b')).toBe('workers');
  });
});

describe('aiRunner', () => {
  it('sends @cf ids to the Workers AI binding unchanged', async () => {
    const run = vi.fn(async () => ({ response: 'ok' }));
    const out = await aiRunner({ AI: { run } }).run('@cf/meta/x', { messages: [] });
    expect(out).toEqual({ response: 'ok' });
    expect(run).toHaveBeenCalledWith('@cf/meta/x', { messages: [] });
  });

  it('refuses a Claude model without a key', async () => {
    const DB = await dbWith({});
    const err = await aiRunner({ AI: { run: vi.fn() }, DB, MEDIA_TOKEN_KEY: MK })
      .run('anthropic:claude-opus-5-5', { messages: [{ role: 'user', content: 'hi' }] })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
  });

  it('calls the Claude API with the sealed key and returns its text', async () => {
    const DB = await dbWith({ [SETTINGS.aiKeyAnthropic]: ANTHROPIC_KEY });
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text: '{"reply":"Hi!"}' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const out = await aiRunner({ DB, MEDIA_TOKEN_KEY: MK }).run('anthropic:claude-opus-5-5', {
      messages: [
        { role: 'system', content: 'Be kind.' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'hi' },
      ],
      response_format: { type: 'json_schema', json_schema: { type: 'object' } },
      max_tokens: 300,
      temperature: 0.6,
    });
    expect(out).toEqual({ response: '{"reply":"Hi!"}' });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('api.anthropic.com/v1/messages');
    const headers = init.headers instanceof Headers ? Object.fromEntries(init.headers) : init.headers;
    expect(JSON.stringify(headers)).toContain(ANTHROPIC_KEY);
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.temperature).toBeUndefined();
    expect(body.system[0].text).toContain('Be kind.');
    expect(body.system[0].text).toContain('JSON schema');
    // The repeated system text is cached; Opus always thinks (no thinking field) and keeps the fallback.
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.thinking).toBeUndefined();
    expect(body.fallbacks).toBe('default');
    // The conversation starts with a user turn.
    expect(body.messages[0].role).toBe('user');
  });

  it('turns thinking off on Sonnet and Haiku 5.5, without the server-side fallback', async () => {
    const DB = await dbWith({ [SETTINGS.aiKeyAnthropic]: ANTHROPIC_KEY });
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({
        id: 'msg_3',
        type: 'message',
        role: 'assistant',
        model: 'x',
        content: [{ type: 'text', text: '{}' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const run = aiRunner({ DB, MEDIA_TOKEN_KEY: MK });
    const msg = { messages: [{ role: 'user', content: 'hi' }], max_tokens: 700 };
    await run.run('anthropic:claude-sonnet-5-5', msg);
    await run.run('anthropic:claude-haiku-5-5', msg);
    const [sonnet, haiku] = fetch.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(sonnet.thinking).toEqual({ type: 'between_tools' });
    expect(haiku.thinking).toEqual({ type: 'disabled' });
    expect(sonnet.fallbacks).toBeUndefined();
    expect(haiku.fallbacks).toBeUndefined();
    expect(haiku.output_config).toEqual({ effort: 'low' });
  });

  it('turns a Claude refusal into an error (the caller falls back)', async () => {
    const DB = await dbWith({ [SETTINGS.aiKeyAnthropic]: ANTHROPIC_KEY });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          id: 'msg_2',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [],
          stop_reason: 'refusal',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        }),
      ),
    );
    const err = await aiRunner({ DB, MEDIA_TOKEN_KEY: MK })
      .run('anthropic:claude-opus-5-5', { messages: [{ role: 'user', content: 'x' }] })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
  });
});

describe('readProviderKeys', () => {
  it('prefers the admin key, then the Worker secret', async () => {
    const DB = await dbWith({ [SETTINGS.aiKeyAnthropic]: ANTHROPIC_KEY });
    const k = await readProviderKeys({ DB, MEDIA_TOKEN_KEY: MK, OPENAI_API_KEY: 'sk-env-openai-000000000000' });
    expect(k.anthropic).toBe(ANTHROPIC_KEY);
    expect(k.source).toEqual({ anthropic: 'settings', openai: 'env' });
  });
});
