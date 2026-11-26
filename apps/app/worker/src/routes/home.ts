// GET / (wrangler.jsonc run_worker_first "/"): the course home. A visitor without a session gets the
// landing page (web/home.html, built to /home); a learner with a session cookie gets the app shell, as
// before. Only the cookie's presence is checked: an expired session still opens the shell, which signs
// the learner in again. App links (/#/entrar?reset=…, /#/certificado/…) keep their route in the hash,
// which never reaches the server: the landing sends them on to /app (web/public/site/hop.js), where the
// shell always answers through the SPA fallback.
import { type AppEnv, readSessionCookie } from '@tie/worker-core';
import { Hono } from 'hono';

/** Asset paths, fetched through the ASSETS binding (which never runs the Worker). */
export const HOME_ASSETS = { landing: '/home', shell: '/' } as const;

const home = new Hono<AppEnv>();

home.get('/', async (c) => {
  const learner = readSessionCookie(c, 'app') !== undefined;
  const target = new URL(learner ? HOME_ASSETS.shell : HOME_ASSETS.landing, c.req.url);
  const asset = await c.env.ASSETS.fetch(new Request(target, c.req.raw));
  const res = new Response(asset.body, asset);
  // The same URL answers two documents: never reuse one for the other.
  res.headers.set('Cache-Control', 'no-cache');
  res.headers.append('Vary', 'Cookie');
  return res;
});

export default home;
