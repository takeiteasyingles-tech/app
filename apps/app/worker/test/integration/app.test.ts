/// <reference types="@cloudflare/vitest-plugin/types" />
// I1: the assembled worker. Service wiring, routing fallbacks, and the S9 content and media routes
// (manifest ETag, immutable files, premium gate across versions, tie_m media cookie).
import { applyD1Migrations, createExecutionContext, type D1Migration, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { type Catalog, PLAN_FEATURES, SETTINGS } from '@tie/shared';
import { contentKey, MANIFEST_FILE } from '@tie/shared/content/compile';
import { createServices, createSession, type Env, type Services, STUB_SERVICES } from '@tie/worker-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { summaryLevel } from '../../src/game';
import worker, { appServices } from '../../src/index';
import { createContentService } from '../../src/routes/content';

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
const ORIGIN = 'http://localhost';
const VER = 'a'.repeat(64);
const OLD = 'b'.repeat(64);
const MEDIA_KEY = 'media/0123abcd/img/x.webp';

let freeToken = '';
let premiumToken = '';

async function call(
  path: string,
  opts: { token?: string; method?: string; headers?: Record<string, string>; cookies?: string[] } = {},
): Promise<Response> {
  const method = opts.method ?? 'GET';
  const headers = new Headers(opts.headers);
  const cookies = [...(opts.cookies ?? [])];
  if (opts.token) cookies.push(`tie_s=${opts.token}`);
  if (cookies.length) headers.set('Cookie', cookies.join('; '));
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('Origin', ORIGIN);
    headers.set('Sec-Fetch-Site', 'same-origin');
  }
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers }), testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const json = (v: unknown) => JSON.stringify(v);

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  const now = Date.now();
  const db = testEnv.DB;
  await db.batch([
    db
      .prepare(
        `INSERT INTO plans(id, slug, name, ai_minutes_month, features, is_default, active, created_at, updated_at)
         VALUES ('plan-gratis', 'gratis', 'Grátis', 60, '{}', 1, 1, ?1, ?1),
                ('plan-premium', 'premium', 'Premium', 600, ?2, 0, 1, ?1, ?1)`,
      )
      .bind(now, json({ [PLAN_FEATURES.premiumExtras]: true })),
    db
      .prepare(
        `INSERT INTO users(id, email, created_at) VALUES ('u-free', 'free@integ.test', ?1), ('u-prem', 'prem@integ.test', ?1)`,
      )
      .bind(now),
    db.prepare(`INSERT INTO user_plans(user_id, plan_id, assigned_at) VALUES ('u-prem', 'plan-premium', ?)`).bind(now),
    db
      .prepare(`INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?)`)
      .bind(SETTINGS.contentCurrent, VER, now),
  ]);
  freeToken = (await createSession(db, { userId: 'u-free', audience: 'app' })).token;
  premiumToken = (await createSession(db, { userId: 'u-prem', audience: 'app' })).token;

  const manifest = {
    version: VER,
    publishedAt: now,
    files: { catalog: 'catalog.json', episodes: [], ebooks: [], extras: ['gold', 'open'] },
  };
  const catalog = {
    version: VER,
    extras: [
      { id: 'gold', premium: true },
      { id: 'open', premium: false },
    ],
  };
  const put = (ver: string, file: string, body: unknown) => testEnv.MEDIA.put(contentKey(ver, file), json(body));
  await Promise.all([
    put(VER, MANIFEST_FILE, manifest),
    put(VER, 'catalog.json', catalog),
    put(VER, 'extra/gold.json', { id: 'gold', premium: true }),
    put(VER, 'extra/open.json', { id: 'open', premium: false }),
    // An older version in which 'gold' was still free.
    put(OLD, 'extra/gold.json', { id: 'gold', premium: false }),
    testEnv.MEDIA.put(MEDIA_KEY, new Uint8Array(64).fill(7), { httpMetadata: { contentType: 'image/webp' } }),
  ]);
});

describe('service wiring', () => {
  it('registers a real implementation for every worker-core service', () => {
    const services = createServices(testEnv, appServices);
    for (const name of Object.keys(STUB_SERVICES) as (keyof Services)[]) {
      expect(services[name], name).not.toBe(STUB_SERVICES[name]);
    }
  });

  it('answers /api/health from the AI routes (demo mode without the AI binding)', async () => {
    const res = await call('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ai: false, model: '' });
  });

  it('answers unknown API and media paths with the error envelope', async () => {
    for (const path of ['/api/nope', '/m/content/x/catalog.json']) {
      const res = await call(path, { token: freeToken });
      expect(res.status, path).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found');
    }
  });
});

describe('GET /api/content/*', () => {
  it('requires a session', async () => {
    expect((await call('/api/content/manifest')).status).toBe(401);
    expect((await call(`/api/content/v/${VER}/catalog.json`)).status).toBe(401);
  });

  it('serves the manifest with an ETag, issues tie_m, and revalidates with 304', async () => {
    const res = await call('/api/content/manifest', { token: freeToken });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { version: string }).version).toBe(VER);
    expect(res.headers.get('Cache-Control')).toContain('no-cache');
    expect(res.headers.getSetCookie().some((c) => c.startsWith('tie_m='))).toBe(true);
    const etag = res.headers.get('ETag');
    expect(etag).toBeTruthy();
    const again = await call('/api/content/manifest', { token: freeToken, headers: { 'If-None-Match': etag ?? '' } });
    expect(again.status).toBe(304);
  });

  it('serves versioned files as immutable and 404s unknown ones', async () => {
    const res = await call(`/api/content/v/${VER}/extra/open.json`, { token: freeToken });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('immutable');
    expect((await call(`/api/content/v/${VER}/extra/missing.json`, { token: freeToken })).status).toBe(404);
  });

  it('gates premium extras by plan, also through an older version where they were free', async () => {
    expect((await call(`/api/content/v/${VER}/extra/gold.json`, { token: freeToken })).status).toBe(403);
    expect((await call(`/api/content/v/${OLD}/extra/gold.json`, { token: freeToken })).status).toBe(403);
    expect((await call(`/api/content/v/${VER}/extra/gold.json`, { token: premiumToken })).status).toBe(200);
    expect((await call(`/api/content/v/${OLD}/extra/gold.json`, { token: premiumToken })).status).toBe(200);
  });
});

describe('ContentService', () => {
  it('hands each request its own copy of the shared parsed files', async () => {
    const a = await createContentService(testEnv).catalog();
    (a as Catalog).extras.length = 0;
    const b = await createContentService(testEnv).catalog();
    expect(b.extras.map((x) => x.id)).toEqual(['gold', 'open']);
  });
});

describe('GET /m/*', () => {
  it('needs tie_m or a session for content media, and supports Range', async () => {
    expect((await call(`/m/${MEDIA_KEY}`)).status).toBe(401);
    const viaSession = await call(`/m/${MEDIA_KEY}`, { token: freeToken });
    expect(viaSession.status).toBe(200);
    const media = viaSession.headers
      .getSetCookie()
      .find((c) => c.startsWith('tie_m='))
      ?.split(';')[0];
    expect(media).toBeTruthy();
    const ranged = await call(`/m/${MEDIA_KEY}`, { cookies: [media ?? ''], headers: { Range: 'bytes=0-15' } });
    expect(ranged.status).toBe(206);
    expect((await ranged.arrayBuffer()).byteLength).toBe(16);
  });
});

describe('summaryLevel', () => {
  it('keeps pct within 0..100 when the admin level table starts above 0', () => {
    const levels = [
      [10, 'A'],
      [20, 'B'],
    ] as const;
    expect(summaryLevel(0, levels)).toMatchObject({ n: 1, name: 'A', pct: 0 });
    expect(summaryLevel(15, levels).pct).toBe(50);
    expect(summaryLevel(25, levels)).toMatchObject({ n: 2, pct: 100 });
  });
});
