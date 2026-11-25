// tie-admin Worker. Static Assets serve the admin SPA; this runs only for /admin-api/* and /m/*.
import { adminApi } from '@tie/shared/contracts/admin';
import { MCP_PATH } from '@tie/shared/contracts/mcp';
import { createApp, type Env, fail } from '@tie/worker-core';
import { runScheduledBackup } from './lib/backups';
import { staffWriter } from './lib/entityCrud';
import routes from './routes/index';
import { autoPublish, publishesContent } from './routes/publish';

const MULTIPART = new Set([
  `POST ${adminApi.media.upload.path}`,
  `POST ${adminApi.voices.clone.path}`,
  `POST ${adminApi.songLyrics.run.path}`,
]);

/** The admin app: shared middleware (headers, config guard, CSRF, JSON cap) + every admin route. */
export function buildAdminApp() {
  const app = createApp({
    multipart: (path, method) => MULTIPART.has(`${method} ${path}`),
    // MCP (spec 07): Bearer API tokens, no cookie; csrf still checks any request that has a cookie.
    bearer: (path) => path === MCP_PATH,
  });
  // PROD (spec 05 "Saving publishes"): a content save that succeeded goes live at once. The save is
  // already committed; a publish problem never undoes it, it only comes back in X-Content-Publish
  // (published | unchanged | failed) and X-Content-Publish-Error, which the admin shows as a toast.
  app.use('/admin-api/*', async (c, next) => {
    await next();
    const method = c.req.method;
    if (!publishesContent(method, c.req.path) || c.res.status >= 300 || !c.get('session')) return;
    // Part of a save made of several requests: the client publishes once at the end (C.autoPublish).
    if (c.req.header('X-Publish') === 'defer') return;
    let status: string;
    let message = '';
    try {
      const r = await autoPublish(c, staffWriter(c), { method, path: c.req.path });
      status = r.status;
      if (r.status === 'failed') message = r.message;
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'auto publish failed',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      status = 'failed';
      message = 'Salvo, mas a publicação automática falhou. Tente salvar de novo.';
    }
    c.res = new Response(c.res.body, c.res);
    c.res.headers.set('X-Content-Publish', status);
    if (message) c.res.headers.set('X-Content-Publish-Error', encodeURIComponent(message.slice(0, 300)));
  });
  app.route('/', routes);
  app.all('*', (c) => {
    const p = c.req.path;
    if (p.startsWith('/admin-api/') || p === '/admin-api' || p.startsWith('/m/')) throw fail('not_found');
    return c.env.ASSETS.fetch(c.req.raw);
  });
  return app;
}

const app = buildAdminApp();

export default {
  fetch: app.fetch,
  // Hourly (wrangler.jsonc triggers): makes the automatic backup when its configured slot comes.
  scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runScheduledBackup(env, controller.scheduledTime).catch((err: unknown) => {
        console.error(
          JSON.stringify({
            level: 'error',
            msg: 'scheduled backup failed',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }),
    );
  },
} satisfies ExportedHandler<Env>;
