// Runs inside workerd against a local D1 (real migrations) and R2: the SQL the Node tests only fake.
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditQuery } from '../src/audit';
import { createSession, hashToken, lookupSession, purgeExpiredSessions, SESSION_POLICY } from '../src/auth/sessions';
import { serveObject } from '../src/r2/serveObject';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const DAY = 86_400_000;

async function exec(sql: string, ...params: unknown[]): Promise<void> {
  await env.DB.prepare(sql)
    .bind(...params)
    .run();
}

async function one<T>(sql: string, ...params: unknown[]): Promise<T | null> {
  return env.DB.prepare(sql)
    .bind(...params)
    .first<T>();
}

beforeEach(async () => {
  await env.DB.batch(
    [
      'DELETE FROM sessions',
      'DELETE FROM user_plans',
      'DELETE FROM user_roles',
      'DELETE FROM point_ledger',
      'DELETE FROM daily_stats',
      'DELETE FROM user_stats',
      'DELETE FROM profiles',
      'DELETE FROM users',
      'DELETE FROM plans',
    ].map((sql) => env.DB.prepare(sql)),
  );
  await exec(
    "INSERT INTO users(id, email, tz, created_at) VALUES('U1', 'ana@example.com', 'America/Sao_Paulo', ?)",
    NOW,
  );
  await exec("INSERT INTO profiles(user_id, full_name, name, updated_at) VALUES('U1', 'Ana Souza', 'Ana', ?)", NOW);
  await exec(
    `INSERT INTO plans(id, slug, name, ai_minutes_month, features, is_default, active, created_at, updated_at)
     VALUES('P0', 'gratis', 'Grátis', 30, '{}', 1, 1, ?1, ?1), ('P1', 'premium', 'Premium', 600, '{"hd":true}', 0, 1, ?1, ?1)`,
    NOW,
  );
});

describe('lookupSession on D1', () => {
  it('joins user, profile, roles and the assigned plan', async () => {
    await exec("INSERT INTO user_roles(user_id, role, granted_at) VALUES('U1', 'editor', ?)", NOW);
    await exec("INSERT INTO user_plans(user_id, plan_id, assigned_at) VALUES('U1', 'P1', ?)", NOW);
    const { token } = await createSession(env.DB, { userId: 'U1', audience: 'app', now: NOW });

    const res = await lookupSession(env.DB, token, 'app', NOW + 1000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.session).toMatchObject({
      userId: 'U1',
      email: 'ana@example.com',
      name: 'Ana',
      fullName: 'Ana Souza',
      tz: 'America/Sao_Paulo',
      roles: ['editor'],
      plan: { id: 'P1', slug: 'premium', aiMinutesMonth: 600, features: { hd: true } },
    });
    expect((await lookupSession(env.DB, token, 'admin', NOW)).ok).toBe(false);
  });

  it('falls back to the default plan when the assigned plan is inactive or expired', async () => {
    await exec("INSERT INTO user_plans(user_id, plan_id, assigned_at) VALUES('U1', 'P1', ?)", NOW);
    await exec("UPDATE plans SET active = 0 WHERE id = 'P1'");
    const { token } = await createSession(env.DB, { userId: 'U1', audience: 'app', now: NOW });
    const inactive = await lookupSession(env.DB, token, 'app', NOW);
    expect(inactive.ok && inactive.session.plan?.slug).toBe('gratis');

    await exec("UPDATE plans SET active = 1 WHERE id = 'P1'");
    await exec("UPDATE user_plans SET expires_at = ? WHERE user_id = 'U1'", NOW - 1);
    const expired = await lookupSession(env.DB, token, 'app', NOW);
    expect(expired.ok && expired.session.plan?.slug).toBe('gratis');

    await exec("UPDATE plans SET active = 0 WHERE id = 'P0'");
    const none = await lookupSession(env.DB, token, 'app', NOW);
    expect(none.ok && none.session.plan).toBeNull();
  });

  it('slides app sessions, deletes expired ones and purges', async () => {
    const { token, tokenHash } = await createSession(env.DB, { userId: 'U1', audience: 'app', now: NOW });
    expect(tokenHash).toBe(await hashToken(token));

    const later = NOW + SESSION_POLICY.app.touchEveryMs;
    const touched = await lookupSession(env.DB, token, 'app', later);
    expect(touched.ok && touched.touched).toBe(true);
    const row = await one<{ expires_at: number }>('SELECT expires_at FROM sessions WHERE token_hash = ?', tokenHash);
    expect(row?.expires_at).toBe(later + SESSION_POLICY.app.ttlMs);

    expect(await lookupSession(env.DB, token, 'app', later + SESSION_POLICY.app.ttlMs + 1)).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(await one('SELECT 1 AS x FROM sessions WHERE token_hash = ?', tokenHash)).toBeNull();

    await createSession(env.DB, { userId: 'U1', audience: 'admin', now: NOW });
    await createSession(env.DB, { userId: 'U1', audience: 'app', now: NOW });
    expect(await purgeExpiredSessions(env.DB, NOW + DAY)).toBe(1); // the idle admin session
  });

  it('refuses suspended users', async () => {
    const { token } = await createSession(env.DB, { userId: 'U1', audience: 'app', now: NOW });
    await exec("UPDATE users SET status = 'suspended' WHERE id = 'U1'");
    expect(await lookupSession(env.DB, token, 'app', NOW)).toEqual({ ok: false, reason: 'suspended' });
  });
});

describe('point ledger trigger', () => {
  const award = (key: string, kind: string, points: number, date: string, sec = 0) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO point_ledger(user_id, award_key, kind, points, local_date, maggie_sec, created_at)
       VALUES('U1', ?, ?, ?, ?, ?, ?)`,
    ).bind(key, kind, points, date, sec, NOW);

  it('rolls awards into user_stats and daily_stats once per award key', async () => {
    await env.DB.batch([
      award('step:1:1', 'step', 10, '2026-10-01'),
      award('card:x', 'card', 2, '2026-10-01'),
      award('maggie:s1', 'maggie_turn', 5, '2026-10-01', 30),
      award('step:1:1', 'step', 10, '2026-10-01'),
      award('mic:p1', 'mic_good', 15, '2026-10-02'),
    ]);
    expect(await one('SELECT points FROM user_stats WHERE user_id = ?', 'U1')).toEqual({ points: 32 });
    expect(
      await one(
        'SELECT points, steps, cards, mic, maggie_sec FROM daily_stats WHERE user_id = ? AND local_date = ?',
        'U1',
        '2026-10-01',
      ),
    ).toEqual({ points: 17, steps: 1, cards: 1, mic: 0, maggie_sec: 30 });
    expect(
      await one('SELECT points, mic FROM daily_stats WHERE user_id = ? AND local_date = ?', 'U1', '2026-10-02'),
    ).toEqual({ points: 15, mic: 1 });
  });
});

describe('audit_log', () => {
  it('is append-only', async () => {
    await auditQuery(env.DB, {
      at: NOW,
      actorUserId: 'U1',
      actorRole: 'editor',
      action: 'ebook.update',
      targetType: 'ebook',
      targetId: '1',
      before: { passScore: 7 },
      after: { passScore: 8 },
      ipHash: null,
      ua: null,
    }).stmt.run();
    const row = await one<{ id: number; diff: string }>('SELECT id, diff FROM audit_log ORDER BY id DESC LIMIT 1');
    expect(JSON.parse(row?.diff ?? '{}')).toEqual({ passScore: { from: 7, to: 8 } });
    await expect(exec('DELETE FROM audit_log WHERE id = ?', row?.id)).rejects.toThrow(/append-only/);
    await expect(exec("UPDATE audit_log SET action = 'x' WHERE id = ?", row?.id)).rejects.toThrow(/append-only/);
  });
});

describe('serveObject on R2', () => {
  const KEY = 'media/abcd1234/clip.mp3';
  const BYTES = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));
  const opts = { cacheControl: 'private, max-age=31536000, immutable' };
  const req = (headers: Record<string, string> = {}, method = 'GET') =>
    new Request(`https://tie.test/m/${KEY}`, { method, headers });

  beforeEach(async () => {
    await env.MEDIA.put(KEY, BYTES, { httpMetadata: { contentType: 'audio/mpeg' } });
  });

  it('serves the full object with validators', async () => {
    const res = await serveObject(env.MEDIA, KEY, req(), opts);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(res.headers.get('Content-Length')).toBe('100');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Cache-Control')).toBe(opts.cacheControl);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);

    const etag = res.headers.get('ETag') ?? '';
    expect(etag).toMatch(/^"/);
    const cached = await serveObject(env.MEDIA, KEY, req({ 'If-None-Match': etag }), opts);
    expect(cached.status).toBe(304);
  });

  it('serves byte ranges, HEAD, 416 and 404', async () => {
    const part = await serveObject(env.MEDIA, KEY, req({ Range: 'bytes=10-19' }), opts);
    expect(part.status).toBe(206);
    expect(part.headers.get('Content-Range')).toBe('bytes 10-19/100');
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(BYTES.slice(10, 20));

    const tail = await serveObject(env.MEDIA, KEY, req({ Range: 'bytes=-5' }), opts);
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(BYTES.slice(95));

    const head = await serveObject(env.MEDIA, KEY, req({}, 'HEAD'), opts);
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Length')).toBe('100');

    const bad = await serveObject(env.MEDIA, KEY, req({ Range: 'bytes=200-300' }), opts);
    expect(bad.status).toBe(416);
    expect(bad.headers.get('Content-Range')).toBe('bytes */100');

    expect((await serveObject(env.MEDIA, 'media/none', req(), opts)).status).toBe(404);
  });
});
