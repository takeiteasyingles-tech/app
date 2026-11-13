// /admin-api/voices (Configurações → Vozes, permission settings.manage): the ElevenLabs API key, the model
// and each assistant's cloned voice, kept in app_settings for tie-app's /api/tts (worker-core
// services/eleven.ts). The key is sealed (worker-core secrets.ts) and write-only: responses and the audit
// log carry only its last 4 characters. Clone (Instant Voice Clone from a sample) and test call ElevenLabs
// with the stored key.
import {
  ApiError,
  adminApi,
  ELEVEN_DEFAULT_KEY,
  ELEVEN_NARRATOR_KEY,
  ELEVEN_SAMPLE_MIME,
  type ElevenVoice,
  SETTINGS,
  type VoiceSettings,
} from '@tie/shared';
import {
  type AppEnv,
  all,
  assertContentLength,
  ElevenError,
  elevenAddLibraryVoice,
  elevenClone,
  elevenListVoices,
  elevenSearchLibrary,
  elevenSpeak,
  isElevenSampleUrl,
  one,
  type Query,
  q,
  readElevenConfig,
  sealSecret,
  secretHint,
} from '@tie/worker-core';
import { Hono } from 'hono';
import { actor, auditStmt, bodyOf, type Ctx, queryOf, route } from '../lib/http';

const routes = new Hono<AppEnv>();
const api = adminApi.voices;
const MULTIPART_OVERHEAD = 64 * 1024;

const upsert = (db: D1Database, key: string, value: string, userId: string, now: number): Query<unknown> =>
  q(
    db,
    `INSERT INTO app_settings(key, value, updated_by, updated_at) VALUES(?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    key,
    value,
    userId,
    now,
  );

async function assistants(db: D1Database): Promise<{ key: string; name: string }[]> {
  return all<{ key: string; name: string }>(db, 'SELECT key, name FROM assistants ORDER BY sort, key');
}

async function view(c: Ctx): Promise<VoiceSettings> {
  const db = c.env.DB;
  const [cfg, list, stamp] = await Promise.all([
    readElevenConfig(db, c.env),
    assistants(db),
    one<{ at: number | null; by: string | null }>(
      db,
      `SELECT updated_at AS at, updated_by AS by FROM app_settings WHERE key IN (?, ?, ?) ORDER BY updated_at DESC LIMIT 1`,
      SETTINGS.elevenKey,
      SETTINGS.elevenVoices,
      SETTINGS.elevenModel,
    ),
  ]);
  return {
    keySet: !!cfg.apiKey,
    keyHint: cfg.apiKey ? secretHint(cfg.apiKey) : null,
    keySource: cfg.source,
    model: cfg.model,
    voices: cfg.voices,
    assistants: list,
    updatedAt: stamp?.at ?? null,
    updatedBy: stamp?.by ?? null,
  };
}

/** ElevenLabs refusals in pt-BR (the detail codes ElevenLabs answers with). */
function elevenFail(err: unknown, what: string): never {
  if (!(err instanceof ElevenError)) throw err;
  const d = err.detail ?? '';
  const msg =
    err.status === 401 || d === 'invalid_api_key'
      ? 'A ElevenLabs recusou a chave. Confira se ela está certa e ativa.'
      : d.includes('missing_permissions')
        ? 'A chave da ElevenLabs não tem permissão para isso. Crie uma chave com acesso a Text to Speech e Voices.'
        : d.includes('instant_voice_cloning') || d.includes('can_not_use')
          ? 'O plano da conta ElevenLabs não permite clonar vozes (Instant Voice Clone pede o plano Starter ou acima).'
          : d.includes('quota') || err.status === 429
            ? 'A conta da ElevenLabs está sem créditos ou no limite de uso agora.'
            : `A ElevenLabs não conseguiu ${what} (erro ${err.status}${d ? `: ${d}` : ''}).`;
  throw new ApiError('conflict', msg, { elevenStatus: err.status, elevenDetail: d || null });
}

route(routes, api.get, async (c) => c.json({ settings: await view(c) }));

route(routes, api.put, async (c) => {
  const body = await bodyOf(c, api.put.body);
  const db = c.env.DB;
  const now = Date.now();
  const userId = actor(c).userId;
  const before = await readElevenConfig(db, c.env);
  const stmts: Query<unknown>[] = [];
  const diff: Record<string, unknown> = {};

  if (body.apiKey !== undefined) {
    const from = before.source === 'settings' && before.apiKey ? secretHint(before.apiKey) : null;
    if (body.apiKey === null) {
      stmts.push(q(db, 'DELETE FROM app_settings WHERE key = ?', SETTINGS.elevenKey));
      diff.key = { from, to: null };
    } else {
      stmts.push(
        upsert(
          db,
          SETTINGS.elevenKey,
          await sealSecret(c.env.MEDIA_TOKEN_KEY, SETTINGS.elevenKey, body.apiKey),
          userId,
          now,
        ),
      );
      diff.key = { from, to: secretHint(body.apiKey) };
    }
  }
  if (body.model !== undefined && body.model !== before.model) {
    stmts.push(upsert(db, SETTINGS.elevenModel, body.model, userId, now));
    diff.model = { from: before.model, to: body.model };
  }
  if (body.voices !== undefined) {
    // The course narration and the default lesson voice sit next to the assistants (spec 05).
    const known = new Set([ELEVEN_NARRATOR_KEY, ELEVEN_DEFAULT_KEY, ...(await assistants(db)).map((a) => a.key)]);
    const unknown = Object.keys(body.voices).filter((k) => !known.has(k));
    if (unknown.length) throw new ApiError('validation_failed', `Assistente desconhecida: ${unknown.join(', ')}.`);
    const next = { ...before.voices };
    for (const [k, id] of Object.entries(body.voices)) {
      if (id === null) delete next[k];
      else next[k] = id;
    }
    if (JSON.stringify(next) !== JSON.stringify(before.voices)) {
      stmts.push(upsert(db, SETTINGS.elevenVoices, JSON.stringify(next), userId, now));
      diff.voices = { from: before.voices, to: next };
    }
  }
  if (stmts.length) {
    stmts.push(
      await auditStmt(c, { action: 'voice.settings', targetType: 'app_setting', targetId: 'voice.eleven', diff }, now),
    );
    await db.batch(stmts.map((s) => s.stmt));
  }
  return c.json({ settings: await view(c) });
});

route(routes, api.clone, async (c) => {
  const max = api.clone.multipart.maxBytes;
  const declared = c.req.header('Content-Length');
  if (!declared) throw new ApiError('bad_request', 'Envie o arquivo com Content-Length.');
  assertContentLength(declared, max + MULTIPART_OVERHEAD);
  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    throw new ApiError('bad_request', 'Envie a amostra como multipart/form-data.');
  }
  const file = form.get(api.clone.multipart.field);
  const key = form.get('assistantKey');
  if (!file || typeof file === 'string' || file.size === 0)
    throw new ApiError('bad_request', 'Escolha o arquivo de áudio com a voz.');
  if (file.size > max) throw new ApiError('payload_too_large', `O limite é ${Math.round(max / 1024 / 1024)} MB.`);
  if (!(ELEVEN_SAMPLE_MIME as readonly string[]).includes(file.type)) {
    throw new ApiError('unsupported_media_type', 'Envie um áudio MP3, WAV, M4A, OGG ou WebM.');
  }
  if (typeof key !== 'string') throw new ApiError('bad_request', 'Diga de qual assistente é a voz.');
  const db = c.env.DB;
  const who =
    key === ELEVEN_NARRATOR_KEY || key === ELEVEN_DEFAULT_KEY
      ? { key, name: key === ELEVEN_DEFAULT_KEY ? 'Voz padrão' : 'Narração' }
      : await one<{ key: string; name: string }>(db, 'SELECT key, name FROM assistants WHERE key = ?', key);
  if (!who) throw new ApiError('not_found', 'Assistente não encontrada.');
  const cfg = await readElevenConfig(db, c.env);
  if (!cfg.apiKey) throw new ApiError('conflict', 'Salve a chave da ElevenLabs antes de clonar uma voz.');

  let voiceId: string;
  try {
    voiceId = await elevenClone(cfg.apiKey, `TIE ${who.name}`, file, `Take It Easy: voz da assistente ${who.name}.`);
  } catch (err) {
    elevenFail(err, 'clonar a voz');
  }
  const now = Date.now();
  const next = { ...cfg.voices, [who.key]: voiceId };
  await db.batch([
    upsert(db, SETTINGS.elevenVoices, JSON.stringify(next), actor(c).userId, now).stmt,
    (
      await auditStmt(
        c,
        {
          action: 'voice.clone',
          targetType: 'assistant',
          targetId: who.key,
          diff: {
            voiceId: { from: cfg.voices[who.key] ?? null, to: voiceId },
            sampleBytes: file.size,
            sampleType: file.type,
          },
        },
        now,
      )
    ).stmt,
  ]);
  return c.json({ voiceId, settings: await view(c) });
});

route(routes, api.test, async (c) => {
  const body = await bodyOf(c, api.test.body);
  const db = c.env.DB;
  const who =
    body.assistantKey === ELEVEN_NARRATOR_KEY || body.assistantKey === ELEVEN_DEFAULT_KEY
      ? {
          key: body.assistantKey,
          name: body.assistantKey === ELEVEN_DEFAULT_KEY ? 'a voz padrão das aulas' : 'a narração do curso',
        }
      : await one<{ key: string; name: string }>(
          db,
          'SELECT key, name FROM assistants WHERE key = ?',
          body.assistantKey,
        );
  if (!who) throw new ApiError('not_found', 'Assistente não encontrada.');
  const cfg = await readElevenConfig(db, c.env);
  if (!cfg.apiKey) throw new ApiError('conflict', 'Salve a chave da ElevenLabs antes de testar.');
  const voiceId = cfg.voices[who.key];
  if (!voiceId) throw new ApiError('conflict', `${who.name} ainda não tem uma voz da ElevenLabs.`);
  const text =
    body.text ??
    (who.key === ELEVEN_NARRATOR_KEY || who.key === ELEVEN_DEFAULT_KEY
      ? PREVIEW_LINE
      : `Hi! I'm ${who.name}. Let's practice a little English together today.`);
  let audio: Uint8Array<ArrayBuffer>;
  try {
    audio = await elevenSpeak(cfg.apiKey, cfg.model, voiceId, text);
  } catch (err) {
    elevenFail(err, 'gerar o áudio');
  }
  return new Response(audio, {
    headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(audio.byteLength), 'Cache-Control': 'no-store' },
  });
});

// ---------- Lesson voice pickers (spec 05 "Lesson voices"; content.edit) ----------

/** The line a voice reads in a preview: vocabulary and a short phrase, like the lessons. */
const PREVIEW_LINE = 'Good morning! Kitchen, window, table, coffee. Nice to meet you.';

const mp3 = (audio: Uint8Array<ArrayBuffer>): Response =>
  new Response(audio, {
    headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(audio.byteLength), 'Cache-Control': 'no-store' },
  });

async function keyOrFail(c: Ctx): Promise<{ apiKey: string; model: string }> {
  const cfg = await readElevenConfig(c.env.DB, c.env);
  if (!cfg.apiKey) {
    throw new ApiError('conflict', 'Falta a chave da ElevenLabs: um admin salva em Configurações → Vozes.');
  }
  return { apiKey: cfg.apiKey, model: cfg.model };
}

route(routes, api.account, async (c) => {
  const { apiKey } = await keyOrFail(c);
  try {
    return c.json({ voices: await elevenListVoices(apiKey) });
  } catch (err) {
    elevenFail(err, 'listar as vozes');
  }
});

route(routes, api.library, async (c) => {
  const query = queryOf(c, api.library.query);
  const { apiKey } = await keyOrFail(c);
  try {
    const found = await elevenSearchLibrary(apiKey, { q: query.q || undefined, gender: query.gender });
    return c.json({ voices: found.map(({ previewUrl, ...v }) => ({ ...v, sampleUrl: previewUrl })) });
  } catch (err) {
    elevenFail(err, 'buscar na biblioteca');
  }
});

route(routes, api.libraryAdd, async (c) => {
  const body = await bodyOf(c, api.libraryAdd.body);
  const { apiKey } = await keyOrFail(c);
  let id: string;
  try {
    id = await elevenAddLibraryVoice(apiKey, body.ownerId, body.voiceId, body.name);
  } catch (err) {
    elevenFail(err, 'adicionar a voz à conta');
  }
  const now = Date.now();
  // The voice lives in the ElevenLabs account, not in D1: the audit row is the only write here.
  await (
    await auditStmt(
      c,
      {
        action: 'voice.library_add',
        targetType: 'voice',
        targetId: id,
        diff: { name: body.name, libraryVoiceId: body.voiceId, ownerId: body.ownerId },
      },
      now,
    )
  ).stmt.run();
  let voice: ElevenVoice | undefined;
  try {
    voice = (await elevenListVoices(apiKey)).find((v) => v.id === id);
  } catch {
    voice = undefined;
  }
  return c.json({
    voice: voice ?? { id, name: body.name, category: 'professional', gender: null, accent: null, description: null },
  });
});

route(routes, api.librarySample, async (c) => {
  const { url } = queryOf(c, api.librarySample.query);
  // Only ElevenLabs' public sample bucket: never an open proxy.
  if (!isElevenSampleUrl(url)) throw new ApiError('validation_failed', 'Amostra inválida.', { field: 'url' });
  const r = await fetch(url, { headers: { Accept: 'audio/mpeg' } });
  if (!r.ok) throw new ApiError('not_found', 'A ElevenLabs não tem mais esta amostra.');
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.byteLength > 5 * 1024 * 1024) throw new ApiError('payload_too_large');
  return mp3(bytes);
});

route(routes, api.preview, async (c) => {
  const body = await bodyOf(c, api.preview.body);
  const { apiKey, model } = await keyOrFail(c);
  try {
    return mp3(await elevenSpeak(apiKey, model, body.voiceId, body.text ?? PREVIEW_LINE));
  } catch (err) {
    elevenFail(err, 'gerar o áudio');
  }
});

export default routes;
