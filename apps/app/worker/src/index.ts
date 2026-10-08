// tie-app Worker. Static Assets serve the PWA; this runs only for /api/* and /m/* (run_worker_first).
import { appApi, type Health } from '@tie/shared';
import { type AppEnv, createApp, type Env, fail } from '@tie/worker-core';
import type { Hono } from 'hono';
import ai from './routes/ai';
import auth from './routes/auth';
import content from './routes/content';
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

const MULTIPART = new Set([`POST ${appApi.me.photoUpload.path}`]);

const app = createApp({ multipart: (path, method) => MULTIPART.has(`${method} ${path}`) });

// Until S7 wires Workers AI, the client stays in demo mode.
app.get(appApi.ai.health.path, (c) => c.json({ ai: false, model: '' } satisfies Health));

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
} satisfies ExportedHandler<Env>;
