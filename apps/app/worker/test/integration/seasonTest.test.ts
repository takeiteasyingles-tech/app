/// <reference types="@cloudflare/vitest-plugin/types" />
// Feature B (spec 07): the season test and certificates through the assembled worker, in workerd with
// the real migrations, D1 and R2. Unlock rule, server grading, one season_pass award, one certificate
// (and its PDF, cached in R2), the public verification lookup and a revoked certificate.
import { applyD1Migrations, createExecutionContext, type D1Migration, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { CERT_CODE_RE, certificateR2Key } from '@tie/shared';
import { createSession, type Env } from '@tie/worker-core';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../../src/index';

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
const ORIGIN = 'http://localhost';
const db = () => testEnv.DB;

let learner = '';
let other = '';

async function call(
  path: string,
  opts: { token?: string; method?: string; body?: unknown; ip?: string } = {},
): Promise<Response> {
  const method = opts.method ?? 'GET';
  const headers = new Headers();
  if (opts.token) headers.set('Cookie', `tie_s=${opts.token}`);
  if (opts.ip) headers.set('CF-Connecting-IP', opts.ip);
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
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const exec = (sql: string, ...binds: unknown[]) =>
  db()
    .prepare(sql)
    .bind(...binds)
    .run();

interface View {
  published: boolean;
  unlocked: boolean;
  episodes: { published: number[]; missing: number[] };
  passPct: number;
  questions: Record<string, unknown>[];
  answers: Record<string, unknown>;
  result: { scorePct: number; passed: boolean; attempts: number; submittedAt: number } | null;
  certificate: { id: string; code: string } | null;
}

interface Result {
  score: number;
  total: number;
  scorePct: number;
  passed: boolean;
  attempts: number;
  results: { questionId: string; correct: boolean; show: string; rev: string | null }[];
  award: { awarded: boolean; points: number } | null;
  certificate: { id: string; code: string; fullName: string; seasonTitle: string; verifyUrl: string } | null;
}

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  const now = Date.now();
  const d = db();
  await d.batch([
    d
      .prepare(
        `INSERT INTO users(id, email, created_at) VALUES ('st-a', 'a@season.test', ?1), ('st-b', 'b@season.test', ?1)`,
      )
      .bind(now),
    d
      .prepare(
        `INSERT INTO profiles(user_id, full_name, name, updated_at) VALUES ('st-a', 'Ana Clara Souza', 'Ana', ?1),
           ('st-b', 'Bruno Lima', 'Bruno', ?1)`,
      )
      .bind(now),
    d.prepare(
      `INSERT INTO seasons(n, title, synopsis) VALUES (1, 'Arrival', 'A família chega a Beacon.'), (2, 'Two', NULL)`,
    ),
    d
      .prepare(
        `INSERT INTO episodes(num, title, season_n, status, updated_at) VALUES
           (1, 'One', 1, 'published', ?1), (2, 'Two', 1, 'published', ?1), (3, 'Three', 1, 'draft', ?1)`,
      )
      .bind(now),
    d
      .prepare(
        `INSERT INTO season_test_questions(id, season_n, sort, part_title, q, opts, answer_idx, accept, show, audio, rev, ep_num, status, source, created_at, updated_at)
         VALUES ('q1', 1, 0, 'Vocabulário', 'O que significa "kitchen"?', '["sala","cozinha","quarto"]', 1, NULL, NULL, NULL, 'Ep. 1 · Take a Look', 1, 'approved', 'ai', ?1, ?1),
                ('q2', 1, 1, 'Escrita', 'Escreva em inglês: "bom dia"', NULL, NULL, '["good morning"]', 'Good morning', NULL, 'Ep. 2 · Take Away', 2, 'approved', 'staff', ?1, ?1),
                ('q3', 1, 2, 'Escuta', 'Ouça e escolha.', '["Hi","Bye"]', 0, NULL, NULL, 'Hi there', NULL, 2, 'approved', 'ai', ?1, ?1),
                ('q4', 1, 3, 'Rascunho', 'Rascunho que não aparece', '["a","b"]', 0, NULL, NULL, NULL, NULL, NULL, 'draft', 'ai', ?1, ?1),
                ('q5', 1, 4, 'Rejeitada', 'Rejeitada que não aparece', '["a","b"]', 0, NULL, NULL, NULL, NULL, NULL, 'rejected', 'ai', ?1, ?1)`,
      )
      .bind(now),
  ]);
  learner = (await createSession(d, { userId: 'st-a', audience: 'app' })).token;
  other = (await createSession(d, { userId: 'st-b', audience: 'app' })).token;
});

describe('GET /api/seasons/:n/test', () => {
  it('requires a session and 404s an unknown season', async () => {
    expect((await call('/api/seasons/1/test')).status).toBe(401);
    expect((await call('/api/seasons/9/test', { token: learner })).status).toBe(404);
  });

  it('shows no questions while the test is unpublished, and refuses writes (404 content_unavailable)', async () => {
    const v = await json<View>(await call('/api/seasons/1/test', { token: learner }));
    expect(v.published).toBe(false);
    expect(v.questions).toEqual([]);
    const res = await call('/api/seasons/1/test/submit', { token: learner, method: 'POST', body: {} });
    expect(res.status).toBe(404);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe('content_unavailable');
  });

  it('stays locked until every PUBLISHED episode of the season is done (409 gated)', async () => {
    await exec('UPDATE seasons SET test_published = 1 WHERE n = 1');
    await exec(
      `INSERT INTO episode_progress(user_id, episode_num, furthest_step, done_at, updated_at) VALUES ('st-a', 1, 10, ?1, ?1)`,
      Date.now(),
    );
    const v = await json<View>(await call('/api/seasons/1/test', { token: learner }));
    expect(v.published).toBe(true);
    expect(v.unlocked).toBe(false);
    // Episode 3 is a draft: it does not count.
    expect(v.episodes).toEqual({ published: [1, 2], missing: [2] });
    expect(v.questions).toEqual([]);
    const res = await call('/api/seasons/1/test/submit', { token: learner, method: 'POST', body: {} });
    expect(res.status).toBe(409);
    const err = await json<{ error: { code: string; details: { episodes: number[] } } }>(res);
    expect(err.error.code).toBe('gated');
    expect(err.error.details.episodes).toEqual([2]);
  });

  it('opens with the approved questions only, without the answer key', async () => {
    await exec(
      `INSERT INTO episode_progress(user_id, episode_num, furthest_step, done_at, updated_at) VALUES ('st-a', 2, 10, ?1, ?1)`,
      Date.now(),
    );
    const v = await json<View>(await call('/api/seasons/1/test', { token: learner }));
    expect(v.unlocked).toBe(true);
    expect(v.passPct).toBe(70);
    expect(v.questions.map((x) => x.id)).toEqual(['q1', 'q2', 'q3']);
    expect(v.questions.map((x) => x.kind)).toEqual(['choice', 'typed', 'choice']);
    for (const x of v.questions) {
      for (const secret of ['answerIdx', 'answer_idx', 'accept', 'show', 'rev']) expect(x).not.toHaveProperty(secret);
    }
    expect(v.questions[2]?.audio).toBe('Hi there');
  });
});

describe('answers and grading', () => {
  it('saves answers, validates them, and grades a failing attempt without revealing the key', async () => {
    const bad = await call('/api/seasons/1/test/answers', {
      token: learner,
      method: 'PUT',
      body: { answers: { q1: 7 } },
    });
    expect(bad.status).toBe(400);
    const unknown = await call('/api/seasons/1/test/answers', {
      token: learner,
      method: 'PUT',
      body: { answers: { q4: 0 } },
    });
    expect(unknown.status).toBe(400);
    const ok = await call('/api/seasons/1/test/answers', {
      token: learner,
      method: 'PUT',
      body: { answers: { q1: 0 } },
    });
    expect(ok.status).toBe(200);
    const v = await json<View>(await call('/api/seasons/1/test', { token: learner }));
    expect(v.answers).toEqual({ q1: 0 });

    const r = await json<Result>(
      await call('/api/seasons/1/test/submit', {
        token: learner,
        method: 'POST',
        body: { answers: { q2: 'good night' } },
      }),
    );
    expect(r).toMatchObject({
      score: 0,
      total: 3,
      scorePct: 0,
      passed: false,
      attempts: 1,
      award: null,
      certificate: null,
    });
    expect(r.results.every((x) => x.show === '')).toBe(true);
    expect(r.results[0]?.rev).toBe('Ep. 1 · Take a Look');
  });

  it('passes with norm()-matched typed answers: awards season_pass once and issues the certificate once', async () => {
    const reset = await call('/api/seasons/1/test/answers', {
      token: learner,
      method: 'PUT',
      body: { answers: {}, reset: true },
    });
    expect(reset.status).toBe(200);
    const after = await json<View>(await call('/api/seasons/1/test', { token: learner }));
    expect(after.answers).toEqual({});
    expect(after.result?.submittedAt).toBe(0);

    const r = await json<Result>(
      await call('/api/seasons/1/test/submit', {
        token: learner,
        method: 'POST',
        body: { answers: { q1: 1, q2: '  Good   Morning! ', q3: 0 } },
      }),
    );
    expect(r).toMatchObject({ score: 3, total: 3, scorePct: 100, passed: true, attempts: 2 });
    expect(r.award).toMatchObject({ awarded: true, points: 100 });
    expect(r.results.map((x) => x.show)).toEqual(['cozinha', 'Good morning', 'Hi']);
    expect(r.certificate?.code).toMatch(CERT_CODE_RE);
    expect(r.certificate).toMatchObject({ fullName: 'Ana Clara Souza', seasonTitle: 'Arrival' });
    expect(r.certificate?.verifyUrl).toBe(`${ORIGIN}/#/certificado/${r.certificate?.code}`);

    // A later pass (with a different score) never pays twice nor reissues.
    const again = await json<Result>(
      await call('/api/seasons/1/test/submit', { token: learner, method: 'POST', body: { answers: { q3: 1 } } }),
    );
    expect(again).toMatchObject({ score: 2, scorePct: 67, passed: false, attempts: 3 });
    expect(again.certificate?.id).toBe(r.certificate?.id);
    const third = await json<Result>(
      await call('/api/seasons/1/test/submit', { token: learner, method: 'POST', body: { answers: { q3: 0 } } }),
    );
    expect(third.passed).toBe(true);
    expect(third.award?.awarded).toBe(false);
    expect(third.certificate?.id).toBe(r.certificate?.id);

    const certs = await db()
      .prepare(`SELECT score_pct FROM certificates WHERE user_id = 'st-a'`)
      .all<{ score_pct: number }>();
    expect(certs.results).toEqual([{ score_pct: 100 }]);
    const ledger = await db()
      .prepare(`SELECT award_key, points FROM point_ledger WHERE user_id = 'st-a' AND kind = 'season_pass'`)
      .all<{ award_key: string; points: number }>();
    expect(ledger.results).toEqual([{ award_key: 'season_pass:1', points: 100 }]);
    const res = await db()
      .prepare(`SELECT best_pct, attempts, passed_at FROM season_test_results WHERE user_id = 'st-a' AND season_n = 1`)
      .first<{ best_pct: number; attempts: number; passed_at: number | null }>();
    expect(res?.best_pct).toBe(100);
    expect(res?.attempts).toBe(4);
    expect(res?.passed_at).not.toBeNull();
  });
});

describe('certificates', () => {
  const mine = async () =>
    (
      await json<{ items: { id: string; code: string; verifyUrl: string; revoked: boolean }[] }>(
        await call('/api/certificates', { token: learner }),
      )
    ).items;

  it('lists mine and serves the PDF (rendered once, then cached in R2)', async () => {
    const [cert] = await mine();
    expect(cert).toBeDefined();
    if (!cert) return;
    expect(cert.revoked).toBe(false);
    const res = await call(`/api/certificates/${cert.id}/pdf`, { token: learner });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(2000);

    const row = await db()
      .prepare('SELECT r2_key FROM certificates WHERE id = ?')
      .bind(cert.id)
      .first<{ r2_key: string }>();
    expect(row?.r2_key).toBe(certificateR2Key('st-a', cert.id));
    const stored = await testEnv.MEDIA.get(certificateR2Key('st-a', cert.id));
    expect(stored).not.toBeNull();
    const again = new Uint8Array(
      await (await call(`/api/certificates/${cert.id}/pdf`, { token: learner })).arrayBuffer(),
    );
    expect(again).toEqual(bytes);

    // Someone else's certificate reads as unknown.
    expect((await call(`/api/certificates/${cert.id}/pdf`, { token: other })).status).toBe(404);
    expect((await call(`/api/certificates/${cert.id}/pdf`)).status).toBe(401);
  });

  it('verifies a code publicly (signed out, any case) and 404s unknown codes', async () => {
    const [cert] = await mine();
    if (!cert) throw new Error('no certificate');
    const res = await call(`/api/certificates/verify/${cert.code.toLowerCase()}`, { ip: '203.0.113.7' });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      valid: true,
      code: cert.code,
      name: 'Ana Clara Souza',
      seasonN: 1,
      seasonTitle: 'Arrival',
      revokedAt: null,
    });
    expect((await call('/api/certificates/verify/TIE-2222-2222', { ip: '203.0.113.7' })).status).toBe(404);
    expect((await call('/api/certificates/verify/nope', { ip: '203.0.113.7' })).status).toBe(400);
  });

  it('a revoked certificate verifies as invalid and its PDF is refused (403)', async () => {
    const [cert] = await mine();
    if (!cert) throw new Error('no certificate');
    await exec(
      `UPDATE certificates SET revoked_at = ?, revoked_by = 'staff', revoke_reason = 'teste' WHERE id = ?`,
      Date.now(),
      cert.id,
    );
    const v = await json<{ valid: boolean; revokedAt: number | null }>(
      await call(`/api/certificates/verify/${cert.code}`),
    );
    expect(v.valid).toBe(false);
    expect(v.revokedAt).not.toBeNull();
    expect((await call(`/api/certificates/${cert.id}/pdf`, { token: learner })).status).toBe(403);
    expect((await mine())[0]?.revoked).toBe(true);
  });

  it('/api/me/state carries the season result and the certificate', async () => {
    const s = await json<{ seasonTests: Record<string, { passed: boolean }>; certificates: { code: string }[] }>(
      await call('/api/me/state', { token: learner }),
    );
    expect(s.seasonTests['1']?.passed).toBe(true);
    expect(s.certificates).toHaveLength(1);
  });
});
