// S9 Media: GET/HEAD /m/<r2 key> (spec 04 §3 "/m/*", §5 "R2"). The bucket is private; this route
// is the only way in. Range, ETag/If-None-Match and If-Range come from worker-core serveObject.
// - media/{sha8}/… (content media): needs the signed tie_m cookie (12h, verified without D1). When it
//   is missing or expired but the app session is valid, a fresh cookie is issued and the file served.
// - users/… (user uploads): served only to the owner, or to staff (users.read), while the upload is
//   active (removed uploads stay visible to staff for moderation).
// - anything else (content/ snapshots, tts/ cache, unknown prefixes): 404.
import { can } from '@tie/shared';
import {
  type AppEnv,
  checkRateLimit,
  clientIp,
  fail,
  HOUR,
  issueMediaCookie,
  loadSession,
  one,
  readMediaCookie,
  serveObject,
} from '@tie/worker-core';
import { type Context, Hono } from 'hono';

const routes = new Hono<AppEnv>();

/** Content media keys change whenever the bytes do, so they cache forever (privately: cookie-gated). */
export const CONTENT_MEDIA_CACHE = 'private, max-age=31536000, immutable';
/** Uploads can be removed by moderation: always revalidate. */
export const UPLOAD_CACHE = 'private, no-cache';
const MEDIA_REFRESH_MS = 6 * HOUR;
const MAX_KEY = 512;

/** '/m/media/ab12cd34/img/x.webp' → 'media/ab12cd34/img/x.webp'; null for anything suspicious. */
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

const resolveSession = loadSession('app');
const noop = async () => {};

/** The app session, looked up only when needed (one D1 batch); null when absent or invalid. */
async function sessionLazy(c: Context<AppEnv>) {
  await resolveSession(c, noop);
  return c.get('session') ?? null;
}

async function contentAllowed(c: Context<AppEnv>): Promise<boolean> {
  const claims = await readMediaCookie(c);
  const now = Date.now();
  if (claims && claims.expiresAt - now >= MEDIA_REFRESH_MS) return true;
  // Missing, expired or about to expire: fall back to the session (one D1 read) and re-issue tie_m.
  const s = await sessionLazy(c);
  if (s && s.audience === 'app') {
    await issueMediaCookie(c, s.userId, now);
    return true;
  }
  return !!claims;
}

interface UploadRow {
  user_id: string;
  status: string;
  mime: string;
}

async function uploadAllowed(c: Context<AppEnv>, key: string): Promise<UploadRow | null> {
  const row = await one<UploadRow>(c.env.DB, 'SELECT user_id, status, mime FROM uploads WHERE r2_key = ?', key);
  if (!row) return null;
  const s = await sessionLazy(c);
  if (!s) throw fail('unauthorized');
  const staff = can(s.roles, 'users.read');
  if (staff) return row;
  if (s.userId === row.user_id && row.status === 'active') return row;
  return null;
}

/**
 * RL_API key for /m/*: the user named by a valid tie_m cookie, else the client IP. Media has its own
 * key prefix so video Range requests never eat into the user's /api budget (and vice versa).
 */
async function mediaRateKey(c: Context<AppEnv>): Promise<string> {
  const claims = await readMediaCookie(c);
  return claims ? `m:u:${claims.userId}` : `m:ip:${clientIp(c)}`;
}

async function serve(c: Context<AppEnv>): Promise<Response> {
  await checkRateLimit(c.env, 'RL_API', await mediaRateKey(c));
  const key = mediaKeyFromPath(new URL(c.req.url).pathname);
  if (!key) throw fail('not_found');
  let res: Response;
  if (key.startsWith('media/')) {
    if (!(await contentAllowed(c))) throw fail('unauthorized');
    res = await serveObject(c.env.MEDIA, key, c.req.raw, { cacheControl: CONTENT_MEDIA_CACHE });
  } else if (key.startsWith('users/')) {
    const row = await uploadAllowed(c, key);
    if (!row) throw fail('not_found');
    res = await serveObject(c.env.MEDIA, key, c.req.raw, {
      cacheControl: UPLOAD_CACHE,
      contentType: row.mime,
      headers: { 'Content-Disposition': 'inline' },
    });
  } else {
    throw fail('not_found');
  }
  if (res.status === 404) throw fail('not_found');
  // Materialize the context response so Hono merges its prepared headers (a refreshed tie_m
  // Set-Cookie) into the R2 response when the handler returns it.
  void c.res;
  return res;
}

// No session middleware: content media is authorized by the tie_m HMAC alone (no D1 per Range
// request); the session is looked up only for uploads or to re-issue an expiring tie_m.
routes.on(['GET', 'HEAD'], '/m/*', (c) => serve(c));

export default routes;
