// tie-app Worker. Static Assets serve the PWA; this runs only for /api/* and /m/* (run_worker_first).
import { appApi, isOutboxPath } from '@tie/shared';
import { type AppEnv, createApp, type Env, fail, idempotency, type ServiceFactories } from '@tie/worker-core';
import type { Hono } from 'hono';
import { quotaFactory } from './ai/quota';
import { awardFactory } from './game';
import { runRetention } from './retention';
import ai from './routes/ai';
import auth from './routes/auth';
import content, { contentServiceFactory } from './routes/content';
import ebook from './routes/ebook';
import extras from './routes/extras';
import game from './routes/game';
import me from './routes/me';
import media from './routes/media';
import mic from './routes/mic';
import progress from './routes/progress';
import reports from './routes/reports';
import srs from './routes/srs';
import uploads from './routes/uploads';
import { srsServiceFactory } from './services/srs.impl';

const MULTIPART = new Set([`POST ${appApi.me.photoUpload.path}`]);

/** Real implementations for every worker-core service (I1); nothing resolves to a stub. */
export const appServices = {
  award: awardFactory,
  srs: srsServiceFactory,
  quota: quotaFactory,
  content: contentServiceFactory,
} satisfies Required<ServiceFactories>;

const app = createApp({
  multipart: (path, method) => MULTIPART.has(`${method} ${path}`),
  services: appServices,
});

// The offline outbox's writes are applied once per Idempotency-Key (spec 06 "Offline outbox").
app.use('/api/*', idempotency({ applies: (path) => isOutboxPath(path) }));

// GET /api/health is answered by routes/ai (S7).
const slices: Hono<AppEnv>[] = [
  auth,
  me,
  uploads,
  progress,
  ebook,
  srs,
  extras,
  game,
  mic,
  ai,
  reports,
  content,
  media,
];
for (const routes of slices) app.route('/', routes);

// Unmatched API and media paths get the error envelope; anything else (only reachable if the asset
// routing changes) falls through to the static assets.
app.all('*', (c) => {
  const p = c.req.path;
  if (p.startsWith('/api/') || p === '/api' || p.startsWith('/m/')) throw fail('not_found');
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  // triggers.crons in wrangler.jsonc: the daily retention run (retention.ts).
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runRetention(env, controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
