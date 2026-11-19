// POST /admin-api/ai/song-lyrics (content.edit, RL_AI): the episode editor's song lyrics tool. The
// browser sends the song as 16 kHz mono PCM WAV plus the mode, the title and (align) the typed lines
// as multipart fields; lib/songLyrics does the work. Nothing is written here.
import { ApiError, adminApi, SongLyricsFields } from '@tie/shared';
import { type AppEnv, assertContentLength, parseOrThrow } from '@tie/worker-core';
import { Hono } from 'hono';
import { route } from '../lib/http';
import { songLyrics } from '../lib/songLyrics';

const routes = new Hono<AppEnv>();
const api = adminApi.songLyrics;
/** Multipart boundaries, part headers and the text fields around the audio. */
const MULTIPART_OVERHEAD = 256 * 1024;

route(routes, api.run, async (c) => {
  const max = api.run.multipart.maxBytes;
  const declared = c.req.header('Content-Length');
  if (!declared) throw new ApiError('bad_request', 'Envie o áudio com Content-Length.');
  assertContentLength(declared, max + MULTIPART_OVERHEAD);
  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    throw new ApiError('bad_request', 'Envie o áudio como multipart/form-data.');
  }
  const file = form.get(api.run.multipart.field);
  if (!file || typeof file === 'string' || file.size === 0)
    throw new ApiError('bad_request', 'Envie o áudio da música.');
  if (file.size > max) {
    throw new ApiError('payload_too_large', `O áudio convertido passa de ${Math.round(max / 1024 / 1024)} MB.`);
  }
  const text = (k: string): string | undefined => {
    const v = form.get(k);
    return typeof v === 'string' && v !== '' ? v : undefined;
  };
  let lines: unknown;
  const rawLines = text('lines');
  if (rawLines !== undefined) {
    try {
      lines = JSON.parse(rawLines);
    } catch {
      throw new ApiError('bad_request', 'O campo "lines" precisa ser JSON.');
    }
  }
  const fields = parseOrThrow(SongLyricsFields, {
    mode: text('mode'),
    ...(text('title') !== undefined ? { title: text('title') } : {}),
    ...(lines !== undefined ? { lines } : {}),
  });
  const bytes = new Uint8Array(await file.arrayBuffer());
  return c.json(await songLyrics(c.env, bytes, fields));
});

export default routes;
