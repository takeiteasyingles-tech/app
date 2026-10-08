/// <reference types="@cloudflare/vitest-plugin/types" />
// Spec 06 on the assembled worker: Idempotency-Key on the outbox's writes, the /m/* rate limit and
// the retention cron (scheduled handler).
import {
  applyD1Migrations,
  createExecutionContext,
  createScheduledController,
  type D1Migration,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { IDEMPOTENCY_HEADER, OUTBOX_USER_HEADER, SETTINGS } from '@tie/shared';
import { createSession, type Env, REPLAYED_HEADER } from '@tie/worker-core';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../../src/index';
import { runRetention, TRANSCRIPT_DAYS_DEFAULT, transcriptDays } from '../../src/retention';

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
const ORIGIN = 'http://localhost';
const DAY = 86_400_000;

let tokenA = '';
let tokenB = '';

async function call(
  path: string,
  opts: { token?: string; method?: string; headers?: Record<string, string>; body?: unknown; ip?: string } = {},
): Promise<Response> {
  const method = opts.method ?? 'GET';
  const headers = new Headers(opts.headers);
  if (opts.token) headers.set('Cookie', `tie_s=${opts.token}`);
  headers.set('CF-Connecting-IP', opts.ip ?? '10.9.9.9');
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('Origin', ORIGIN);
    headers.set('Sec-Fetch-Site', 'same-origin');
  }
  let body: string | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers.set('Content-Type', 'application/json');
  }
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body }), testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  const db = testEnv.DB;
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO plans(id, slug, name, ai_minutes_month, features, is_default, active, created_at, updated_at)
         VALUES ('plan-gratis', 'gratis', 'Grátis', 60, '{}', 1, 1, ?1, ?1)`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO users(id, email, created_at) VALUES ('u-a', 'a@integ.test', ?1), ('u-b', 'b@integ.test', ?1)`,
      )
      .bind(now),
    db
      .prepare(`INSERT INTO profiles(user_id, name, updated_at) VALUES ('u-a', 'Ana', ?1), ('u-b', 'Bia', ?1)`)
      .bind(now),
    db.prepare(`INSERT INTO user_settings(user_id) VALUES ('u-a'), ('u-b')`),
  ]);
  tokenA = (await createSession(db, { userId: 'u-a', audience: 'app' })).token;
  tokenB = (await createSession(db, { userId: 'u-b', audience: 'app' })).token;
});

describe('Idempotency-Key (offline outbox)', () => {
  const settings = (token: string, key: string, body: unknown, extra: Record<string, string> = {}) =>
    call('/api/me/settings', {
      token,
      method: 'PATCH',
      body,
      headers: { [IDEMPOTENCY_HEADER]: key, ...extra },
    });

  it('answers a replayed key from the stored response without running the write again', async () => {
    const first = await settings(tokenA, 'key-0001-abcdef', { sound: false });
    expect(first.status).toBe(200);
    const firstBody = await first.text();
    // Something else changes the row in between; the replay must not re-apply the old write.
    await testEnv.DB.prepare("UPDATE user_settings SET sound = 1 WHERE user_id = 'u-a'").run();
    const replay = await settings(tokenA, 'key-0001-abcdef', { sound: false });
    expect(replay.status).toBe(200);
    expect(replay.headers.get(REPLAYED_HEADER)).toBe('true');
    expect(await replay.text()).toBe(firstBody);
    expect(await testEnv.DB.prepare("SELECT sound FROM user_settings WHERE user_id = 'u-a'").first()).toEqual({
      sound: 1,
    });
  });

  it('keys are per user, and a key reused on another route is a conflict', async () => {
    expect((await settings(tokenB, 'key-0001-abcdef', { fx: false })).headers.get(REPLAYED_HEADER)).toBeNull();
    const other = await call('/api/me/profile', {
      token: tokenA,
      method: 'PUT',
      body: { name: 'Ana' },
      headers: { [IDEMPOTENCY_HEADER]: 'key-0001-abcdef' },
    });
    expect(other.status).toBe(409);
  });

  it('a failed write frees its key, so the retry runs', async () => {
    const bad = await settings(tokenA, 'key-0002-abcdef', { ts: 'fast' });
    expect(bad.status).toBe(400);
    expect(
      await testEnv.DB.prepare("SELECT key FROM idempotency_keys WHERE key = 'key-0002-abcdef'").first(),
    ).toBeNull();
    expect((await settings(tokenA, 'key-0002-abcdef', { fx: false })).status).toBe(200);
  });

  it('refuses a write queued for another account (X-Tie-User) and ignores non-outbox paths', async () => {
    const res = await settings(tokenB, 'key-0003-abcdef', { fx: true }, { [OUTBOX_USER_HEADER]: 'u-a' });
    expect(res.status).toBe(409);
    expect(
      await testEnv.DB.prepare("SELECT key FROM idempotency_keys WHERE key = 'key-0003-abcdef'").first(),
    ).toBeNull();
    // /api/auth/logout is not queueable: the header changes nothing there.
    const out = await call('/api/auth/logout', {
      method: 'POST',
      body: {},
      headers: { [IDEMPOTENCY_HEADER]: 'key-0004-abcdef' },
    });
    expect(out.status).toBe(200);
  });
});

describe('GET /m/* rate limit (RL_API)', () => {
  it('answers 429 past the RL_API limit for one client', async () => {
    // The local limiter's window is wall-clock aligned (epoch = floor(now / period)), so the loop
    // may straddle a rollover and restart the count. 205 requests over at most two windows put one
    // of them past 100, so a 429 is certain, and at least 100 requests pass before it.
    const statuses: number[] = [];
    for (let i = 0; i < 205; i++) {
      const status = (await call('/m/media/0123abcd/img/x.webp', { ip: '10.7.7.7' })).status;
      statuses.push(status);
      if (status === 429) break;
    }
    const first429 = statuses.indexOf(429);
    expect(first429).toBeGreaterThanOrEqual(100);
    expect(statuses.slice(0, first429).every((s) => s === 401)).toBe(true);
    // Another client is unaffected.
    expect((await call('/m/media/0123abcd/img/x.webp', { ip: '10.7.7.8' })).status).toBe(401);
  });
});

describe('retention cron', () => {
  it('reads retention.transcripts_days, falling back to the default', () => {
    expect(transcriptDays('30')).toBe(30);
    for (const bad of [null, '', '0', '-3', '1.5', 'x']) expect(transcriptDays(bad)).toBe(TRANSCRIPT_DAYS_DEFAULT);
  });

  it('deletes old transcripts (keeping pending moderation evidence), expired sessions and tokens', async () => {
    const db = testEnv.DB;
    const now = Date.now();
    const old = now - 40 * DAY;
    await db.batch([
      db
        .prepare(`INSERT INTO app_settings(key, value, updated_at) VALUES (?, '30', ?)
                  ON CONFLICT(key) DO UPDATE SET value = '30'`)
        .bind(SETTINGS.retentionTranscriptsDays, now),
      db
        .prepare(
          `INSERT INTO mic_sessions(id, user_id, assistant_key, mode, started_at, billed_until, status, flagged)
           VALUES ('S-old', 'u-a', 'margaret', 'livre', ?1, ?1, 'ended', 0),
                  ('S-flag', 'u-a', 'margaret', 'livre', ?1, ?1, 'ended', 1),
                  ('S-new', 'u-a', 'margaret', 'livre', ?2, ?2, 'ended', 0)`,
        )
        .bind(old, now),
      db
        .prepare(
          `INSERT INTO mic_turns(session_id, idx, who, en, created_at) VALUES
           ('S-old', 0, 'me', 'hello', ?1), ('S-old', 1, 'her', 'hi', ?1),
           ('S-flag', 0, 'me', 'bad words', ?1), ('S-new', 0, 'me', 'fresh', ?2)`,
        )
        .bind(old, now),
      db
        .prepare(
          `INSERT INTO moderation_items(id, kind, subject_user_id, ref_type, ref_id, excerpt, status, created_at)
           VALUES ('M1', 'transcript', 'u-a', 'mic_turn', 'S-flag:0', 'bad words', 'pending', ?1),
                  ('M2', 'transcript', 'u-a', 'mic_turn', 'S-old:0', 'hello', 'dismissed', ?1)`,
        )
        .bind(old),
      db
        .prepare(
          `INSERT INTO sessions(token_hash, user_id, audience, created_at, last_seen_at, expires_at)
           VALUES ('expired-hash', 'u-b', 'app', ?1, ?1, ?2)`,
        )
        .bind(old, now - 1),
      db
        .prepare(
          `INSERT INTO one_time_tokens(token_hash, user_id, kind, expires_at) VALUES
           ('ott-old', 'u-b', 'reset', ?1), ('ott-live', 'u-b', 'reset', ?2)`,
        )
        .bind(now - 1, now + DAY),
      db
        .prepare(
          `INSERT INTO idempotency_keys(user_id, key, method, path, status, body, created_at)
           VALUES ('u-a', 'ancient-key-0001', 'PATCH', '/api/me/settings', 200, '{}', ?)`,
        )
        .bind(now - 9 * DAY),
    ]);

    // Through the Worker's scheduled handler, as the cron trigger calls it.
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: now, cron: '17 6 * * *' }), testEnv, ctx);
    await waitOnExecutionContext(ctx);

    const turns = await db.prepare('SELECT session_id, idx FROM mic_turns ORDER BY session_id, idx').all();
    expect(turns.results).toEqual([
      { session_id: 'S-flag', idx: 0 },
      { session_id: 'S-new', idx: 0 },
    ]);
    expect(await db.prepare("SELECT excerpt FROM moderation_items WHERE id = 'M2'").first()).toEqual({ excerpt: null });
    expect(await db.prepare("SELECT excerpt FROM moderation_items WHERE id = 'M1'").first()).toEqual({
      excerpt: 'bad words',
    });
    expect(await db.prepare("SELECT 1 FROM sessions WHERE token_hash = 'expired-hash'").first()).toBeNull();
    expect((await call('/api/me/state', { token: tokenB })).status).toBe(200); // live sessions stay
    const ott = await db.prepare('SELECT token_hash FROM one_time_tokens ORDER BY token_hash').all();
    expect(ott.results).toEqual([{ token_hash: 'ott-live' }]);
    expect(await db.prepare("SELECT 1 FROM idempotency_keys WHERE key = 'ancient-key-0001'").first()).toBeNull();

    // A second run finds nothing left to do.
    const again = await runRetention(testEnv, now);
    expect(again).toMatchObject({ turns: 0, sessions: 0, tokens: 0, idempotencyKeys: 0 });
  });
});
