// GET / (wrangler.jsonc run_worker_first "/"): the course home. A visitor's page load gets the landing
// page (web/home.html, built to /home); everything else gets the app shell, as before: a learner with a
// valid session, and any request that is not a page load. The session is looked up, not just the
// cookie: an expired or revoked one would open the shell only for it to send the visitor to #/entrar.
// App links (/#/entrar?reset=…, /#/certificado/…) keep their route in the hash, which never reaches the
// server: the landing sends them on to /app (web/public/site/hop.js), where the shell always answers
// through the SPA fallback.
import { type AppEnv, lookupSession, readSessionCookie } from '@tie/worker-core';
import { Hono } from 'hono';

/** Asset paths, fetched through the ASSETS binding (which never runs the Worker). */
export const HOME_ASSETS = { landing: '/home', shell: '/' } as const;

/**
 * A page load: the only request the landing answers. The service worker precaches the shell by
 * fetching /index.html, which the asset router redirects (307) to `/`, with no session on a visitor's
 * device. When that fetch got the landing, the landing became the offline shell, and /app#/entrar and
 * /app#/cadastro/… showed the landing (2026-11-26; web/sw/sw.ts repairs those browsers).
 * A page load the service worker passes on (sw.ts, `/`) is not marked as one the same way everywhere:
 * Chromium sends it with Sec-Fetch-Dest: empty but keeps Sec-Fetch-Mode: navigate and the page's
 * Accept. Any of the three counts; the precache fetch has none (Dest empty, Mode cors, Accept *\/*).
 */
export function isPageLoad(req: Request): boolean {
  return (
    req.headers.get('Sec-Fetch-Mode') === 'navigate' ||
    req.headers.get('Sec-Fetch-Dest') === 'document' ||
    (req.headers.get('Accept') ?? '').includes('text/html')
  );
}

/** A valid app session for this cookie (one D1 round trip; none without a cookie). */
async function hasSession(db: D1Database, token: string | undefined): Promise<boolean> {
  return token !== undefined && (await lookupSession(db, token, 'app')).ok;
}

const home = new Hono<AppEnv>();

home.get('/', async (c) => {
  const landing = isPageLoad(c.req.raw) && !(await hasSession(c.env.DB, readSessionCookie(c, 'app')));
  const target = new URL(landing ? HOME_ASSETS.landing : HOME_ASSETS.shell, c.req.url);
  const asset = await c.env.ASSETS.fetch(new Request(target, c.req.raw));
  const res = new Response(asset.body, asset);
  // The same URL answers two documents: never reuse one for the other.
  res.headers.set('Cache-Control', 'no-cache');
  res.headers.append('Vary', 'Cookie');
  res.headers.append('Vary', 'Sec-Fetch-Dest');
  return res;
});

export default home;
