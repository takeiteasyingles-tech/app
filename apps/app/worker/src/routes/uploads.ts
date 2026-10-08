// S1 Uploads: /api/me/photo (POST multipart, DELETE). Spec 04 §3, §5 and spec 01 §13.
// Photos go to private R2 under users/{uid}/photo-{id}.{ext}, get an uploads row, and enter the
// moderation queue as 'pending'; the owner sees the new photo right away.
// Note for the /m/* media route (S9): {ext} is the sniffed type (jpg | png | webp, account/image.ts
// PHOTO_EXT), not always .jpg; the object's httpMetadata.contentType carries the real MIME.
import { ApiError, appApi, LIMITS, newId, type Ok, PHOTO_MIME, type PhotoRes } from '@tie/shared';
import {
  type AppEnv,
  assertContentLength,
  auditFor,
  batch,
  prepareUpload,
  putUpload,
  type Query,
  q,
  rateLimit,
  readLimited,
  requireUser,
  sessionOf,
} from '@tie/worker-core';
import { Hono } from 'hono';
import { imageSize, PHOTO_EXT, PHOTO_MAX_DIM } from '../account/image';
import { uploadUrl } from '../account/profile';

const routes = new Hono<AppEnv>();
const api = appApi.me;

/** Room for the multipart boundaries and part headers around the 2 MB file. */
const MULTIPART_OVERHEAD = 16 * 1024;
const MAX_BODY = LIMITS.photoMaxBytes + MULTIPART_OVERHEAD;

interface ActivePhoto {
  id: string;
  r2_key: string;
}

/**
 * Retires every active photo of the user except `keepId` (the one just inserted, or none) and
 * returns the retired rows (RETURNING), so the caller deletes exactly those R2 objects. Done as one
 * statement inside the write batch, two concurrent uploads cannot both stay active: whichever batch
 * runs second retires the first one's row and gets its key back.
 */
const retirePhotosQuery = (db: D1Database, userId: string, keepId: string | null): Query<ActivePhoto> =>
  q<ActivePhoto>(
    db,
    `UPDATE uploads SET status = 'removed' WHERE user_id = ? AND kind = 'photo' AND status = 'active' AND id <> ?
     RETURNING id, r2_key`,
    userId,
    keepId ?? '',
  );

/** Closes the still-pending moderation items of the user's removed photos (run after retirePhotosQuery). */
const dismissRetiredQuery = (db: D1Database, userId: string, keepId: string | null, now: number): Query<never> =>
  q<never>(
    db,
    `UPDATE moderation_items SET status = 'dismissed', reviewed_at = ?, notes = 'replaced or removed by the user'
     WHERE ref_type = 'upload' AND status = 'pending' AND ref_id <> ?
       AND ref_id IN (SELECT id FROM uploads WHERE user_id = ? AND kind = 'photo' AND status = 'removed')`,
    now,
    keepId ?? '',
    userId,
  );

async function deleteObjects(bucket: R2Bucket, keys: readonly string[]): Promise<void> {
  if (!keys.length) return;
  await bucket
    .delete([...keys])
    .catch((err) => console.error(JSON.stringify({ level: 'error', msg: 'r2 delete failed', err: String(err) })));
}

routes.post(api.photoUpload.path, requireUser(), rateLimit('RL_UPLOAD'), async (c) => {
  const s = sessionOf(c);
  const db = c.env.DB;
  const now = Date.now();

  assertContentLength(c.req.header('Content-Length'), MAX_BODY);
  const raw = await readLimited(c.req.raw.body, MAX_BODY);
  let form: FormData;
  try {
    form = await new Request(c.req.url, { method: 'POST', headers: c.req.raw.headers, body: raw }).formData();
  } catch {
    throw new ApiError('bad_request', 'Envie a foto como multipart/form-data.');
  }
  const file = form.get(api.photoUpload.multipart.field);
  if (!file || typeof file === 'string') throw new ApiError('bad_request', 'Escolha uma foto.');

  const upload = await prepareUpload(file, { maxBytes: LIMITS.photoMaxBytes, allow: PHOTO_MIME }, file.type);
  const size = imageSize(upload.bytes, upload.mime);
  if (!size) throw new ApiError('unsupported_media_type', 'Não deu para ler esta imagem.');
  if (size.width > PHOTO_MAX_DIM || size.height > PHOTO_MAX_DIM) {
    throw new ApiError('payload_too_large', `A foto deve ter no máximo ${PHOTO_MAX_DIM}×${PHOTO_MAX_DIM} pixels.`);
  }

  const id = newId(now);
  const key = `users/${s.userId}/photo-${id}.${PHOTO_EXT[upload.mime] ?? 'jpg'}`;
  await putUpload(c.env.MEDIA, key, upload, {
    cacheControl: 'private, max-age=31536000, immutable',
    customMetadata: { userId: s.userId, kind: 'photo', uploadId: id },
  });

  let previous: ActivePhoto[] = [];
  try {
    const results = await batch(db, [
      q(
        db,
        `INSERT INTO uploads(id, user_id, kind, r2_key, mime, bytes, sha256, status, created_at)
         VALUES(?, ?, 'photo', ?, ?, ?, ?, 'active', ?)`,
        id,
        s.userId,
        key,
        upload.mime,
        upload.size,
        upload.sha256,
        now,
      ),
      retirePhotosQuery(db, s.userId, id),
      q(db, 'UPDATE profiles SET photo_upload = ?, updated_at = ? WHERE user_id = ?', id, now, s.userId),
      q(
        db,
        `INSERT INTO moderation_items(id, kind, subject_user_id, ref_type, ref_id, reason, priority, status, created_at)
         VALUES(?, 'photo', ?, 'upload', ?, 'new_profile_photo', 1, 'pending', ?)`,
        newId(now),
        s.userId,
        id,
        now,
      ),
      await auditFor(
        c,
        {
          action: 'me.photo_upload',
          targetType: 'upload',
          targetId: id,
          diff: { mime: upload.mime, bytes: upload.size, width: size.width, height: size.height },
        },
        now,
      ),
      dismissRetiredQuery(db, s.userId, id, now),
    ]);
    previous = results[1];
  } catch (err) {
    await deleteObjects(c.env.MEDIA, [key]);
    throw err;
  }
  await deleteObjects(
    c.env.MEDIA,
    previous.map((p) => p.r2_key),
  );
  return c.json({ photo: uploadUrl(key), status: 'pending' } satisfies PhotoRes, 201);
});

routes.delete(api.photoDelete.path, requireUser(), rateLimit('RL_API'), async (c) => {
  const s = sessionOf(c);
  const db = c.env.DB;
  const now = Date.now();
  const [current] = await batch(db, [
    retirePhotosQuery(db, s.userId, null),
    dismissRetiredQuery(db, s.userId, null, now),
    q(db, 'UPDATE profiles SET photo_upload = NULL, updated_at = ? WHERE user_id = ?', now, s.userId),
    await auditFor(c, { action: 'me.photo_delete', targetType: 'user', targetId: s.userId }, now),
  ]);
  await deleteObjects(
    c.env.MEDIA,
    current.map((p) => p.r2_key),
  );
  return c.json({ ok: true } satisfies Ok);
});

export default routes;
