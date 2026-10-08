import { ApiError, IDEMPOTENCY_HEADER, OUTBOX_USER_HEADER } from '@tie/shared';
import type { MiddlewareHandler } from 'hono';
import { loadSession } from './auth/middleware';
import { batch, one, q, run } from './db';
import type { AppEnv } from './env';

// Idempotency-Key for the offline outbox (spec 04 §5, spec 06 "Offline outbox"). The first answer of
// a (user, key) is stored; a replay of a write that already landed (its response was lost on the way
// back, so the service worker queued it) gets that stored answer instead of running again.

/** Stored keys older than this are pruned by the retention cron (the outbox keeps writes 7 days). */
export const IDEMPOTENCY_KEEP_MS = 8 * 24 * 60 * 60_000;
/** Responses above this are not stored (the request still runs; a replay would run again). */
export const IDEMPOTENCY_MAX_BODY = 64 * 1024;
const KEY_RE = /^[A-Za-z0-9._:-]{8,100}$/;

export const REPLAYED_HEADER = 'Idempotent-Replayed';

export interface IdempotencyOptions {
  /** The writes that honor the header (the outbox's queueable paths). */
  applies(pathname: string, method: string): boolean;
}

interface KeyRow {
  method: string;
  path: string;
  status: number | null;
  body: string | null;
}

/**
 * App-level middleware. For an applicable write carrying Idempotency-Key and a session:
 * - X-Tie-User naming another user → 409 (a write queued for an account that signed out);
 * - first time: claims the key, runs the route, stores a 2xx answer (anything else frees the key,
 *   so a retry runs again);
 * - seen and answered: the stored answer, with Idempotent-Replayed: true;
 * - seen, still running, or the same key on another route: 409.
 * Without a session it does nothing (the route answers 401).
 */
export function idempotency(opts: IdempotencyOptions): MiddlewareHandler<AppEnv> {
  const resolve = loadSession('app');
  return async (c, next) => {
    const key = c.req.header(IDEMPOTENCY_HEADER);
    const method = c.req.method;
    const path = c.req.path;
    if (!key || method === 'GET' || method === 'HEAD' || !opts.applies(path, method)) return next();
    if (!KEY_RE.test(key)) throw new ApiError('validation_failed', undefined, { field: IDEMPOTENCY_HEADER });
    await resolve(c, async () => {});
    const s = c.get('session');
    if (!s) return next();
    const owner = c.req.header(OUTBOX_USER_HEADER);
    if (owner && owner !== s.userId) {
      throw new ApiError('conflict', 'Essa ação foi feita em outra conta e não foi enviada.');
    }

    const db = c.env.DB;
    const [claimed] = await batch(db, [
      q<{ key: string }>(
        db,
        `INSERT INTO idempotency_keys(user_id, key, method, path, status, body, created_at)
         VALUES(?, ?, ?, ?, NULL, NULL, ?) ON CONFLICT(user_id, key) DO NOTHING RETURNING key`,
        s.userId,
        key,
        method,
        path,
        Date.now(),
      ),
    ]);
    if (!claimed.length) {
      const row = await one<KeyRow>(
        db,
        'SELECT method, path, status, body FROM idempotency_keys WHERE user_id = ? AND key = ?',
        s.userId,
        key,
      );
      if (!row || row.method !== method || row.path !== path || row.status === null) {
        throw new ApiError('conflict', 'Essa ação já está sendo enviada.');
      }
      return new Response(row.body, {
        status: row.status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', [REPLAYED_HEADER]: 'true' },
      });
    }

    await next();
    const res = c.res;
    try {
      const text = res.status >= 200 && res.status < 300 ? await res.clone().text() : null;
      if (text !== null && text.length <= IDEMPOTENCY_MAX_BODY) {
        await run(
          db,
          'UPDATE idempotency_keys SET status = ?, body = ? WHERE user_id = ? AND key = ?',
          res.status,
          text,
          s.userId,
          key,
        );
      } else {
        await run(db, 'DELETE FROM idempotency_keys WHERE user_id = ? AND key = ?', s.userId, key);
      }
    } catch (err) {
      // The write itself succeeded; failing to record it only means a replay would run again.
      console.error(JSON.stringify({ level: 'warn', msg: 'idempotency record failed', error: String(err) }));
    }
  };
}
