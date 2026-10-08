import { ApiError, LoginBody } from '@tie/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app';
import { requireRole, requireUser } from '../src/auth/middleware';
import type { Env } from '../src/env';
import { NotImplementedError } from '../src/errors';
import { CSP } from '../src/headers';
import { vJson, vParam } from '../src/validate';
import { FakeD1 } from './helpers/fakeD1';

const ORIGIN = 'https://tie-app.example.workers.dev';

function env(over: Partial<Env> = {}): Env {
  return {
    APP_ORIGIN: ORIGIN,
    DB: new FakeD1().asD1(),
    MEDIA_TOKEN_KEY: 'k',
    IP_HASH_SALT: 's',
    TURNSTILE_SECRET: 'x',
    TURNSTILE_SITEKEY: 'y',
    ...over,
  } as Env;
}

function build() {
  const app = createApp({ multipart: (path) => path === '/api/me/photo' });
  app.get('/api/ok', (c) => c.json({ ok: true }));
  app.post('/api/login', vJson(LoginBody), (c) => c.json({ email: c.req.valid('json').email }));
  app.get('/api/ebooks/:n', vParam(z.object({ n: z.coerce.number().int().positive() })), (c) =>
    c.json({ n: c.req.valid('param').n }),
  );
  app.post('/api/me/photo', (c) => c.json({ ok: true }));
  app.get('/api/boom', () => {
    throw new Error('secret internals at /srv/app.ts:42');
  });
  app.get('/api/gated', () => {
    throw new ApiError('gated');
  });
  app.get('/api/award', async (c) => c.json(await c.get('services').award.award('U1', 'step', 'step:1:1')));
  app.get('/api/me', requireUser(), (c) => c.json({ ok: true }));
  app.get('/admin-api/users', requireRole('moderator'), (c) => c.json({ ok: true }));
  return app;
}

const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  body: JSON.stringify(body),
  headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...headers },
});

describe('createApp', () => {
  it('adds security headers and no-store by default', async () => {
    const res = await build().request('/api/ok', {}, env());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Security-Policy')).toBe(CSP);
    expect(CSP).toContain("frame-ancestors 'none'");
    expect(res.headers.get('Strict-Transport-Security')).toMatch(/max-age=\d+/);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('Permissions-Policy')).toContain('microphone=(self)');
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });

  it('validates JSON bodies into the error envelope', async () => {
    const app = build();
    const good = await app.request('/api/login', post({ email: 'a@b.co', password: 'x', turnstileToken: 't' }), env());
    expect(good.status).toBe(200);
    expect(await good.json()).toEqual({ email: 'a@b.co' });

    const bad = await app.request('/api/login', post({ email: 'nope' }), env());
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: { code: string; details: { issues: { path: string }[] } } };
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details.issues.map((i) => i.path)).toContain('email');
    expect(bad.headers.get('Content-Security-Policy')).toBe(CSP);
  });

  it('validates path params', async () => {
    expect(await (await build().request('/api/ebooks/2', {}, env())).json()).toEqual({ n: 2 });
    expect((await build().request('/api/ebooks/x', {}, env())).status).toBe(400);
  });

  it('maps malformed JSON to bad_request', async () => {
    const res = await build().request('/api/login', { ...post({}), body: '{oops' }, env());
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad_request');
  });

  it('enforces CSRF on writes', async () => {
    const app = build();
    const foreign = await app.request('/api/login', post({}, { Origin: 'https://evil.example' }), env());
    expect(foreign.status).toBe(403);
    expect(((await foreign.json()) as { error: { code: string } }).error.code).toBe('csrf_failed');

    const form = await app.request('/api/login', post({}, { 'Content-Type': 'text/plain' }), env());
    expect(form.status).toBe(415);
    expect(((await form.json()) as { error: { message: string } }).error.message).toBe('Pedido inválido.');

    const multipart = { 'Content-Type': 'multipart/form-data; boundary=abc' };
    expect((await app.request('/api/me/photo', post({}, multipart), env())).status).toBe(200);
    expect((await app.request('/api/login', post({}, multipart), env())).status).toBe(415);
  });

  it('caps JSON bodies with or without Content-Length', async () => {
    const app = createApp({ maxJsonBytes: 64 });
    app.post('/api/echo', vJson(z.object({ s: z.string() })), (c) => c.json(c.req.valid('json')));
    const chunked = (text: string) => {
      const bytes = new TextEncoder().encode(text);
      const body = new ReadableStream<Uint8Array>({
        start(ctrl) {
          for (let i = 0; i < bytes.length; i += 16) ctrl.enqueue(bytes.subarray(i, i + 16));
          ctrl.close();
        },
      });
      return { ...post({}), body, duplex: 'half' } as RequestInit;
    };
    const small = JSON.stringify({ s: 'ok' });
    const big = JSON.stringify({ s: 'x'.repeat(200) });

    const ok = await app.request('/api/echo', chunked(small), env());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ s: 'ok' });

    const over = await app.request('/api/echo', chunked(big), env());
    expect(over.status).toBe(413);
    expect(((await over.json()) as { error: { code: string } }).error.code).toBe('payload_too_large');

    const declared = post({ s: 'x'.repeat(200) }, { 'Content-Length': String(big.length) });
    expect((await app.request('/api/echo', declared, env())).status).toBe(413);
    const fine = post({ s: 'ok' }, { 'Content-Length': String(small.length) });
    expect((await app.request('/api/echo', fine, env())).status).toBe(200);
  });

  it('never leaks internals on unknown errors', async () => {
    const res = await build().request('/api/boom', {}, env());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('secret');
    expect(JSON.parse(text)).toEqual({ error: { code: 'internal', message: expect.any(String) } });
  });

  it('renders ApiError and 404 envelopes', async () => {
    const gated = await build().request('/api/gated', {}, env());
    expect(gated.status).toBe(409);
    expect(((await gated.json()) as { error: { code: string } }).error.code).toBe('gated');
    const nf = await build().request('/api/nope', {}, env());
    expect(nf.status).toBe(404);
    expect(((await nf.json()) as { error: { code: string } }).error.code).toBe('not_found');
  });

  it('service stubs throw NotImplementedError (rendered as 500)', async () => {
    const res = await build().request('/api/award', {}, env());
    expect(res.status).toBe(500);
    expect(new NotImplementedError('X').message).toContain('not implemented');
  });

  it('injects real services when provided', async () => {
    const app = createApp({
      services: {
        award: () => ({
          award: async (_u, kind) => ({
            awarded: true,
            kind,
            points: 10,
            total: 10,
            dayPoints: 10,
            levelUp: null,
            goalHit: false,
            newBadges: [],
            missionsDone: [],
          }),
        }),
      },
    });
    app.get('/x', async (c) => c.json(await c.get('services').award.award('U', 'step', 'k')));
    const res = await app.request('/x', {}, env());
    expect(((await res.json()) as { points: number }).points).toBe(10);
  });

  it('requireUser / requireRole answer 401 without a session cookie', async () => {
    const app = build();
    const me = await app.request('/api/me', {}, env());
    expect(me.status).toBe(401);
    expect(((await me.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
    expect((await app.request('/admin-api/users', {}, env())).status).toBe(401);
  });
});
