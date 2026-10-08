// Wiring: the route modules behind the real middleware stack (createApp), with the session injected
// and the AwardService / SrsService fakes registered as the services.
import type { SessionInfo } from '@tie/worker-core';
import { createApp, type Env } from '@tie/worker-core';
import { describe, expect, it } from 'vitest';
import ebookRoutes from '../../routes/ebook';
import progressRoutes from '../../routes/progress';
import { SECRET, USER, type World, world } from './helpers/fixtures';

const ORIGIN = 'http://localhost';

function app(w: World, signedIn = true) {
  const a = createApp({ services: { award: () => w.award, srs: () => w.srs } });
  if (signedIn) {
    a.use('*', async (c, next) => {
      const session: SessionInfo = {
        tokenHash: 'h',
        audience: 'app',
        userId: USER,
        email: 'a@x.test',
        name: 'A',
        fullName: 'A',
        tz: 'America/Sao_Paulo',
        roles: [],
        plan: null,
        createdAt: 0,
        lastSeenAt: 0,
        expiresAt: Number.MAX_SAFE_INTEGER,
      };
      c.set('session', session);
      await next();
    });
  }
  a.route('/', progressRoutes);
  a.route('/', ebookRoutes);
  const env = { APP_ORIGIN: ORIGIN, DB: w.db.asD1(), MEDIA_TOKEN_KEY: SECRET } as Env;
  return (method: string, path: string, body?: unknown) =>
    a.request(
      path,
      {
        method,
        headers: { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
}

describe('learning routes', () => {
  it('require a session', async () => {
    const call = app(world(), false);
    const res = await call('POST', '/api/progress/advance', { ep: 1, step: 2 });
    expect(res.status).toBe(401);
    expect((await call('POST', '/api/ebooks/1/download')).status).toBe(401);
  });

  it('answer gated steps with 409 gated and the need() message', async () => {
    const res = await app(world())('POST', '/api/progress/advance', { ep: 1, step: 2 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: 'gated', message: 'Ouça a abertura até o fim', details: { prog: 1, step: 2 } },
    });
  });

  it('validate bodies and params with the shared contracts', async () => {
    const call = app(world());
    expect((await call('POST', '/api/progress/advance', { ep: 1, step: 11 })).status).toBe(400);
    expect((await call('POST', '/api/progress/exercise', { itemId: 'x', choice: 7 })).status).toBe(400);
    expect((await call('POST', '/api/ebooks/abc/download')).status).toBe(400);
  });

  it('serve the happy path end to end', async () => {
    const w = world();
    const call = app(w);
    expect(await (await call('POST', '/api/progress/step-ok', { ep: 1, step: 1 })).json()).toEqual({
      stepOk: '1-1',
      award: null,
    });
    const adv = await call('POST', '/api/progress/advance', { ep: 1, step: 2 });
    expect(adv.status).toBe(200);
    expect(await adv.json()).toMatchObject({ prog: 2, award: { kind: 'step', awarded: true } });

    expect(await (await call('POST', '/api/ebooks/1/download')).json()).toEqual({
      ebook: 1,
      pdf: '/m/media/bb/ebook1.pdf',
    });
    expect(await (await call('PUT', '/api/ebooks/1/test/answers', { answers: { 'eb1-t1': 0 } })).json()).toEqual({
      ok: true,
    });
    const sub = await call('POST', '/api/ebooks/1/test/submit', {});
    expect(await sub.json()).toMatchObject({ ebook: 1, score: 1, total: 6, passed: false });
  });
});
