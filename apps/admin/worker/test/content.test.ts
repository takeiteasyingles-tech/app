// Content CRUD: strict bodies, media/parent/reference checks, cross-field rules, in_use deletes,
// blobs and option lists, and the audit diff of every mutation.
import { adminApi, buildPath } from '@tie/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Account, auditRows, ins, learner, one, resetDb, seedContent, staff } from './helpers';

const C = adminApi.content;
const p = (path: string, id: string | number) => buildPath(path, { id });

describe('content CRUD', () => {
  let editor: Account;

  beforeEach(async () => {
    await resetDb();
    await seedContent();
    editor = await staff(['editor']);
  });

  it('lists, filters by parent and reads items in API shape', async () => {
    const eps = await editor.client.json(C.episodes.list.path);
    expect(eps.body.items.map((e: { num: number }) => e.num)).toEqual([1, 2]);
    expect(eps.body.items[0]).toMatchObject({
      num: 1,
      seasonN: 1,
      ebookNum: 1,
      introMedia: 'm-intro',
      castNames: ['Zach'],
    });
    const phrases = await editor.client.json(`${C.micPhrases.list.path}?parent=1`);
    expect(phrases.body.items).toEqual([
      { id: 'e1-mic-0', episodeNum: 1, sort: 0, en: 'Hi!', tip: 'tip', demoResult: 7, blue: false, fb: 'fb' },
    ]);
    expect((await editor.client.json(`${C.micPhrases.list.path}?parent=2`)).body.items).toEqual([]);
    const item = await editor.client.json(p(C.items.get.path, 'e1-ex0-i0'));
    expect(item.body.item).toMatchObject({ opts: ['a', 'b'], answerIdx: 1 });
    expect((await editor.client.send(p(C.items.get.path, 'nope'))).status).toBe(404);
  });

  it('creates, updates and deletes with an audit diff', async () => {
    const since = Date.now();
    const phrase = {
      id: 'e1-mic-1',
      episodeNum: 1,
      sort: 1,
      en: 'Nice to meet you.',
      tip: null,
      demoResult: 8,
      blue: true,
      fb: null,
    };
    const created = await editor.client.json(C.micPhrases.create.path, { json: phrase });
    expect(created.status).toBe(201);
    expect(created.body.item).toEqual(phrase);
    expect((await editor.client.send(C.micPhrases.create.path, { json: phrase })).status).toBe(409);

    const upd = await editor.client.json(p(C.micPhrases.update.path, 'e1-mic-1'), {
      method: 'PUT',
      json: { en: 'Nice!', blue: false },
    });
    expect(upd.body.item).toMatchObject({ en: 'Nice!', blue: false, demoResult: 8 });
    const [audit] = await auditRows('content.mic-phrases.update', since);
    expect(audit?.actor_user_id).toBe(editor.id);
    expect(audit?.actor_role).toBe('editor');
    expect(JSON.parse(audit?.diff ?? '{}')).toEqual({
      en: { from: 'Nice to meet you.', to: 'Nice!' },
      blue: { from: true, to: false },
    });

    expect((await editor.client.json(p(C.micPhrases.remove.path, 'e1-mic-1'), { method: 'DELETE' })).body).toEqual({
      ok: true,
    });
    expect(await one("SELECT 1 FROM mic_phrases WHERE id = 'e1-mic-1'")).toBeNull();
    expect(await auditRows('content.mic-phrases.delete', since)).toHaveLength(1);
  });

  it('records large edits field by field instead of truncating the audit diff', async () => {
    const since = Date.now();
    const line = (i: number, tag = '') => ({
      en: `Line ${i}${tag} — ${'la '.repeat(40)}`,
      pt: `Linha ${i}${tag} — ${'lá '.repeat(40)}`,
    });
    const long = Array.from({ length: 300 }, (_, i) => line(i));
    const path = p(C.episodes.update.path, 1);
    expect((await editor.client.json(path, { method: 'PUT', json: { lyrics: long } })).status).toBe(200);
    const edited = long.map((l, i) => (i === 5 ? line(5, ' (nova)') : l));
    expect((await editor.client.json(path, { method: 'PUT', json: { lyrics: edited, title: 'Novo' } })).status).toBe(
      200,
    );
    const rows = await auditRows('content.episodes.update', since);
    expect(rows).toHaveLength(2);
    const [first, second] = rows.map((r) => JSON.parse(r.diff ?? '{}'));
    for (const d of [first, second]) {
      expect(d.truncated).toBeUndefined();
      expect(d.lyrics.compacted).toBe(true);
      expect(d.lyrics.from.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    // 1 line → 300: too many changes for the detail, so the changed positions and both fingerprints.
    expect(first.lyrics.lengths).toEqual({ from: 1, to: 300 });
    expect(first.lyrics.changedIndexes).toHaveLength(300);
    // One line edited: exactly that line, both sides; small fields stay as they are.
    expect(Object.keys(second.lyrics.items)).toEqual(['5']);
    expect(second.lyrics.items['5'].to.en).toContain('(nova)');
    expect(second.title).toEqual({ from: 'Good Morning', to: 'Novo' });
  });

  it('stamps episodes with updatedAt / updatedBy and keeps the key immutable', async () => {
    const r = await editor.client.json(p(C.episodes.update.path, 1), {
      method: 'PUT',
      json: { title: 'Good Morning!' },
    });
    expect(r.body.item).toMatchObject({ title: 'Good Morning!', updatedBy: editor.id });
    expect(r.body.item.updatedAt).toBeGreaterThan(1_760_000_000_000);
    const pk = await editor.client.json(p(C.episodes.update.path, 1), { method: 'PUT', json: { num: 5 } });
    expect(pk.status).toBe(400);
    expect(pk.body.error.details.issues[0].code).toBe('immutable');
  });

  it('rejects unknown keys, server-only keys and malformed nested content', async () => {
    const up = (json: unknown) => editor.client.json(p(C.episodes.update.path, 1), { method: 'PUT', json });
    expect((await up({ title: 'x', extra: 1 })).status).toBe(400);
    expect((await up({ updatedAt: 1 })).status).toBe(400);
    expect((await up({ lyrics: [{ en: 'x' }] })).status).toBe(400);
    expect((await up({ status: 'live' })).status).toBe(400);
  });

  it('checks media existence and kind, parents and references', async () => {
    const up = (json: unknown) => editor.client.json(p(C.episodes.update.path, 1), { method: 'PUT', json });
    const missing = await up({ introMedia: 'm-nope' });
    expect(missing.body.error.details.issues[0]).toMatchObject({ path: 'introMedia', code: 'unknown_media' });
    const kind = await up({ introMedia: 'm-video' });
    expect(kind.body.error.details.issues[0]).toMatchObject({ path: 'introMedia', code: 'media_kind' });
    expect((await up({ ebookNum: 9 })).body.error.details.issues[0]).toMatchObject({
      path: 'ebookNum',
      code: 'unknown_ref',
    });

    const orphan = {
      id: 'e9-mic-0',
      episodeNum: 9,
      sort: 0,
      en: 'x',
      tip: null,
      demoResult: null,
      blue: false,
      fb: null,
    };
    const r = await editor.client.json(C.micPhrases.create.path, { json: orphan });
    expect(r.body.error.details.issues[0]).toMatchObject({ path: 'episodeNum', code: 'unknown_ref' });
    const badId = await editor.client.json(C.micPhrases.create.path, {
      json: { ...orphan, episodeNum: 1, id: 'com espaço' },
    });
    expect(badId.body.error.details.issues[0].code).toBe('invalid_id');
  });

  it('applies cross-field rules (answer index, test questions, published episodes)', async () => {
    const bad = await editor.client.json(p(C.items.update.path, 'e1-ex0-i0'), {
      method: 'PUT',
      json: { answerIdx: 3 },
    });
    expect(bad.body.error.details.issues[0].code).toBe('out_of_range');
    const tq = {
      id: 'eb1-t2',
      ebookNum: 1,
      partIdx: 0,
      partTitle: 'A',
      n: 2,
      q: 'Hello, my ___ is Ana.',
      rev: null,
      epNum: 1,
      step: 7,
      opts: null,
      answerIdx: null,
      accept: ['Name!', 'name', '  NAME '],
      show: 'name',
      audio: null,
    };
    const created = await editor.client.json(C.testQuestions.create.path, { json: tq });
    expect(created.status).toBe(201);
    expect(created.body.item.accept).toEqual(['name']);
    const neither = await editor.client.json(C.testQuestions.create.path, {
      json: { ...tq, id: 'eb1-t3', n: 3, accept: null },
    });
    expect(neither.status).toBe(400);
    const dupN = await editor.client.json(C.testQuestions.create.path, { json: { ...tq, id: 'eb1-t4' } });
    expect(dupN.status).toBe(409);
    const noDone = await editor.client.json(p(C.episodes.update.path, 2), {
      method: 'PUT',
      json: { status: 'published' },
    });
    expect(noDone.body.error.details.issues[0]).toMatchObject({ path: 'done', code: 'required' });
  });

  it('refuses deletes that would lose learner data or orphan content (409 in_use)', async () => {
    const l = await learner();
    await ins('mic_scores', {
      user_id: l.id,
      phrase_id: 'e1-mic-0',
      last_score: 7,
      best_score: 7,
      source: 'demo',
      updated_at: 1,
    });
    const r = await editor.client.json(p(C.micPhrases.remove.path, 'e1-mic-0'), { method: 'DELETE' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('in_use');
    expect(r.body.error.details.uses).toEqual([{ label: 'notas de alunos', count: 1 }]);
    // Episode 1 still has an album track and e-book 1 still has episodes.
    expect((await editor.client.json(p(C.episodes.remove.path, 1), { method: 'DELETE' })).status).toBe(409);
    expect((await editor.client.json(p(C.ebooks.remove.path, 1), { method: 'DELETE' })).status).toBe(409);
    // Episode 2 is free: it goes, with its (absent) children.
    expect((await editor.client.json(p(C.episodes.remove.path, 2), { method: 'DELETE' })).status).toBe(200);
  });

  it('replaces assistant clips only when sent', async () => {
    const path = p(C.assistants.update.path, 'margaret');
    expect((await editor.client.json(path, { method: 'PUT', json: { name: 'Maggie W.' } })).body.item.clips).toEqual({
      idle: 'm-clip',
    });
    const r = await editor.client.json(path, { method: 'PUT', json: { clips: { talk: 'm-clip' } } });
    expect(r.body.item.clips).toEqual({ talk: 'm-clip' });
    const img = await editor.client.json(path, { method: 'PUT', json: { clips: { talk: 'm-img' } } });
    expect(img.body.error.details.issues[0]).toMatchObject({ path: 'clips.talk', code: 'media_kind' });
    const voice = await editor.client.json(path, { method: 'PUT', json: { ttsSpeaker: 'robot' } });
    expect(voice.body.error.details.issues[0].path).toBe('ttsSpeaker');
    // The persona column is never touched by content edits.
    expect((await one<{ persona: string }>("SELECT persona FROM assistants WHERE key = 'margaret'"))?.persona).toBe(
      'SECRET-PERSONA warm and elegant',
    );
  });
});

describe('blobs and option lists', () => {
  let editor: Account;

  beforeEach(async () => {
    await resetDb();
    await seedContent();
    editor = await staff(['editor']);
  });

  it('validates each blob against its schema and media references', async () => {
    const put = (key: string, json: unknown) =>
      editor.client.json(buildPath(C.blobs.put.path, { key }), { method: 'PUT', json: { json } });
    expect((await put('srs_grades', [{ label: 'a', hint: 'b', ms: 0 }])).status).toBe(400);
    expect((await put('mic_openers', { series: { en: 'Hi', pt: 'Oi' } })).status).toBe(400);
    expect((await put('focus', { x: { t: 't', b: 'b', cta: 'c', go: 'g', more: 1 } })).status).toBe(400);
    const media = await put('scene_images', { default: 'm-video', episodes: {} });
    expect(media.body.error.details.issues[0]).toMatchObject({ path: 'json.default', code: 'media_kind' });
    const ok = await put('onboarding_meta', { remindMax: 3 });
    expect(ok.body.item).toMatchObject({ key: 'onboarding_meta', json: { remindMax: 3 }, updatedBy: editor.id });
    expect((await editor.client.send(buildPath(C.blobs.get.path, { key: 'nope' }))).status).toBe(400);
    expect((await editor.client.json(C.blobs.list.path)).body.items).toHaveLength(13);
  });

  it('replaces one option list with per-list rules', async () => {
    const put = (listKey: string, items: unknown[]) =>
      editor.client.json(buildPath(C.optionLists.put.path, { listKey }), { method: 'PUT', json: { items } });
    const ok = await put('goals', [
      { itemKey: 'trabalho', sort: 0, label: 'Trabalho' },
      { itemKey: 'viagem', sort: 1, label: 'Viajar', icon: 'plane' },
    ]);
    expect(ok.status).toBe(200);
    expect(ok.body.items.map((i: { itemKey: string }) => i.itemKey)).toEqual(['trabalho', 'viagem']);
    expect((await put('days', [{ itemKey: '0', sort: 0, label: 'D' }])).status).toBe(400);
    expect((await put('levels', [{ itemKey: 'zero', sort: 0, label: 'Zero', extra: { season: 0 } }])).status).toBe(400);
    expect((await put('genres', [{ itemKey: 'rock', sort: 0, label: 'Rock' }])).status).toBe(400);
    expect((await put('nope', [])).status).toBe(400);
    // Inherited object keys are not list names (400, not a 500 from Object.prototype as a schema).
    for (const key of ['constructor', '__proto__']) {
      expect((await put(key, [{ itemKey: 'a', sort: 0, label: 'A' }])).status).toBe(400);
      expect((await put(key, [])).status).toBe(400);
    }
    const dup = await put('goals', [
      { itemKey: 'a', sort: 0, label: 'A' },
      { itemKey: 'a', sort: 1, label: 'B' },
    ]);
    expect(dup.body.error.details.issues[0].code).toBe('duplicate');
  });
});
