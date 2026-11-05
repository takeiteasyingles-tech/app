// Configurações → Vozes: the ElevenLabs key is sealed and write-only, voices per assistant, the model,
// clone and test through a stubbed ElevenLabs, readable by tie-app through readElevenConfig.
import { adminApi, SETTINGS } from '@tie/shared';
import { readElevenConfig } from '@tie/worker-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Account, auditRows, fileForm, one, resetDb, seedContent, staff, testEnv } from './helpers';

const V = adminApi.voices;
const KEY = 'sk_test_0123456789abcdefghijklmnopWXYZ';

type Call = { url: string; init: RequestInit };
function stubEleven(handler: (url: string, init: RequestInit) => Response): Call[] {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://api.elevenlabs.io/')) return real(input, init);
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  });
  return calls;
}

describe('voices', () => {
  let admin: Account;

  beforeEach(async () => {
    await resetDb();
    await seedContent();
    admin = await staff(['admin']);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('stores the key sealed and write-only, with the model and the voices', async () => {
    const empty = await admin.client.json(V.get.path);
    expect(empty.body.settings).toMatchObject({ keySet: false, keyHint: null, model: 'eleven_turbo_v2_5', voices: {} });
    expect(empty.body.settings.assistants.map((a: { key: string }) => a.key)).toContain('margaret');

    const since = Date.now();
    const put = await admin.client.json(V.put.path, {
      method: 'PUT',
      json: { apiKey: KEY, model: 'eleven_multilingual_v2', voices: { margaret: 'abcDEF1234567890' } },
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.settings).toMatchObject({
      keySet: true,
      keyHint: 'WXYZ',
      keySource: 'settings',
      model: 'eleven_multilingual_v2',
      voices: { margaret: 'abcDEF1234567890' },
    });
    expect(JSON.stringify(put.body)).not.toContain(KEY);

    // At rest: sealed, never the plaintext; tie-app (same MEDIA_TOKEN_KEY) opens it.
    const row = await one<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', SETTINGS.elevenKey);
    expect(row?.value.startsWith('v1.')).toBe(true);
    expect(row?.value).not.toContain(KEY);
    const cfg = await readElevenConfig(testEnv.DB, testEnv);
    expect(cfg).toMatchObject({ apiKey: KEY, model: 'eleven_multilingual_v2', source: 'settings' });

    const [audit] = await auditRows('voice.settings', since);
    expect(audit?.diff).not.toContain(KEY);
    expect(audit?.diff).toContain('WXYZ');

    // Unknown assistant and bad voice id are refused; null removes the key.
    expect(
      (await admin.client.send(V.put.path, { method: 'PUT', json: { voices: { nobody: 'abcDEF1234567890' } } })).status,
    ).toBe(400);
    expect(
      (await admin.client.send(V.put.path, { method: 'PUT', json: { voices: { margaret: 'bad id!' } } })).status,
    ).toBe(400);
    const removed = await admin.client.json(V.put.path, { method: 'PUT', json: { apiKey: null } });
    expect(removed.body.settings.keySet).toBe(false);
    expect(removed.body.settings.voices).toEqual({ margaret: 'abcDEF1234567890' });

    const editor = await staff(['editor']);
    expect((await editor.client.send(V.get.path)).status).toBe(403);
  });

  it('tests a voice and clones one through ElevenLabs with the stored key', async () => {
    const calls = stubEleven((url) =>
      url.includes('/voices/add')
        ? Response.json({ voice_id: 'NEWvoice1234567', requires_verification: false })
        : new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3]), {
            headers: { 'Content-Type': 'audio/mpeg' },
          }),
    );
    // Nothing to do without a key.
    const noKey = await admin.client.json(V.test.path, { json: { assistantKey: 'margaret' } });
    expect(noKey.status).toBe(409);

    await admin.client.json(V.put.path, { method: 'PUT', json: { apiKey: KEY } });
    const since = Date.now();
    const clone = await admin.client.json(V.clone.path, {
      body: (() => {
        const f = fileForm(new Uint8Array(2048).fill(7), 'audio/mpeg', 'voz.mp3');
        f.append('assistantKey', 'margaret');
        return f;
      })(),
    });
    expect(clone.status, JSON.stringify(clone.body)).toBe(200);
    expect(clone.body.voiceId).toBe('NEWvoice1234567');
    expect(clone.body.settings.voices.margaret).toBe('NEWvoice1234567');
    expect(calls[0]?.url).toBe('https://api.elevenlabs.io/v1/voices/add');
    expect((calls[0]?.init.headers as Record<string, string>)['xi-api-key']).toBe(KEY);
    const [audit] = await auditRows('voice.clone', since);
    expect(audit?.target_id).toBe('margaret');

    const test = await admin.client.send(V.test.path, { json: { assistantKey: 'margaret' } });
    expect(test.status).toBe(200);
    expect(test.headers.get('Content-Type')).toBe('audio/mpeg');
    expect((await test.arrayBuffer()).byteLength).toBe(7);
    expect(calls[1]?.url).toContain('/text-to-speech/NEWvoice1234567');

    // A wrong file type never reaches ElevenLabs.
    const bad = await admin.client.send(V.clone.path, {
      body: (() => {
        const f = fileForm(new Uint8Array(64), 'image/png', 'x.png');
        f.append('assistantKey', 'margaret');
        return f;
      })(),
    });
    expect(bad.status).toBe(415);
    expect(calls).toHaveLength(2);
  });

  it('explains ElevenLabs refusals in Portuguese', async () => {
    stubEleven(() => Response.json({ detail: { status: 'invalid_api_key' } }, { status: 401 }));
    await admin.client.json(V.put.path, {
      method: 'PUT',
      json: { apiKey: KEY, voices: { margaret: 'abcDEF1234567890' } },
    });
    const r = await admin.client.json(V.test.path, { json: { assistantKey: 'margaret' } });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('recusou a chave');
  });
});
