// Episode editor → Música: POST /admin-api/ai/song-lyrics turns the song (16 kHz mono WAV) into timed
// lyrics with a fake Workers AI (Whisper words per chunk + the tutor's translation), aligns typed lyrics,
// and falls back to the demo path without the binding.
import { adminApi, DEFAULT_MODELS } from '@tie/shared';
import type { Env } from '@tie/worker-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildAdminApp } from '../src/index';
import { chunkBounds, readWav, wavBytes } from '../src/lib/songLyrics';
import { type Account, Client, fileForm, ins, resetDb, seedContent, staff } from './helpers';

const PATH = adminApi.songLyrics.run.path;
const RATE = 16000;

/** `seconds` of a tone with silent half-seconds at `quiet` (s): the chunk cuts should land there. */
function song(seconds: number, quiet: number[]): Uint8Array {
  const s = new Int16Array(seconds * RATE);
  for (let i = 0; i < s.length; i++) s[i] = Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / RATE));
  for (const q of quiet) s.fill(0, q * RATE, (q + 0.5) * RATE);
  return wavBytes(s, RATE);
}

function form(wav: Uint8Array, fields: Record<string, string>): FormData {
  const f = fileForm(wav, 'audio/wav', 'song.wav', 'audio');
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

type Run = (model: string, inputs: Record<string, unknown>) => Promise<unknown>;

function withAi(account: Account, run: Run) {
  const calls: { model: string; inputs: Record<string, unknown> }[] = [];
  const app = buildAdminApp();
  const ai = {
    run: (m: string, i: Record<string, unknown>) => {
      calls.push({ model: m, inputs: i });
      return run(m, i);
    },
  };
  const client = new Client({
    fetch: (req, env, ctx) => app.fetch(req, { ...env, AI: ai } as unknown as Env, ctx),
  });
  for (const [k, v] of account.client.cookies) client.cookies.set(k, v);
  return { client, calls };
}

/** Whisper (large-v3-turbo shape): every chunk sings "Hi! Hi! Good morning!" from its second 1. */
const whisper = {
  text: ' Hi! Hi! Good morning!',
  segments: [
    {
      start: 1,
      end: 3,
      text: ' Hi! Hi! Good morning!',
      words: [
        { word: ' Hi!', start: 1, end: 1.3 },
        { word: ' Hi!', start: 1.4, end: 1.7 },
        { word: ' Good', start: 2, end: 2.3 },
        { word: ' morning!', start: 2.4, end: 3 },
      ],
    },
  ],
};

describe('song lyrics', () => {
  let editor: Account;
  const wav = song(130, [50, 100]);

  beforeEach(async () => {
    await resetDb();
    await seedContent();
    editor = await staff(['editor']);
    await ins('feature_flags', {
      key: 'ai.enabled',
      enabled: 1,
      rollout_pct: 100,
      rules: null,
      updated_by: null,
      updated_at: 0,
    });
  });

  it('reads the WAV and cuts it at the quiet moments', () => {
    const pcm = readWav(wav);
    expect(pcm).toMatchObject({ rate: RATE, duration: 130 });
    const b = chunkBounds(pcm).map((x) => x / RATE);
    expect(b).toHaveLength(4);
    expect(b[1]).toBeGreaterThanOrEqual(50);
    expect(b[1]).toBeLessThanOrEqual(50.5);
    expect(b[2]).toBeGreaterThanOrEqual(100);
    expect(b[2]).toBeLessThanOrEqual(100.5);
    expect(b[3]).toBe(130);
  });

  it('generate: lines in English and Portuguese with gap and start time', async () => {
    const { client, calls } = withAi(editor, async (model) =>
      model === DEFAULT_MODELS.asr
        ? whisper
        : { response: JSON.stringify({ lines: [{ pt: 'Oi! Oi! Bom dia!', gap: 'MORNING' }] }) },
    );
    const { status, body } = await client.json(PATH, {
      body: form(wav, { mode: 'generate', title: 'Say Hello' }),
    });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ mode: 'generate', source: 'ia', duration: 130, translated: true });
    expect(body.lines).toHaveLength(3);
    expect(body.lines[0]).toEqual({
      en: 'Hi! Hi! Good morning!',
      pt: 'Oi! Oi! Bom dia!',
      gap: 'morning',
      t: 1,
      heard: true,
    });
    expect(body.lines[1].t).toBeGreaterThanOrEqual(51);
    expect(body.lines[1].t).toBeLessThanOrEqual(51.5);
    expect(body.lines[2].t).toBeGreaterThanOrEqual(101);
    expect(body.lines[2].t).toBeLessThanOrEqual(101.5);
    // Three Whisper chunks (base64 WAV, English, the title as the prompt), one translation of the repeated line.
    const asr = calls.filter((c) => c.model === DEFAULT_MODELS.asr);
    expect(asr).toHaveLength(3);
    expect(asr[0]?.inputs).toMatchObject({ language: 'en', initial_prompt: 'Say Hello' });
    expect(atob(asr[0]?.inputs.audio as string).slice(0, 4)).toBe('RIFF');
    const tr = calls.filter((c) => c.model !== DEFAULT_MODELS.asr);
    expect(tr).toHaveLength(1);
    const msgs = tr[0]?.inputs.messages as { role: string; content: string }[];
    expect(msgs[1]?.content).toContain('["Hi! Hi! Good morning!"]');
  });

  it('generate: keeps the timed lines when the translation fails', async () => {
    const { client } = withAi(editor, async (model) => (model === DEFAULT_MODELS.asr ? whisper : { response: 'não' }));
    const { body } = await client.json(PATH, { body: form(wav, { mode: 'generate' }) });
    expect(body).toMatchObject({ source: 'ia', translated: false });
    expect(body.lines[0]).toMatchObject({ en: 'Hi! Hi! Good morning!', pt: '', gap: 'morning', t: 1 });
  });

  it('align: times the typed lyrics by the words heard', async () => {
    const { client } = withAi(editor, async () => whisper);
    const lines = [
      { en: 'Hi! Hi! Good morning!', pt: 'Oi! Oi! Bom dia!', gap: 'morning' },
      { en: 'Hi! Hi! Good morning!', pt: 'Oi! Oi! Bom dia!' },
      { en: 'Hi! Hi! Good morning!', pt: 'Oi! Oi! Bom dia!' },
    ];
    const { status, body } = await client.json(PATH, {
      body: form(wav, { mode: 'align', lines: JSON.stringify(lines) }),
    });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ mode: 'align', source: 'ia' });
    expect(body.lines.map((l: { heard: boolean }) => l.heard)).toEqual([true, true, true]);
    expect(body.lines[0]).toEqual({ ...lines[0], t: 1, heard: true });
    expect(body.lines[1].t).toBeGreaterThanOrEqual(51);
    expect(body.lines[1].t).toBeLessThanOrEqual(51.5);
    expect(body.lines[2].t).toBeGreaterThanOrEqual(101);
    expect(body.lines[2].t).toBeLessThanOrEqual(101.5);
  });

  it('demo without the AI binding or when Whisper fails', async () => {
    const lines = JSON.stringify([{ en: 'a b' }, { en: 'c d' }, { en: 'e f' }, { en: 'g h' }]);
    const al = await editor.client.json(PATH, { body: form(wav, { mode: 'align', lines }) });
    expect(al.status).toBe(200);
    expect(al.body).toMatchObject({ source: 'demo', detail: 'no AI binding' });
    expect(al.body.lines.map((l: { t: number }) => l.t)).toEqual([0, 32.5, 65, 97.5]);
    const gen = await editor.client.json(PATH, { body: form(wav, { mode: 'generate' }) });
    expect(gen.body).toMatchObject({ source: 'demo', lines: [] });

    const { client } = withAi(editor, async () => {
      throw new Error('asr down');
    });
    const down = await client.json(PATH, { body: form(wav, { mode: 'generate' }) });
    expect(down.body.source).toBe('demo');
    expect(down.body.detail).toContain('asr down');
  });

  it('validates the fields and the audio, and needs content.edit', async () => {
    const noLines = await editor.client.json(PATH, { body: form(wav, { mode: 'align' }) });
    expect(noLines.status).toBe(400);
    const badMode = await editor.client.json(PATH, { body: form(wav, { mode: 'karaoke' }) });
    expect(badMode.status).toBe(400);
    const notWav = await editor.client.json(PATH, {
      body: form(new Uint8Array(100).fill(1), { mode: 'generate' }),
    });
    expect(notWav.status).toBe(400);
    const mod = await staff(['moderator']);
    const denied = await mod.client.json(PATH, { body: form(wav, { mode: 'generate' }) });
    expect(denied.status).toBe(403);
  });
});
