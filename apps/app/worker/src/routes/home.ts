// GET / (wrangler.jsonc run_worker_first "/"): the course home. Every page load gets the landing page
// (web/home.html, built to /home), signed in or not; the app lives at /app, where the shell always
// answers through the SPA fallback (a signed-in learner who taps "Entrar" there goes on to #/inicio).
// Any request to / that is not a page load gets the shell: see isPageLoad. App links
// (/#/entrar?reset=…, /#/certificado/…, an installed app's old start URL /#/inicio) keep their route in
// the hash, which never reaches the server: the landing sends them on to /app (web/public/site/hop.js).
import type { AppEnv } from '@tie/worker-core';
import { Hono } from 'hono';

/** Asset paths, fetched through the ASSETS binding (which never runs the Worker). */
export const HOME_ASSETS = { landing: '/home', shell: '/' } as const;

/**
 * A page load: the only request the landing answers. The service worker precaches the shell by
 * fetching /index.html, which the asset router redirects (307) to `/`. When that fetch got the
 * landing, the landing became the offline shell, and /app#/entrar and /app#/cadastro/… showed the
 * landing (2026-11-26; web/sw/sw.ts repairs those browsers).
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

const home = new Hono<AppEnv>();

home.get('/', async (c) => {
  const target = new URL(isPageLoad(c.req.raw) ? HOME_ASSETS.landing : HOME_ASSETS.shell, c.req.url);
  const asset = await c.env.ASSETS.fetch(new Request(target, c.req.raw));
  const res = new Response(asset.body, asset);
  // The same URL answers two documents: never reuse one for the other.
  res.headers.set('Cache-Control', 'no-cache');
  res.headers.append('Vary', 'Sec-Fetch-Mode, Sec-Fetch-Dest, Accept');
  return res;
});

export default home;
