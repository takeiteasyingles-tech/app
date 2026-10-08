import { ApiError } from '@tie/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { download, saveAnswers, submitTest } from '../ebook';
import { isCorrect, toGradable } from '../grade';
import { OTHER, publish, USER, type World, world } from './helpers/fixtures';

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ApiError) return err.code;
    throw err;
  }
  return 'ok';
}

/** All six right, typed ones written the way a student would (case, punctuation, contractions). */
const ALL_RIGHT = {
  'eb1-t1': 0,
  'eb1-t2': 2,
  'eb1-t9': 'Name',
  'eb1-t13': 'She’s',
  'eb1-t14': 'Good morning! I am Ana.',
  'eb1-t16': 'This is my dad. His name is Paulo',
};

describe('download', () => {
  let w: World;
  beforeEach(() => {
    w = world();
  });

  it('records the download once and returns the PDF url when the e-book has one', async () => {
    expect(await download(w.deps(), 1)).toEqual({ ebook: 1, pdf: '/m/media/bb/ebook1.pdf' });
    expect(await download(w.deps(USER, Date.now()), 1)).toEqual({ ebook: 1, pdf: '/m/media/bb/ebook1.pdf' });
    w.db.exec("UPDATE episodes SET status = 'published' WHERE num = 3");
    expect(await download(w.deps(), 2)).toEqual({ ebook: 2, pdf: null });
    expect(
      w.db.rows('SELECT ebook_num, downloaded_at FROM user_ebooks WHERE user_id = ? ORDER BY ebook_num', USER),
    ).toEqual([
      { ebook_num: 1, downloaded_at: expect.any(Number) },
      { ebook_num: 2, downloaded_at: expect.any(Number) },
    ]);
    expect(w.db.rows('SELECT * FROM user_ebooks WHERE user_id = ?', OTHER)).toEqual([]);
  });

  it('404s an unknown e-book without writing', async () => {
    expect(await code(download(w.deps(), 99))).toBe('not_found');
    expect(w.db.rows('SELECT * FROM user_ebooks')).toEqual([]);
  });

  it('refuses an e-book no published episode belongs to, without writing or revealing the PDF', async () => {
    w.db.exec("UPDATE ebooks SET pdf_media = 'm_pdf' WHERE num = 2");
    expect(await code(download(w.deps(), 2))).toBe('content_unavailable');
    expect(w.db.rows('SELECT * FROM user_ebooks')).toEqual([]);
  });

  it('in snapshot mode, availability and the PDF come from the published content', async () => {
    w.content = publish(w);
    w.db.exec("UPDATE episodes SET status = 'published' WHERE num = 3"); // not published yet
    expect(await code(download(w.deps(), 2))).toBe('content_unavailable');
    w.db.exec('UPDATE ebooks SET pdf_media = NULL WHERE num = 1'); // unpublished edit
    expect(await download(w.deps(), 1)).toEqual({ ebook: 1, pdf: '/m/media/bb/ebook1.pdf' });
  });

  it('in snapshot mode, an open e-book compile.ts did not ship never falls back to the live PDF', async () => {
    // Ep 3 (e-book 2) is published, but e-book 2 has no test, so no snapshot file exists for it.
    w.db.exec("UPDATE episodes SET status = 'published' WHERE num = 3");
    w.content = publish(w);
    expect(await w.content.ebook(2)).toBeNull();
    // An editor attaches a PDF to e-book 2 without publishing.
    w.db.exec("UPDATE ebooks SET pdf_media = 'm_pdf' WHERE num = 2");
    expect(await download(w.deps(), 2)).toEqual({ ebook: 2, pdf: null });
    expect(w.db.rows('SELECT ebook_num FROM user_ebooks WHERE user_id = ?', USER)).toEqual([{ ebook_num: 2 }]);
  });
});

describe('typed answer grading (TEST acc lists, shared norm())', () => {
  const typed = (acc: string[]) =>
    toGradable({ id: 'q', n: 1, opts: null, answer_idx: null, accept: JSON.stringify(acc), show: null });

  it.each([
    [["good morning i'm ana"], 'Good morning. I’m Ana.', true],
    [["good morning i'm ana"], 'good morning, i am ana!', true],
    [["good morning i'm ana"], '  GOOD   MORNING   I`M ANA  ', true],
    [["she's"], 'She is', true],
    [["who's this she's our neighbor", "who's this it's our neighbor"], 'Who is this? — It is our neighbor.', true],
    [
      ['this is my father his name is paulo', 'this is my dad his name is paulo'],
      'This is my dad, his name is Paulo',
      true,
    ],
    [['name'], 'names', false],
    [['name'], '', false],
    [['nice'], 'nice to', false],
  ])('acc %j vs %j → %s', (acc, given, ok) => {
    expect(isCorrect(typed(acc), given)).toBe(ok);
  });

  it('multiple choice compares the option index; show falls back to the right option', () => {
    const q = toGradable({ id: 'q', n: 1, opts: '["a","b"]', answer_idx: 1, accept: null, show: null });
    expect(isCorrect(q, 1)).toBe(true);
    expect(isCorrect(q, 0)).toBe(false);
    expect(isCorrect(q, '1')).toBe(false);
    expect(q.show).toBe('b');
    expect(typed(["she's"]).show).toBe("she's");
  });
});

/** Every episode of e-book `n` done for the user: what opens its test on the trilha. */
function finishEbook(w: World, user: string, n = 1): void {
  w.db.exec(
    `INSERT INTO episode_progress(user_id, episode_num, furthest_step, done_at, updated_at)
     SELECT ?, num, 10, 1, 1 FROM episodes WHERE ebook_num = ?
     ON CONFLICT(user_id, episode_num) DO UPDATE SET done_at = 1`,
    user,
    n,
  );
}

describe('e-book test unlock (trilha)', () => {
  let w: World;
  beforeEach(() => {
    w = world();
  });

  it('refuses answers and submits until every published episode of the e-book is done', async () => {
    expect(await code(saveAnswers(w.deps(), 1, { answers: { 'eb1-t1': 0 } }))).toBe('gated');
    expect(await code(submitTest(w.deps(), 1, { answers: ALL_RIGHT }))).toBe('gated');
    w.db.exec(
      'INSERT INTO episode_progress(user_id, episode_num, furthest_step, done_at, updated_at) VALUES(?, 1, 10, 1, 1)',
      USER,
    );
    // Episode 2 (also e-book 1) is still open.
    expect(await code(submitTest(w.deps(), 1, { answers: ALL_RIGHT }))).toBe('gated');
    expect(w.award.calls).toEqual([]);
    expect(w.db.rows('SELECT * FROM ebook_test_answers')).toEqual([]);
    finishEbook(w, USER);
    expect((await submitTest(w.deps(), 1, { answers: ALL_RIGHT })).passed).toBe(true);
  });

  it('shows the expected answers on the first submit only', async () => {
    finishEbook(w, USER);
    const first = await submitTest(w.deps(), 1, { answers: { 'eb1-t1': 1 } });
    expect(first.results.every((r) => r.show !== '')).toBe(true);
    const second = await submitTest(w.deps(), 1, { answers: { 'eb1-t1': 0 } });
    expect(second.results.map((r) => r.show)).toEqual(second.results.map(() => ''));
    // A redo keeps the result row, so it does not reopen the key either.
    await saveAnswers(w.deps(), 1, { answers: {}, reset: true });
    const third = await submitTest(w.deps(), 1, {});
    expect(third.results.every((r) => r.show === '')).toBe(true);
  });
});

describe('e-book test', () => {
  let w: World;
  beforeEach(() => {
    w = world();
    finishEbook(w, USER);
    finishEbook(w, OTHER);
  });

  const saved = () =>
    w.db.rows<{ question_id: string; choice_idx: number | null; text_value: string | null; correct: number }>(
      'SELECT question_id, choice_idx, text_value, correct FROM ebook_test_answers WHERE user_id = ? ORDER BY question_id',
      USER,
    );

  it('saves answers (typed text kept as written, graded with norm()) and clears with null', async () => {
    expect(await saveAnswers(w.deps(), 1, { answers: { 'eb1-t1': 1, 'eb1-t14': 'Good morning, I am Ana' } })).toEqual({
      ok: true,
    });
    expect(saved()).toEqual([
      { question_id: 'eb1-t1', choice_idx: 1, text_value: null, correct: 0 },
      { question_id: 'eb1-t14', choice_idx: null, text_value: 'Good morning, I am Ana', correct: 1 },
    ]);
    await saveAnswers(w.deps(), 1, { answers: { 'eb1-t1': 0, 'eb1-t14': null, 'eb1-t9': '   ' } });
    expect(saved()).toEqual([{ question_id: 'eb1-t1', choice_idx: 0, text_value: null, correct: 1 }]);
  });

  it('validates answers against the question list', async () => {
    expect(await code(saveAnswers(w.deps(), 1, { answers: { 'eb2-t1': 0 } }))).toBe('validation_failed');
    expect(await code(saveAnswers(w.deps(), 1, { answers: { 'eb1-t1': 'Hi' } }))).toBe('validation_failed');
    expect(await code(saveAnswers(w.deps(), 1, { answers: { 'eb1-t1': 3 } }))).toBe('validation_failed');
    expect(await code(saveAnswers(w.deps(), 1, { answers: { 'eb1-t9': 0 } }))).toBe('validation_failed');
    expect(await code(saveAnswers(w.deps(), 99, { answers: {} }))).toBe('not_found');
    // E-book 2 exists but has no test yet.
    expect(await code(saveAnswers(w.deps(), 2, { answers: {} }))).toBe('content_unavailable');
    expect(saved()).toEqual([]);
  });

  it('submit grades server-side, merges over saved answers, passes at pass_score and awards test_pass once', async () => {
    await saveAnswers(w.deps(), 1, { answers: { 'eb1-t1': 0, 'eb1-t2': 0 } });
    const fail = await submitTest(w.deps(), 1, { answers: { 'eb1-t9': 'name' } });
    expect(fail).toMatchObject({ ebook: 1, score: 2, total: 6, passScore: 4, passed: false, award: null });
    expect(fail.results.find((r) => r.questionId === 'eb1-t2')).toEqual({
      questionId: 'eb1-t2',
      n: 2,
      correct: false,
      given: 0,
      show: 'Thanks',
    });
    expect(fail.results.find((r) => r.questionId === 'eb1-t14')).toMatchObject({ given: null, correct: false });

    const pass = await submitTest(w.deps(), 1, { answers: ALL_RIGHT });
    expect(pass).toMatchObject({ score: 6, passed: true, award: { kind: 'test_pass', awarded: true } });
    expect(pass.results.map((r) => r.n)).toEqual([1, 2, 9, 13, 14, 16]);
    // Second submit: graded, but the key is no longer sent (the client falls back to its file).
    expect(pass.results.find((r) => r.n === 14)).toMatchObject({ given: 'Good morning! I am Ana.', show: '' });

    const again = await submitTest(w.deps(), 1, {});
    expect(again).toMatchObject({ score: 6, passed: true });
    expect(again.award?.awarded).toBe(false);
    expect(w.award.awardedKeys()).toEqual(['test_pass:1']);
    expect(w.db.rows('SELECT ebook_num, score, passed FROM ebook_test_results WHERE user_id = ?', USER)).toEqual([
      { ebook_num: 1, score: 6, passed: 1 },
    ]);
  });

  it('exactly pass_score passes; one less does not', async () => {
    const three = { 'eb1-t1': 0, 'eb1-t2': 2, 'eb1-t9': 'name' };
    expect((await submitTest(w.deps(), 1, { answers: three })).passed).toBe(false);
    expect((await submitTest(w.deps(), 1, { answers: { 'eb1-t13': 'she is' } })).passed).toBe(true);
  });

  it('reset (testRedo) clears the answers and reopens the test, keeping the last score', async () => {
    await submitTest(w.deps(), 1, { answers: ALL_RIGHT });
    await saveAnswers(w.deps(), 1, { answers: { 'eb1-t1': 1 }, reset: true });
    expect(saved()).toEqual([{ question_id: 'eb1-t1', choice_idx: 1, text_value: null, correct: 0 }]);
    expect(w.db.rows('SELECT ebook_num, passed, submitted_at FROM ebook_test_results WHERE user_id = ?', USER)).toEqual(
      [{ ebook_num: 1, passed: 1, submitted_at: 0 }],
    );
    // Passing again later does not award twice.
    expect((await submitTest(w.deps(), 1, { answers: ALL_RIGHT })).award?.awarded).toBe(false);
  });

  it('test endpoints refuse e-books no published episode belongs to', async () => {
    w.db.exec(
      `INSERT INTO ebook_test_questions(id, ebook_num, part_idx, part_title, n, q, accept)
       VALUES('eb2-t1', 2, 0, 'P', 1, 'q', '["yes"]')`,
    );
    expect(await code(saveAnswers(w.deps(), 2, { answers: { 'eb2-t1': 'yes' } }))).toBe('content_unavailable');
    expect(await code(submitTest(w.deps(), 2, { answers: { 'eb2-t1': 'yes' } }))).toBe('content_unavailable');
    expect(saved()).toEqual([]);
    expect(w.award.calls).toEqual([]);
  });

  it('in snapshot mode, grades with the published questions, keys and pass score', async () => {
    w.content = publish(w);
    // Unpublished edits: a new key, a stricter pass score and an extra question.
    w.db.exec("UPDATE ebook_test_questions SET answer_idx = 1 WHERE id = 'eb1-t1'");
    w.db.exec('UPDATE ebooks SET pass_score = 6 WHERE num = 1');
    w.db.exec(
      `INSERT INTO ebook_test_questions(id, ebook_num, part_idx, part_title, n, q, accept)
       VALUES('eb1-t20', 1, 0, 'P', 20, 'q', '["hi"]')`,
    );
    expect(await code(saveAnswers(w.deps(), 1, { answers: { 'eb1-t20': 'hi' } }))).toBe('validation_failed');
    const res = await submitTest(w.deps(), 1, {
      answers: { 'eb1-t1': 0, 'eb1-t2': 2, 'eb1-t9': 'name', 'eb1-t13': 'she is' },
    });
    expect(res).toMatchObject({ score: 4, total: 6, passScore: 4, passed: true });
  });

  it('keeps users apart', async () => {
    await saveAnswers(w.deps(), 1, { answers: ALL_RIGHT });
    const other = await submitTest(w.deps(OTHER), 1, {});
    expect(other).toMatchObject({ score: 0, passed: false });
  });
});
