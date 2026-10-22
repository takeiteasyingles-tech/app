/// <reference types="@cloudflare/vitest-plugin/types" />
// Feature B (spec 07): the staff side of the season test (questions CRUD, bulk review, AI draft with
// its demo fallback, publish) and of certificates (list, PDF, revoke/reinstate), each with its audit row.
import { certificateR2Key, newId } from '@tie/shared';
import type { Env } from '@tie/worker-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildAdminApp } from '../src/index';
import {
  type Account,
  auditRows,
  Client,
  exec,
  ins,
  learner,
  one,
  resetDb,
  seedContent,
  staff,
  testEnv,
} from './helpers';

const base = '/admin-api/seasons/1/test';

let editor: Account;
let admin: Account;
let moderator: Account;

beforeEach(async () => {
  await resetDb();
  await seedContent();
  // Richer material for the drafter: four words and three expressions.
  await exec(
    'UPDATE episodes SET visual = ?, away_exp = ? WHERE num = 1',
    JSON.stringify([
      { en: 'door', pt: 'porta' },
      { en: 'kitchen', pt: 'cozinha' },
      { en: 'window', pt: 'janela' },
      { en: 'table', pt: 'mesa' },
    ]),
    JSON.stringify([
      { en: 'Nice to meet you', pt: 'Prazer em conhecer' },
      { en: 'See you later', pt: 'Até mais' },
      { en: 'How are you?', pt: 'Como vai?' },
    ]),
  );
  await ins('seasons', { n: 2, title: 'Other', synopsis: null });
  await ins('episodes', { num: 30, title: 'Elsewhere', season_n: 2, status: 'published', ebook_num: 1, updated_at: 0 });
  editor = await staff(['editor']);
  admin = await staff(['admin']);
  moderator = await staff(['moderator']);
});

const choice = (q: string, extra: Record<string, unknown> = {}) => ({
  q,
  opts: ['a', 'b', 'c'],
  answerIdx: 1,
  ...extra,
});

describe('questions', () => {
  it('lists the season test with counts and why it cannot be published yet', async () => {
    const { status, body } = await editor.client.json(base);
    expect(status).toBe(200);
    expect(body.season).toMatchObject({ n: 1, title: 'Arrival', passPct: 70, questionCount: 20, published: false });
    expect(body.counts).toEqual({ draft: 0, approved: 0, rejected: 0 });
    expect(body.publishProblems).toHaveLength(1);
    expect((await editor.client.json('/admin-api/seasons/9/test')).status).toBe(404);
    // Moderators have no content.edit.
    expect((await moderator.client.json(base)).status).toBe(403);
  });

  it('creates drafts (staff source), normalizes typed answers and checks the rules', async () => {
    const since = Date.now();
    const a = await editor.client.json(`${base}/questions`, { json: choice('Q1', { epNum: 1, rev: 'Ep. 1' }) });
    expect(a.status).toBe(200);
    expect(a.body.item).toMatchObject({ q: 'Q1', status: 'draft', source: 'staff', sort: 0, answerIdx: 1, epNum: 1 });
    const b = await editor.client.json(`${base}/questions`, {
      json: { q: 'Q2', accept: ['Good  Morning!', 'good morning'] },
    });
    expect(b.body.item).toMatchObject({ sort: 1, accept: ['good morning'], opts: null, answerIdx: null });

    expect((await editor.client.json(`${base}/questions`, { json: choice('Q3', { answerIdx: 5 }) })).status).toBe(400);
    expect((await editor.client.json(`${base}/questions`, { json: { q: 'Q4' } })).status).toBe(400);
    // An episode of another season.
    expect((await editor.client.json(`${base}/questions`, { json: choice('Q5', { epNum: 30 }) })).status).toBe(400);
    // Strict body.
    expect((await editor.client.json(`${base}/questions`, { json: choice('Q6', { status: 'approved' }) })).status).toBe(
      400,
    );

    const audit = await auditRows('season_test.question.create', since);
    expect(audit.map((r) => r.target_id)).toEqual([a.body.item.id, b.body.item.id]);
    expect(audit[0]?.actor_user_id).toBe(editor.id);
  });

  it('updates keep the status, merge the patch and re-check the rules; delete refuses answered ones', async () => {
    const { body } = await editor.client.json(`${base}/questions`, { json: choice('Q1') });
    const id = body.item.id as string;
    await editor.client.json(`${base}/review`, { json: { ids: [id], status: 'approved' } });
    const since = Date.now();
    const up = await editor.client.json(`${base}/questions/${id}`, {
      method: 'PUT',
      json: { q: 'Q1 editada', partTitle: 'Parte A' },
    });
    expect(up.status).toBe(200);
    expect(up.body.item).toMatchObject({
      q: 'Q1 editada',
      partTitle: 'Parte A',
      status: 'approved',
      opts: ['a', 'b', 'c'],
    });
    // answerIdx out of the stored options.
    expect(
      (await editor.client.json(`${base}/questions/${id}`, { method: 'PUT', json: { answerIdx: 4 } })).status,
    ).toBe(400);
    // Turning it into a typed question.
    const typed = await editor.client.json(`${base}/questions/${id}`, {
      method: 'PUT',
      json: { opts: null, answerIdx: null, accept: ['Hello'] },
    });
    expect(typed.body.item).toMatchObject({ opts: null, answerIdx: null, accept: ['hello'] });
    const audit = await auditRows('season_test.question.update', since);
    expect(audit).toHaveLength(2);

    // Answered by a learner: 409 in_use.
    const l = await learner();
    await ins('season_test_answers', {
      user_id: l.id,
      question_id: id,
      choice_idx: null,
      text_value: 'hello',
      correct: 1,
      updated_at: 1,
    });
    const del = await editor.client.json(`${base}/questions/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('in_use');
    const other = await editor.client.json(`${base}/questions`, { json: choice('Q2') });
    const ok = await editor.client.json(`${base}/questions/${other.body.item.id}`, { method: 'DELETE' });
    expect(ok.status).toBe(200);
    expect(await auditRows('season_test.question.delete', since)).toHaveLength(1);
    // Wrong season → 404.
    expect(
      (await editor.client.json(`/admin-api/seasons/2/test/questions/${id}`, { method: 'PUT', json: { q: 'x' } }))
        .status,
    ).toBe(404);
  });

  it('reviews in bulk, 404s ids of another season, and publishes only with enough approved questions', async () => {
    const ids: string[] = [];
    for (const q of ['Q1', 'Q2', 'Q3'])
      ids.push((await editor.client.json(`${base}/questions`, { json: choice(q) })).body.item.id);
    await exec('UPDATE seasons SET test_question_count = 2 WHERE n = 1');

    const since = Date.now();
    const refused = await editor.client.json(`${base}/publish`, { json: { published: true } });
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.publishProblems[0]).toMatch(/Aprove pelo menos 2/);

    expect(
      (await editor.client.json(`${base}/review`, { json: { ids: [ids[0], 'nope'], status: 'approved' } })).status,
    ).toBe(404);
    const rev = await editor.client.json(`${base}/review`, { json: { ids: [ids[0], ids[1]], status: 'approved' } });
    expect(rev.body.items.map((x: { status: string }) => x.status)).toEqual(['approved', 'approved']);
    await editor.client.json(`${base}/review`, { json: { ids: [ids[2]], status: 'rejected' } });
    const view = await editor.client.json(base);
    expect(view.body.counts).toEqual({ draft: 0, approved: 2, rejected: 1 });
    expect(view.body.publishProblems).toEqual([]);
    expect((await editor.client.json(`${base}?status=rejected`)).body.questions).toHaveLength(1);

    const pub = await editor.client.json(`${base}/publish`, { json: { published: true } });
    expect(pub.status).toBe(200);
    expect(pub.body.season).toMatchObject({ published: true, publishedBy: editor.id });
    const un = await editor.client.json(`${base}/publish`, { json: { published: false } });
    expect(un.body.season.published).toBe(false);
    expect(await auditRows('season_test.question.review', since)).toHaveLength(2);
    expect(await auditRows('season_test.publish', since)).toHaveLength(2);
  });
});

// ---------- AI draft ----------

type Run = (model: string, inputs: Record<string, unknown>) => Promise<unknown>;

/** A client for the same staff account whose Worker env carries a fake AI binding. */
function withAi(
  account: Account,
  run: Run,
): { client: Client; calls: { model: string; inputs: Record<string, unknown> }[] } {
  const calls: { model: string; inputs: Record<string, unknown> }[] = [];
  const app = buildAdminApp();
  const ai = {
    run: (m: string, i: Record<string, unknown>) => {
      calls.push({ model: m, inputs: i });
      return run(m, i);
    },
  };
  const client = new Client({
    fetch: (req, env, ctx) => app.fetch(req, { ...env, AI: ai } as unknown as Env, ctx),
  });
  for (const [k, v] of account.client.cookies) client.cookies.set(k, v);
  return { client, calls };
}

const aiQuestions = {
  questions: [
    {
      part: 'Vocabulário',
      type: 'choice',
      q: 'O que significa "door"?',
      options: ['porta', 'mesa', 'janela'],
      answer: 0,
      show: 'porta',
      episode: 1,
      review: 'Ep. 1 · Take a Look',
    },
    {
      part: 'Escrita',
      type: 'typed',
      q: 'Escreva em inglês: "cozinha"',
      accept: ['Kitchen', 'the kitchen'],
      show: 'kitchen',
      episode: 1,
    },
    // Invalid: answer outside the options → dropped.
    { type: 'choice', q: 'Quebrada', options: ['a', 'b'], answer: 3 },
    // Episode of another season → kept without the reference.
    {
      part: 'Escuta',
      type: 'listening',
      q: 'Ouça e escolha.',
      options: ['See you later', 'How are you?'],
      answer: 0,
      audio: 'See you later',
      episode: 30,
    },
  ],
};

describe('POST draft', () => {
  beforeEach(async () => {
    await ins('feature_flags', {
      key: 'ai.enabled',
      enabled: 1,
      rollout_pct: 100,
      rules: null,
      updated_by: null,
      updated_at: 0,
    });
  });

  it('without the AI binding drafts with the demo generator (source demo) and audits it', async () => {
    const since = Date.now();
    const { status, body } = await editor.client.json(`${base}/draft`, { json: { count: 6 } });
    expect(status).toBe(200);
    expect(body.source).toBe('demo');
    expect(body.items).toHaveLength(6);
    for (const it of body.items) {
      expect(it).toMatchObject({ status: 'draft', source: 'ai', seasonN: 1, epNum: 1 });
      expect(it.opts !== null || (it.accept?.length ?? 0) > 0).toBe(true);
    }
    const audit = await auditRows('season_test.question.draft', since);
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]?.diff ?? '{}')).toMatchObject({ source: 'demo', count: 6 });
    // A second draft does not repeat the first one's questions.
    const again = await editor.client.json(`${base}/draft`, { json: { count: 6 } });
    const first = new Set(body.items.filter((x: { audio: string | null }) => !x.audio).map((x: { q: string }) => x.q));
    expect(again.body.items.some((x: { q: string; audio: string | null }) => !x.audio && first.has(x.q))).toBe(false);
  });

  it('with Workers AI keeps the valid questions of the model JSON (source ia), with the stored prompt', async () => {
    await ins('ai_prompts', {
      key: 'season_test_draft',
      template: 'CUSTOM {{count}} for season {{season}}',
      version: 1,
      updated_by: null,
      updated_at: 0,
    });
    const { client, calls } = withAi(editor, async () => ({ response: JSON.stringify(aiQuestions) }));
    const { status, body } = await client.json(`${base}/draft`, {
      json: { count: 5, instructions: 'Foque no vocabulário.' },
    });
    expect(status).toBe(200);
    expect(body.source).toBe('ia');
    expect(body.items.map((x: { q: string }) => x.q)).toEqual([
      'O que significa "door"?',
      'Escreva em inglês: "cozinha"',
      'Ouça e escolha.',
    ]);
    expect(body.items[1]).toMatchObject({ accept: ['kitchen', 'the kitchen'], opts: null });
    expect(body.items[2]).toMatchObject({ audio: 'See you later', epNum: null });
    expect(calls).toHaveLength(1);
    const messages = calls[0]?.inputs.messages as { role: string; content: string }[];
    expect(messages[0]?.content).toBe('CUSTOM 5 for season 1');
  });

  it('falls back to the demo drafter when both models answer invalid JSON or throw', async () => {
    const bad = withAi(editor, async () => ({ response: 'Desculpe, não posso.' }));
    const r1 = await bad.client.json(`${base}/draft`, { json: { count: 3 } });
    expect(r1.status).toBe(200);
    expect(r1.body.source).toBe('demo');
    expect(r1.body.items).toHaveLength(3);
    expect(bad.calls.map((c) => c.model)).toEqual([
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/meta/llama-3.1-8b-instruct-fp8',
    ]);

    const boom = withAi(editor, async () => {
      throw new Error('upstream 500');
    });
    const r2 = await boom.client.json(`${base}/draft`, { json: { count: 2 } });
    expect(r2.body.source).toBe('demo');
    expect(boom.calls).toHaveLength(2);
  });

  it('refuses episodes outside the season and moderators (no content.edit)', async () => {
    expect((await editor.client.json(`${base}/draft`, { json: { episodes: [30] } })).status).toBe(400);
    expect((await moderator.client.json(`${base}/draft`, { json: {} })).status).toBe(403);
  });
});

// ---------- Certificates ----------

describe('certificates', () => {
  async function issue() {
    const l = await learner({ name: 'Bia' });
    const id = newId();
    await ins('certificates', {
      id,
      code: 'TIE-ABCD-2345',
      user_id: l.id,
      season_n: 1,
      full_name_snapshot: 'Bia Souza',
      season_title_snapshot: 'Arrival',
      score_pct: 90,
      issued_at: Date.now(),
    });
    return { id, learner: l };
  }

  it('lists (users.read), searches by code, name or e-mail, and serves the PDF', async () => {
    const { id, learner: l } = await issue();
    const list = await moderator.client.json('/admin-api/certificates');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id,
      code: 'TIE-ABCD-2345',
      userEmail: l.email,
      fullName: 'Bia Souza',
      revokedAt: null,
    });
    for (const q of ['abcd', 'Bia Sou', l.email.slice(0, 8)]) {
      expect(
        (await moderator.client.json(`/admin-api/certificates?q=${encodeURIComponent(q)}`)).body.items,
        q,
      ).toHaveLength(1);
    }
    expect((await moderator.client.json('/admin-api/certificates?q=zzz')).body.items).toHaveLength(0);
    expect((await moderator.client.json('/admin-api/certificates?revoked=1')).body.items).toHaveLength(0);

    const res = await moderator.client.send(`/admin-api/certificates/${id}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect((await one<{ r2_key: string }>('SELECT r2_key FROM certificates WHERE id = ?', id))?.r2_key).toBe(
      certificateR2Key(l.id, id),
    );
    expect(await testEnv.MEDIA.head(certificateR2Key(l.id, id))).not.toBeNull();
  });

  it('revokes and reinstates (certificates.revoke: admin only), with the reason audited', async () => {
    const { id } = await issue();
    expect(
      (await editor.client.json(`/admin-api/certificates/${id}/revoke`, { json: { revoked: true, reason: 'x' } }))
        .status,
    ).toBe(403);
    expect((await admin.client.json(`/admin-api/certificates/${id}/revoke`, { json: { revoked: true } })).status).toBe(
      400,
    );
    const since = Date.now();
    const r = await admin.client.json(`/admin-api/certificates/${id}/revoke`, {
      json: { revoked: true, reason: 'Fraude no teste' },
    });
    expect(r.status).toBe(200);
    expect(r.body.item).toMatchObject({ revokedBy: admin.id, revokeReason: 'Fraude no teste' });
    expect(r.body.item.revokedAt).toBeGreaterThan(0);
    expect((await admin.client.json('/admin-api/certificates?revoked=true')).body.items).toHaveLength(1);
    const back = await admin.client.json(`/admin-api/certificates/${id}/revoke`, {
      json: { revoked: false, reason: 'Revisado' },
    });
    expect(back.body.item).toMatchObject({ revokedAt: null, revokedBy: null, revokeReason: null });
    expect(await auditRows('certificate.revoke', since)).toHaveLength(1);
    const re = await auditRows('certificate.reinstate', since);
    expect(JSON.parse(re[0]?.diff ?? '{}')).toMatchObject({ reason: 'Revisado', code: 'TIE-ABCD-2345' });
    expect(
      (await admin.client.json('/admin-api/certificates/nope/revoke', { json: { revoked: true, reason: 'x' } })).status,
    ).toBe(404);
  });
});
