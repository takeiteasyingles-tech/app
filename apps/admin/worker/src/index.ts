// tie-admin Worker. Static Assets serve the admin SPA; this runs only for /admin-api/* and /m/*.
import { adminApi } from '@tie/shared/contracts/admin';
import { createApp, type Env, fail } from '@tie/worker-core';
import routes from './routes/index';

const MULTIPART = new Set([`POST ${adminApi.media.upload.path}`]);

const app = createApp({ multipart: (path, method) => MULTIPART.has(`${method} ${path}`) });

app.route('/', routes);

app.all('*', (c) => {
  const p = c.req.path;
  if (p.startsWith('/admin-api/') || p === '/admin-api' || p.startsWith('/m/')) throw fail('not_found');
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
