/// <reference types="@cloudflare/vitest-plugin/types" />
// D1 round trips per hot endpoint (spec 04 §5 "Performance": /api/me/state is one db.batch). Every
// request first resolves its session in one batch (worker-core lookupSession); the route then adds its
// own. The D1 binding is wrapped so each `batch()`, `first()`, `all()`, `run()`, `raw()` and `exec()`
// counts as one round trip. Requests are measured warm (the per-isolate flag and content caches filled
// by an earlier call), as most real requests are.
import { applyD1Migrations, createExecutionContext, type D1Migration, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { SETTINGS } from '@tie/shared';
import { contentKey, MANIFEST_FILE } from '@tie/shared/content/compile';
import { createSession, type Env } from '@tie/worker-core';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../../src/index';

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
const ORIGIN = 'http://localhost';
const VER = 'c'.repeat(64);

/** The D1 binding, counting round trips into `trips` (statement SQL, or `batch(n)`). */
function countingDb(db: D1Database, trips: string[]): D1Database {
  const targets = new WeakMap<object, D1PreparedStatement>();
  const wrap = (stmt: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const proxy = new Proxy(stmt, {
      get(target, prop) {
        if (prop === 'bind') return (...args: unknown[]) => wrap(target.bind(...args), sql);
        if (prop === 'first' || prop === 'all' || prop === 'run' || prop === 'raw') {
          return (...args: unknown[]) => {
            trips.push(sql.replace(/\s+/g, ' ').trim().slice(0, 80));
            return (target[prop] as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    targets.set(proxy, stmt);
    return proxy;
  };
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return (sql: string) => wrap(target.prepare(sql), sql);
      if (prop === 'batch') {
        return (stmts: D1PreparedStatement[]) => {
          trips.push(`batch(${stmts.length})`);
          return target.batch(stmts.map((s) => targets.get(s) ?? s));
        };
      }
      if (prop === 'exec') {
        return (sql: string) => {
          trips.push(`exec ${sql.slice(0, 60)}`);
          return target.exec(sql);
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

let token = '';

async function trips(path: string, init: { method?: string; body?: unknown; cookies?: string[] } = {}) {
  const log: string[] = [];
  const headers = new Headers({ Cookie: [`tie_s=${token}`, ...(init.cookies ?? [])].join('; ') });
  const method = init.method ?? 'GET';
  if (method !== 'GET') {
    headers.set('Origin', ORIGIN);
    headers.set('Sec-Fetch-Site', 'same-origin');
    headers.set('Content-Type', 'application/json');
  }
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(ORIGIN + path, {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    { ...testEnv, DB: countingDb(testEnv.DB, log) },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return { res, trips: log };
}

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  const now = Date.now();
  const db = testEnv.DB;
  await db.batch([
    db
      .prepare(
        `INSERT INTO plans(id, slug, name, ai_minutes_month, features, is_default, active, created_at, updated_at)
         VALUES ('plan-gratis', 'gratis', 'Grátis', 60, '{}', 1, 1, ?1, ?1)`,
      )
      .bind(now),
    db.prepare(`INSERT INTO users(id, email, created_at) VALUES ('u-rt', 'rt@integ.test', ?1)`).bind(now),
    db
      .prepare(`INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?)`)
      .bind(SETTINGS.contentCurrent, VER, now),
  ]);
  token = (await createSession(db, { userId: 'u-rt', audience: 'app' })).token;
  const manifest = {
    version: VER,
    publishedAt: now,
    files: { catalog: 'catalog.json', episodes: [], ebooks: [], extras: [] },
  };
  await Promise.all([
    testEnv.MEDIA.put(contentKey(VER, MANIFEST_FILE), JSON.stringify(manifest)),
    testEnv.MEDIA.put(contentKey(VER, 'catalog.json'), JSON.stringify({ version: VER, extras: [] })),
  ]);
  // Warm the per-isolate caches (flags, content manifest) like any earlier request would.
  for (const p of ['/api/me/state', '/api/me/summary', '/api/content/manifest', `/api/content/v/${VER}/catalog.json`]) {
    await trips(p);
  }
});

describe('GET /api/me/state?probe=1 (the shell start-up call)', () => {
  const get = async (path: string, cookie?: string) => {
    const ctx = createExecutionContext();
    const headers = cookie ? { Cookie: cookie } : undefined;
    const res = await worker.fetch(new Request(ORIGIN + path, { headers }), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  };

  it('answers 204 with no body when signed out, and 401 without the probe', async () => {
    const res = await get('/api/me/state?probe=1');
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect((await get('/api/me/state')).status).toBe(401);
  });

  it('answers 204 and clears the cookie for an unknown session token', async () => {
    const res = await get('/api/me/state?probe=1', `tie_s=${'x'.repeat(43)}`);
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie().some((c) => c.startsWith('tie_s=;') || /tie_s=.*Max-Age=0/.test(c))).toBe(true);
  });

  it('answers the state for a live session, resolving it once (one session batch)', async () => {
    const log: string[] = [];
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request(`${ORIGIN}/api/me/state?probe=1`, { headers: { Cookie: `tie_s=${token}` } }),
      { ...testEnv, DB: countingDb(testEnv.DB, log) },
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { id: string } }).user.id).toBe('u-rt');
    expect(log).toEqual(['batch(3)', expect.stringMatching(/^batch\(\d+\)$/)]);
  });
});

describe('D1 round trips per hot endpoint (warm isolate)', () => {
  it('GET /api/me/state: the session batch plus one state batch', async () => {
    const { res, trips: t } = await trips('/api/me/state');
    expect(res.status).toBe(200);
    expect(t).toEqual(['batch(3)', expect.stringMatching(/^batch\(\d+\)$/)]);
  });

  it('GET /api/me/summary: the session batch, then three concurrent reads (game, content version, quota)', async () => {
    const { res, trips: t } = await trips('/api/me/summary');
    expect(res.status).toBe(200);
    expect(t[0]).toBe('batch(3)');
    // buildSummary runs them in one Promise.all: two sequential stages of latency.
    expect(t.length, t.join(' | ')).toBeLessThanOrEqual(4);
  });

  it('GET /api/content/manifest and a versioned file: the session batch, then caches only', async () => {
    const m = await trips('/api/content/manifest');
    expect(m.res.status).toBe(200);
    expect(m.trips.length, m.trips.join(' | ')).toBeLessThanOrEqual(2);
    const f = await trips(`/api/content/v/${VER}/catalog.json`);
    expect(f.res.status).toBe(200);
    expect(f.trips.length, f.trips.join(' | ')).toBeLessThanOrEqual(2);
  });

  it('PATCH /api/me/settings: the session batch, the free-steps flag, one write batch', async () => {
    const { res, trips: t } = await trips('/api/me/settings', { method: 'PATCH', body: { sound: false } });
    expect(res.status).toBe(200);
    expect(t).toEqual(['batch(3)', 'batch(1)', 'batch(3)']);
  });
});
