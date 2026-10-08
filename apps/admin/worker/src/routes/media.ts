// Media library (/admin-api/media, editor) and the staff media server (GET/HEAD /m/*).
// Uploads: multipart field "file", ≤60 MB, type from magic bytes against MEDIA_MIME (the declared
// Content-Type is never trusted), sha256-deduplicated, stored under media/{sha8}/… in private R2.
// A file is deleted only while nothing references it (409 in_use with the references otherwise):
// neither a D1 row nor a published release (current or rollback-able, lib/releaseMedia).
import { ApiError, adminApi, can, MEDIA_MIME, type MediaRow, mediaUrl, newId, type Ok } from '@tie/shared';
import {
  type AppEnv,
  all,
  allowedMime,
  assertContentLength,
  type Bind,
  batchRun,
  one,
  q,
  serveObject,
  sessionOf,
  sniffMime,
  toHex,
} from '@tie/worker-core';
import { Hono } from 'hono';
import type { MediaKind } from '../lib/entities';
import { auditStmt, type Ctx, isConstraint, likeEscape, paramsOf, queryOf, requireStaff, route } from '../lib/http';
import { imageSize } from '../lib/imageSize';
import { type MediaRef, mediaReferences } from '../lib/mediaRefs';
import { decodeCursor, pageOf } from '../lib/page';
import { releaseMediaRefs } from '../lib/releaseMedia';

const routes = new Hono<AppEnv>();
const api = adminApi.media;

export const CONTENT_MEDIA_CACHE = 'private, max-age=31536000, immutable';
/** Multipart boundaries and part headers around the file. */
const MULTIPART_OVERHEAD = 64 * 1024;
/** Enough of the head for sniffing and for a JPEG's SOF marker after large EXIF blocks. */
const HEAD_BYTES = 256 * 1024;
const MAX_DURATION_MS = 4 * 60 * 60 * 1000;

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
};

export function kindOf(mime: string): MediaKind {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  return 'video';
}

/** "Cena 1 (final).MP4" → "cena-1-final.mp4" with the extension of the verified type. */
export function safeName(name: string, mime: string): string {
  const ext = EXT[mime] ?? 'bin';
  const base = name
    .replace(/\.[^.]*$/, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'arquivo'}.${ext}`;
}

interface MediaDb {
  id: string;
  r2_key: string;
  kind: MediaRow['kind'];
  mime: string;
  bytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  source_path: string | null;
  created_at: number;
}

const mediaRow = (r: MediaDb): MediaRow => ({
  id: r.id,
  r2Key: r.r2_key,
  url: mediaUrl(r.r2_key),
  kind: r.kind,
  mime: r.mime,
  bytes: r.bytes,
  sha256: r.sha256,
  width: r.width,
  height: r.height,
  durationMs: r.duration_ms,
  sourcePath: r.source_path,
  createdAt: r.created_at,
});

route(routes, api.list, async (c) => {
  const query = queryOf(c, api.list.query);
  const where: string[] = [];
  const binds: Bind[] = [];
  if (query.kind) {
    where.push('kind = ?');
    binds.push(query.kind);
  }
  if (query.q) {
    const like = `%${likeEscape(query.q)}%`;
    where.push("(source_path LIKE ? ESCAPE '\\' OR r2_key LIKE ? ESCAPE '\\' OR id = ?)");
    binds.push(like, like, query.q);
  }
  const cur = decodeCursor(query.cursor, ['n', 's']);
  if (cur) {
    where.push('(created_at < ? OR (created_at = ? AND id < ?))');
    binds.push(cur[0], cur[0], cur[1]);
  }
  const rows = await all<MediaDb>(
    c.env.DB,
    `SELECT * FROM media ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ?`,
    ...binds,
    query.limit + 1,
  );
  return c.json(pageOf(rows, query.limit, mediaRow, (r) => [r.created_at, r.id]));
});

async function digestHex(file: Blob): Promise<string> {
  const ds = new crypto.DigestStream('SHA-256');
  await file.stream().pipeTo(ds);
  return toHex(new Uint8Array(await ds.digest));
}

route(routes, api.upload, async (c) => {
  const max = api.upload.multipart.maxBytes;
  const declared = c.req.header('Content-Length');
  // A declared length lets an oversized upload fail before any byte is read.
  if (!declared) throw new ApiError('bad_request', 'Envie o arquivo com Content-Length.');
  assertContentLength(declared, max + MULTIPART_OVERHEAD);
  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    throw new ApiError('bad_request', 'Envie o arquivo como multipart/form-data.');
  }
  const file = form.get(api.upload.multipart.field);
  if (!file || typeof file === 'string') throw new ApiError('bad_request', 'Escolha um arquivo.');
  if (file.size === 0) throw new ApiError('bad_request', 'Arquivo vazio.');
  if (file.size > max) throw new ApiError('payload_too_large', `O limite é ${Math.round(max / 1024 / 1024)} MB.`);
  const durationField = form.get('durationMs');
  let durationMs: number | null = null;
  if (typeof durationField === 'string' && durationField !== '') {
    const n = Number(durationField);
    if (!Number.isInteger(n) || n < 0 || n > MAX_DURATION_MS) throw new ApiError('bad_request', 'durationMs inválido.');
    durationMs = n;
  }

  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const sniffed = sniffMime(head);
  const mime = sniffed ? allowedMime(sniffed, MEDIA_MIME, file.type) : null;
  if (!mime) throw new ApiError('unsupported_media_type');
  const kind = kindOf(mime);
  const sha256 = await digestHex(file);

  const db = c.env.DB;
  const existing = await one<MediaDb>(db, 'SELECT * FROM media WHERE sha256 = ?', sha256);
  if (existing) return c.json({ media: mediaRow(existing) });

  const now = Date.now();
  const id = newId(now);
  const size = kind === 'image' ? imageSize(head, mime) : null;
  const sourcePath = (file.name || '').slice(0, 200) || null;
  const key = `media/${sha256.slice(0, 8)}/up/${sha256.slice(8, 16)}-${safeName(file.name || '', mime)}`;
  await c.env.MEDIA.put(key, file, {
    httpMetadata: { contentType: mime, cacheControl: CONTENT_MEDIA_CACHE },
    sha256,
    customMetadata: { mediaId: id, uploadedBy: sessionOf(c).userId },
  });
  try {
    await batchRun(db, [
      q(
        db,
        `INSERT INTO media(id, r2_key, kind, mime, bytes, sha256, width, height, duration_ms, source_path, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        key,
        kind,
        mime,
        file.size,
        sha256,
        size?.width ?? null,
        size?.height ?? null,
        durationMs,
        sourcePath,
        now,
      ),
      await auditStmt(
        c,
        {
          action: 'media.upload',
          targetType: 'media',
          targetId: id,
          diff: { r2Key: key, mime, bytes: file.size, sha256 },
        },
        now,
      ),
    ]);
  } catch (err) {
    // A concurrent upload of the same bytes won the race: answer with its row, keep its object.
    if (isConstraint(err, 'UNIQUE')) {
      const row = await one<MediaDb>(db, 'SELECT * FROM media WHERE sha256 = ? OR r2_key = ?', sha256, key);
      if (row) return c.json({ media: mediaRow(row) });
    }
    await c.env.MEDIA.delete(key).catch(() => {});
    throw err;
  }
  const row = await one<MediaDb>(db, 'SELECT * FROM media WHERE id = ?', id);
  return c.json({ media: mediaRow(row as MediaDb) }, 201);
});

/** D1 references plus the published releases (current or rollback-able) whose snapshot uses the file. */
async function allReferences(c: Ctx, row: { id: string; r2_key: string }): Promise<MediaRef[]> {
  const [draft, releases] = await Promise.all([
    mediaReferences(c.env.DB, row.id),
    releaseMediaRefs(c.env.DB, c.env.MEDIA, row.r2_key),
  ]);
  return [...draft, ...releases];
}

route(routes, api.refs, async (c) => {
  const { id } = paramsOf(c, api.refs.params);
  const row = await one<{ id: string; r2_key: string }>(c.env.DB, 'SELECT id, r2_key FROM media WHERE id = ?', id);
  if (!row) throw new ApiError('not_found');
  return c.json({ refs: await allReferences(c, row) });
});

route(routes, api.remove, async (c) => {
  const { id } = paramsOf(c, api.remove.params);
  const db = c.env.DB;
  const now = Date.now();
  const row = await one<MediaDb>(db, 'SELECT * FROM media WHERE id = ?', id);
  if (!row) throw new ApiError('not_found');
  const refs = await allReferences(c, row);
  if (refs.length) {
    const inReleases = refs.some((r) => r.table === 'content_releases');
    throw new ApiError(
      'in_use',
      inReleases
        ? `Ainda usado em ${refs.length} lugar(es), incluindo versões publicadas que os alunos podem receber.`
        : `Ainda usado em ${refs.length} lugar(es).`,
      { refs },
    );
  }
  try {
    await batchRun(db, [
      q(db, 'DELETE FROM media WHERE id = ?', id),
      await auditStmt(c, { action: 'media.delete', targetType: 'media', targetId: id, before: mediaRow(row) }, now),
    ]);
  } catch (err) {
    // A reference landed between the check and the delete (the FKs still guard every column).
    if (isConstraint(err, 'FOREIGN KEY')) throw new ApiError('in_use');
    throw err;
  }
  await c.env.MEDIA.delete(row.r2_key).catch((err) =>
    console.error(JSON.stringify({ level: 'error', msg: 'r2 delete failed', key: row.r2_key, err: String(err) })),
  );
  return c.json({ ok: true } satisfies Ok);
});

// ---------- /m/*: media for staff previews ----------

const MAX_KEY = 512;

/** '/m/media/ab12cd34/x.webp' → 'media/ab12cd34/x.webp'; null for anything suspicious. */
export function mediaKeyFromPath(pathname: string): string | null {
  if (!pathname.startsWith('/m/')) return null;
  let parts: string[];
  try {
    parts = pathname.slice(3).split('/').map(decodeURIComponent);
  } catch {
    return null;
  }
  if (parts.length < 2) return null;
  for (const p of parts) {
    if (!p || p === '.' || p === '..' || p.includes('\\')) return null;
    for (let i = 0; i < p.length; i++) {
      const code = p.charCodeAt(i);
      if (code < 0x20 || code === 0x7f) return null;
    }
  }
  const key = parts.join('/');
  return key.length <= MAX_KEY ? key : null;
}

async function serveStaffMedia(c: Ctx): Promise<Response> {
  const key = mediaKeyFromPath(new URL(c.req.url).pathname);
  if (!key) throw new ApiError('not_found');
  let res: Response;
  if (key.startsWith('media/')) {
    res = await serveObject(c.env.MEDIA, key, c.req.raw, { cacheControl: CONTENT_MEDIA_CACHE });
  } else if (key.startsWith('users/')) {
    // Learner uploads (photos under review, removed ones kept as evidence): moderators and admins.
    if (!can(sessionOf(c).roles, 'users.read')) throw new ApiError('forbidden');
    const up = await one<{ mime: string }>(c.env.DB, 'SELECT mime FROM uploads WHERE r2_key = ?', key);
    if (!up) throw new ApiError('not_found');
    res = await serveObject(c.env.MEDIA, key, c.req.raw, {
      cacheControl: 'private, no-cache',
      contentType: up.mime,
      headers: { 'Content-Disposition': 'inline' },
    });
  } else {
    throw new ApiError('not_found');
  }
  if (res.status === 404) throw new ApiError('not_found');
  return res;
}

routes.on(['GET', 'HEAD'], '/m/*', requireStaff(), (c) => serveStaffMedia(c));

export default routes;
