// GET / (wrangler.jsonc run_worker_first "/"): the course home. A visitor's page load gets the landing
// page (web/home.html, built to /home); everything else gets the app shell, as before: a learner with a
// session cookie, and any request that is not a page load. Only the cookie's presence is checked: an
// expired session still opens the shell, which signs the learner in again. App links
// (/#/entrar?reset=…, /#/certificado/…) keep their route in the hash, which never reaches the server: the
// landing sends them on to /app (web/public/site/hop.js), where the shell always answers through the SPA
// fallback.
import { type AppEnv, readSessionCookie } from '@tie/worker-core';
import { Hono } from 'hono';

/** Asset paths, fetched through the ASSETS binding (which never runs the Worker). */
export const HOME_ASSETS = { landing: '/home', shell: '/' } as const;

/**
 * A top-level page load: the only request the landing answers. The service worker precaches the shell
 * by fetching /index.html, which the asset router redirects (307) to `/`, with no session on a visitor's
 * device. When that fetch got the landing, the landing became the offline shell, and /app#/entrar and
 * /app#/cadastro/… showed the landing (2026-11-26; web/sw/sw.ts repairs those browsers). Browsers
 * without Fetch Metadata fall back on Accept: a page load asks for text/html, the precache for any type.
 */
export function isPageLoad(req: Request): boolean {
  const dest = req.headers.get('Sec-Fetch-Dest');
  if (dest) return dest === 'document';
  return (req.headers.get('Accept') ?? '').includes('text/html');
}

const home = new Hono<AppEnv>();

home.get('/', async (c) => {
  const learner = readSessionCookie(c, 'app') !== undefined;
  const landing = !learner && isPageLoad(c.req.raw);
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
