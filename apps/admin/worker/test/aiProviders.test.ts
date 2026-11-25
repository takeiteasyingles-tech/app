// Configurações → App → Provedores de IA (spec 05 "Paid AI providers"): the Claude and OpenAI keys are
// sealed and write-only, audited by their last 4 characters, tested against a stubbed provider, and the
// ai.model.* settings accept their model ids.
import { adminApi, buildPath, SETTINGS } from '@tie/shared';
import { readProviderKeys } from '@tie/worker-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Account, auditRows, one, resetDb, staff, testEnv } from './helpers';

const P = adminApi.aiProviders;
const KEY = 'sk-ant-api03-test-0123456789abcdefghijQRST';

describe('ai providers', () => {
  let admin: Account;

  beforeEach(async () => {
    await resetDb();
    admin = await staff(['admin']);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('stores the key sealed and write-only, audited without it', async () => {
    const empty = await admin.client.json(P.get.path);
    expect(empty.body.providers).toEqual([
      expect.objectContaining({ provider: 'anthropic', keySet: false }),
      expect.objectContaining({ provider: 'openai', keySet: false }),
    ]);
    const since = Date.now();
    const put = await admin.client.json(P.put.path, { method: 'PUT', json: { anthropic: KEY } });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.providers[0]).toMatchObject({ keySet: true, keyHint: 'QRST', keySource: 'settings' });
    expect(JSON.stringify(put.body)).not.toContain(KEY);
    const row = await one<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', SETTINGS.aiKeyAnthropic);
    expect(row?.value).not.toContain(KEY);
    expect((await readProviderKeys(testEnv)).anthropic).toBe(KEY);
    const [audit] = await auditRows('ai.providers', since);
    expect(audit?.diff).not.toContain(KEY);
    expect(audit?.diff).toContain('QRST');
    // Unknown fields and short keys are refused; null removes it.
    expect((await admin.client.send(P.put.path, { method: 'PUT', json: { gemini: KEY } })).status).toBe(400);
    expect((await admin.client.send(P.put.path, { method: 'PUT', json: { openai: 'short' } })).status).toBe(400);
    const removed = await admin.client.json(P.put.path, { method: 'PUT', json: { anthropic: null } });
    expect(removed.body.providers[0].keySet).toBe(false);
  });

  it('tests the key by listing its models', async () => {
    await admin.client.json(P.put.path, { method: 'PUT', json: { anthropic: KEY } });
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith('https://api.anthropic.com/')) return real(input, init);
      return Promise.resolve(
        Response.json({
          data: [{ type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-01-01' }],
          has_more: false,
          first_id: 'claude-opus-5-5',
          last_id: 'claude-opus-5-5',
        }),
      );
    });
    const res = await admin.client.json(P.test.path, { method: 'POST', json: { provider: 'anthropic' } });
    expect(res.body).toEqual({ ok: true, models: ['claude-opus-5-5'], error: null });
    const none = await admin.client.json(P.test.path, { method: 'POST', json: { provider: 'openai' } });
    expect(none.body.ok).toBe(false);
  });

  it('times a short Mic-like turn on a model', async () => {
    await admin.client.json(P.put.path, { method: 'PUT', json: { anthropic: KEY } });
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith('https://api.anthropic.com/')) return real(input, init);
      return Promise.resolve(
        Response.json({
          id: 'msg_s',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-5-5',
          content: [{ type: 'text', text: '{"reply_en":"Nice!","reply_pt":"Legal!","feedback":{}}' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    });
    const ok = await admin.client.json(P.speed.path, {
      method: 'POST',
      json: { model: 'anthropic:claude-sonnet-5-5' },
    });
    expect(ok.body).toMatchObject({ model: 'anthropic:claude-sonnet-5-5', ok: true, error: null });
    const noKey = await admin.client.json(P.speed.path, { method: 'POST', json: { model: 'openai:gpt-6-luna' } });
    expect(noKey.body).toMatchObject({ ok: false, error: 'Sem chave salva para este provedor.' });
    expect((await admin.client.send(P.speed.path, { method: 'POST', json: { model: 'gpt-6' } })).status).toBe(400);
  });

  it('accepts Claude and OpenAI model ids where they can run', async () => {
    const set = (key: string, value: string) =>
      admin.client.send(buildPath(adminApi.ops.setSetting.path, { key }), { method: 'PUT', json: { value } });
    expect((await set(SETTINGS.modelTutor, 'anthropic:claude-opus-5-5')).status).toBe(200);
    expect((await set(SETTINGS.modelTutorFallback, 'openai:gpt-x')).status).toBe(200);
    expect((await set(SETTINGS.modelAsr, 'openai:whisper-1')).status).toBe(200);
    expect((await set(SETTINGS.modelAsr, 'anthropic:claude-opus-5-5')).status).toBe(400);
    expect((await set(SETTINGS.modelTts, 'openai:tts-1')).status).toBe(400);
    expect((await set(SETTINGS.modelTts, 'elevenlabs')).status).toBe(200);
    expect((await set(SETTINGS.modelTts, '@cf/deepgram/aura-1')).status).toBe(200);
    expect((await set(SETTINGS.modelTutor, 'claude-opus-5-5')).status).toBe(400);
  });
});
