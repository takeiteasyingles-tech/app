/// <reference types="@cloudflare/vitest-plugin/types" />
// Feature C (spec 07): PUT /api/feedback/episodes/:n through the real worker. Upsert (created_at
// kept, absent comment kept, null/blank cleared), validation, the episode gate (published, done or
// step 10 reached), the Idempotency-Key replay of the offline outbox, and the rating in /api/me/state.
import { applyD1Migrations, createExecutionContext, type D1Migration, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { buildPath, feedbackApi, IDEMPOTENCY_HEADER } from '@tie/shared';
import { createSession, type Env } from '@tie/worker-core';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../../src/index';

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
const ORIGIN = 'http://localhost';
const T0 = 1_760_000_000_000;

let token = '';
let other = '';

const path = (n: number) => buildPath(feedbackApi.episode.path, { n });

async function put(n: number, body: unknown, opts: { token?: string | null; headers?: Record<string, string> } = {}) {
  const headers = new Headers({
    Origin: ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
    'Content-Type': 'application/json',
    ...opts.headers,
  });
  const t = opts.token === undefined ? token : opts.token;
  if (t) headers.set('Cookie', `tie_s=${t}`);
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(ORIGIN + path(n), { method: 'PUT', headers, body: JSON.stringify(body) }),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  const text = await res.text();
  // biome-ignore lint/suspicious/noExplicitAny: bodies are asserted field by field.
  return { status: res.status, body: (text ? JSON.parse(text) : null) as any, res };
}

async function row(userId: string, ep: number) {
  return testEnv.DB.prepare(
    'SELECT stars, comment, created_at, updated_at FROM lesson_feedback WHERE user_id = ? AND episode_num = ?',
  )
    .bind(userId, ep)
    .first<{ stars: number; comment: string | null; created_at: number; updated_at: number }>();
}

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  const db = testEnv.DB;
  const ep = (num: number, status: string) =>
    db
      .prepare(`INSERT INTO episodes(num, title, season_n, status, updated_at) VALUES (?, ?, 1, ?, ?)`)
      .bind(num, `Episode ${num}`, status, T0);
  const prog = (user: string, num: number, step: number, done: boolean) =>
    db
      .prepare(
        'INSERT INTO episode_progress(user_id, episode_num, furthest_step, done_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(user, num, step, done ? T0 : null, T0);
  await db.batch([
    db.prepare(
      `INSERT INTO plans(id, slug, name, ai_minutes_month, features, is_default, active, created_at, updated_at)
       VALUES ('plan-gratis', 'gratis', 'Grátis', 60, '{}', 1, 1, 0, 0)`,
    ),
    db
      .prepare(
        `INSERT INTO users(id, email, created_at) VALUES ('u-fb', 'fb@integ.test', ?1), ('u-fb2', 'fb2@integ.test', ?1)`,
      )
      .bind(T0),
    db.prepare(`INSERT INTO seasons(n, title) VALUES (1, 'Arrival')`),
    ep(1, 'published'),
    ep(2, 'published'),
    ep(3, 'published'),
    ep(4, 'draft'),
    prog('u-fb', 1, 10, true),
    // Step 10 reached, episode-done not recorded yet (the Concluído screen opens right after it).
    prog('u-fb', 2, 10, false),
    prog('u-fb', 3, 7, false),
    prog('u-fb', 4, 10, true),
  ]);
  token = (await createSession(db, { userId: 'u-fb', audience: 'app' })).token;
  other = (await createSession(db, { userId: 'u-fb2', audience: 'app' })).token;
});

describe('PUT /api/feedback/episodes/:n', () => {
  it('requires a session and the same-origin check', async () => {
    expect((await put(1, { stars: 5 }, { token: null })).status).toBe(401);
    const cross = await put(
      1,
      { stars: 5 },
      { headers: { Origin: 'https://evil.test', 'Sec-Fetch-Site': 'cross-site' } },
    );
    expect(cross.status).toBe(403);
  });

  it('creates, then updates in place keeping created_at and an absent comment', async () => {
    const first = await put(1, { stars: 4, comment: '  Gostei muito!  ' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ episode: 1, feedback: { stars: 4, comment: 'Gostei muito!' } });
    const created = await row('u-fb', 1);
    expect(created).toMatchObject({ stars: 4, comment: 'Gostei muito!' });

    await new Promise((r) => setTimeout(r, 5));
    const second = await put(1, { stars: 5 });
    expect(second.body.feedback).toEqual({ stars: 5, comment: 'Gostei muito!' });
    const updated = await row('u-fb', 1);
    expect(updated?.created_at).toBe(created?.created_at);
    expect(updated?.updated_at).toBeGreaterThan(created?.created_at ?? 0);

    // A blank comment and null both clear it; unknown keys are stripped.
    expect((await put(1, { stars: 3, comment: '   ' })).body.feedback).toEqual({ stars: 3, comment: null });
    await put(1, { stars: 3, comment: 'de novo' });
    expect((await put(1, { stars: 2, comment: null, extra: 'x' })).body.feedback).toEqual({ stars: 2, comment: null });
    const count = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM lesson_feedback WHERE user_id = ?')
      .bind('u-fb')
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('opens at step 10 even before episode-done, and stays closed before it', async () => {
    expect((await put(2, { stars: 5 })).status).toBe(200);
    const early = await put(3, { stars: 5 });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('gated');
    // Another learner without progress on episode 1.
    expect((await put(1, { stars: 5 }, { token: other })).status).toBe(409);
  });

  it('refuses unknown and unpublished episodes', async () => {
    const draft = await put(4, { stars: 5 });
    expect(draft.status).toBe(404);
    expect(draft.body.error.code).toBe('content_unavailable');
    expect((await put(99, { stars: 5 })).status).toBe(404);
    expect((await put(0, { stars: 5 })).status).toBe(400);
  });

  it('validates stars and the comment length', async () => {
    for (const stars of [0, 6, 2.5, '5', null]) {
      expect((await put(1, { stars })).status, String(stars)).toBe(400);
    }
    expect((await put(1, {})).status).toBe(400);
    expect((await put(1, { stars: 4, comment: 'a'.repeat(1001) })).status).toBe(400);
    expect((await put(1, { stars: 4, comment: 'a'.repeat(1000) })).status).toBe(200);
    expect((await put(1, { stars: 4, comment: 7 })).status).toBe(400);
  });

  it('applies an outbox replay (same Idempotency-Key) once', async () => {
    const key = 'fb-replay-0001';
    const a = await put(2, { stars: 1, comment: 'primeira' }, { headers: { [IDEMPOTENCY_HEADER]: key } });
    expect(a.status).toBe(200);
    await put(2, { stars: 4, comment: 'depois' });
    const replay = await put(2, { stars: 1, comment: 'primeira' }, { headers: { [IDEMPOTENCY_HEADER]: key } });
    expect(replay.status).toBe(200);
    expect(replay.res.headers.get('Idempotent-Replayed')).toBe('true');
    expect(replay.body).toEqual(a.body);
    // The replay did not run again: the later edit stands.
    expect(await row('u-fb', 2)).toMatchObject({ stars: 4, comment: 'depois' });
  });

  it('shows the ratings in /api/me/state', async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request(`${ORIGIN}/api/me/state`, { headers: { Cookie: `tie_s=${token}` } }),
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const s = (await res.json()) as { feedback: Record<string, { stars: number; comment: string | null }> };
    expect(s.feedback['2']).toEqual({ stars: 4, comment: 'depois' });
    expect(Object.keys(s.feedback).sort()).toEqual(['1', '2']);
  });
});
