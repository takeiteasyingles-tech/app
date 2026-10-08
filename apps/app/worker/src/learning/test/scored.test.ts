import { ApiError } from '@tie/shared';
import { signMediaToken } from '@tie/worker-core';
import { beforeEach, describe, expect, it } from 'vitest';
// The signer POST /api/pronounce (routes/ai.ts) uses; interop.test.ts runs the real route end to end.
import { ATTEMPT_TTL_MS, signAttempt } from '../../ai/attempt';
import { exercise, micScore } from '../progress';
import { NOW, OTHER, publish, SECRET, setProg, USER, type World, world } from './helpers/fixtures';

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ApiError) return err.code;
    throw err;
  }
  return 'ok';
}

describe('exercise grading', () => {
  let w: World;
  beforeEach(() => {
    w = world();
    setProg(w, 1, 9);
  });

  it('grades with exercise_items.answer_idx and awards ex:{itemId} when right', async () => {
    const res = await exercise(w.deps(), { itemId: 'e1-ex0-i0', choice: 1 });
    expect(res).toMatchObject({ itemId: 'e1-ex0-i0', choice: 1, correct: true, answer: 1, fix: 'Use b.' });
    expect(res.award).toMatchObject({ awarded: true, kind: 'ex_right' });
    expect(w.award.awardedKeys()).toEqual(['ex:e1-ex0-i0']);
  });

  it('a wrong answer awards nothing and returns the key and fix', async () => {
    const res = await exercise(w.deps(), { itemId: 'e1-ex0-i0', choice: 2 });
    expect(res).toMatchObject({ choice: 2, correct: false, answer: 1, fix: 'Use b.', award: null });
    expect(w.award.calls).toEqual([]);
  });

  it('the first answer is final: replays return the stored answer, never re-grade or double-award', async () => {
    const wrong = await exercise(w.deps(), { itemId: 'e1-ex0-i1', choice: 2 });
    expect(wrong.correct).toBe(false);
    // Changing the answer after seeing the key does not work.
    const retry = await exercise(w.deps(), { itemId: 'e1-ex0-i1', choice: 0 });
    expect(retry).toMatchObject({ choice: 2, correct: false, award: null });

    const right = await exercise(w.deps(), { itemId: 'e1-ex1-i0', choice: 2 });
    const replay = await exercise(w.deps(), { itemId: 'e1-ex1-i0', choice: 2 });
    expect(right.award?.awarded).toBe(true);
    expect(replay).toMatchObject({ choice: 2, correct: true });
    expect(replay.award?.awarded).toBe(false);
    expect(w.award.awardedKeys()).toEqual(['ex:e1-ex1-i0']);
    expect(
      w.db.rows('SELECT item_id, choice_idx, correct FROM exercise_answers WHERE user_id = ? ORDER BY item_id', USER),
    ).toEqual([
      { item_id: 'e1-ex0-i1', choice_idx: 2, correct: 0 },
      { item_id: 'e1-ex1-i0', choice_idx: 2, correct: 1 },
    ]);
  });

  it('answers are per user', async () => {
    setProg(w, 1, 9, false, OTHER);
    await exercise(w.deps(), { itemId: 'e1-ex0-i0', choice: 0 });
    expect((await exercise(w.deps(OTHER), { itemId: 'e1-ex0-i0', choice: 1 })).correct).toBe(true);
  });

  it('rejects unknown items, out-of-range choices and unreached steps', async () => {
    expect(await code(exercise(w.deps(), { itemId: 'nope', choice: 0 }))).toBe('not_found');
    expect(await code(exercise(w.deps(), { itemId: 'e1-ex0-i0', choice: 3 }))).toBe('validation_failed');
    setProg(w, 1, 8);
    expect(await code(exercise(w.deps(), { itemId: 'e1-ex0-i0', choice: 1 }))).toBe('gated');
    expect(w.db.rows('SELECT * FROM exercise_answers')).toEqual([]);
  });

  it('grades against the published key, not an unpublished edit', async () => {
    w.content = publish(w);
    // An editor changes the key and adds an item to the live episode without publishing.
    w.db.exec("UPDATE exercise_items SET answer_idx = 2 WHERE id = 'e1-ex0-i0'");
    w.db.exec(
      `INSERT INTO exercise_items(id, exercise_id, sort, q, opts, answer_idx) VALUES('e1-ex0-i9', 'e1-ex0', 9, 'new', '["a","b"]', 0)`,
    );
    expect(await exercise(w.deps(), { itemId: 'e1-ex0-i0', choice: 1 })).toMatchObject({ correct: true, answer: 1 });
    expect(await code(exercise(w.deps(), { itemId: 'e1-ex0-i9', choice: 0 }))).toBe('not_found');
  });
});

describe('mic attempt token (S7 ai/attempt.ts, as signed by /api/pronounce)', () => {
  let w: World;
  beforeEach(() => {
    w = world();
    setProg(w, 1, 6);
  });

  const token = (score: number, phraseId = 'e1-mic-0', userId = USER, now = NOW) =>
    signAttempt(SECRET, { userId, phraseId, score }, now);

  it("an 'ia' score comes from the token routes/ai.ts signs and can award mic_good", async () => {
    const res = await micScore(w.deps(), { phraseId: 'e1-mic-0', score: 3, source: 'ia', attempt: await token(9) });
    expect(res).toMatchObject({ phraseId: 'e1-mic-0', last: 9, best: 9, attempts: 1 });
    expect(res.award).toMatchObject({ kind: 'mic_good', awarded: true });
    expect(w.award.awardedKeys()).toEqual(['mic_good:e1-mic-0']);
  });

  it("an 'ia' score below 8 awards mic_try", async () => {
    const res = await micScore(w.deps(), {
      phraseId: 'e1-mic-1',
      score: 6,
      source: 'ia',
      attempt: await token(6, 'e1-mic-1'),
    });
    expect(res.award).toMatchObject({ kind: 'mic_try' });
    expect(w.award.awardedKeys()).toEqual(['mic_try:e1-mic-1']);
  });

  it("an 'ia' score without a valid token for this user and phrase is refused", async () => {
    const d = w.deps();
    const refused = async (attempt: string | undefined, deps = d) =>
      code(micScore(deps, { phraseId: 'e1-mic-0', score: 10, source: 'ia', ...(attempt ? { attempt } : {}) }));
    expect(await refused(undefined)).toBe('token_invalid');
    expect(await refused(await token(10, 'e1-mic-1'))).toBe('token_invalid');
    expect(await refused(await token(10, 'e1-mic-0', OTHER))).toBe('token_invalid');
    expect(
      await refused(await signAttempt('another-secret', { userId: USER, phraseId: 'e1-mic-0', score: 10 }, NOW)),
    ).toBe('token_invalid');
    expect(await refused(await token(10), w.deps(USER, NOW + ATTEMPT_TTL_MS + 1))).toBe('token_invalid');

    const good = await token(6);
    const [v, payload, sig] = good.split('.') as [string, string, string];
    const forged = btoa(JSON.stringify({ u: USER, p: 'e1-mic-0', s: 10, e: NOW + 10_000 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await refused(`${v}.${forged}.${sig}`)).toBe('token_invalid');
    expect(await refused(`${v}.${payload}.${sig.slice(0, -2)}AA`)).toBe('token_invalid');
    expect(await refused(`t1.${payload}.${sig}`)).toBe('token_invalid');
    expect(await refused((await signMediaToken(SECRET, USER, NOW)).token)).toBe('token_invalid');
    for (const bad of ['x', 'a.b', 'a.b.c.d', `${v}.!!.${sig}`]) expect(await refused(bad)).toBe('token_invalid');

    expect(w.db.rows('SELECT * FROM mic_scores')).toEqual([]);
    expect(w.award.calls).toEqual([]);
  });
});

describe('POST /api/progress/mic', () => {
  let w: World;
  beforeEach(() => {
    w = world();
    setProg(w, 1, 6);
  });

  it('demo scores are recorded (source demo) but only ever award mic_try', async () => {
    const res = await micScore(w.deps(), { phraseId: 'e1-mic-0', score: 10, source: 'demo' });
    expect(res).toMatchObject({ last: 10, best: 10, attempts: 1 });
    expect(res.award).toMatchObject({ kind: 'mic_try' });
    expect(w.award.awardedKeys()).toEqual(['mic_try:e1-mic-0']);
    expect(w.db.rows('SELECT source FROM mic_scores')).toEqual([{ source: 'demo' }]);
  });

  it("'script' uses the phrase's scripted result, not the client's number", async () => {
    const res = await micScore(w.deps(), { phraseId: 'e1-mic-0', score: 2, source: 'script' });
    expect(res).toMatchObject({ last: 9, best: 9 });
    expect(res.award?.kind).toBe('mic_try');
  });

  it("'script' with no scripted result stores the published default (7), whatever the client sends", async () => {
    w.db.exec("UPDATE mic_phrases SET demo_result = NULL WHERE id = 'e1-mic-1'");
    expect(await micScore(w.deps(), { phraseId: 'e1-mic-1', score: 10, source: 'script' })).toMatchObject({
      last: 7,
      best: 7,
    });
  });

  it('upserts last / best / attempts and awards each kind once per phrase', async () => {
    await micScore(w.deps(), { phraseId: 'e1-mic-0', score: 4, source: 'demo' });
    const attempt = await signAttempt(SECRET, { userId: USER, phraseId: 'e1-mic-0', score: 9 }, NOW + 1_000);
    await micScore(w.deps(USER, NOW + 2_000), { phraseId: 'e1-mic-0', score: 9, source: 'ia', attempt });
    const last = await micScore(w.deps(USER, NOW + 3_000), { phraseId: 'e1-mic-0', score: 5, source: 'demo' });
    expect(last).toMatchObject({ last: 5, best: 9, attempts: 3 });
    expect(last.award?.awarded).toBe(false);
    expect(w.award.awardedKeys().sort()).toEqual(['mic_good:e1-mic-0', 'mic_try:e1-mic-0']);
    expect(
      w.db.rows('SELECT last_score, best_score, attempts, source FROM mic_scores WHERE user_id = ?', USER),
    ).toEqual([{ last_score: 5, best_score: 9, attempts: 3, source: 'demo' }]);
  });

  it('rejects unknown or unpublished phrases and unreached steps', async () => {
    expect(await code(micScore(w.deps(), { phraseId: 'nope', score: 5, source: 'demo' }))).toBe('not_found');
    expect(await code(micScore(w.deps(), { phraseId: 'e3-mic-0', score: 5, source: 'demo' }))).toBe('not_found');
    setProg(w, 1, 5);
    expect(await code(micScore(w.deps(), { phraseId: 'e1-mic-0', score: 5, source: 'demo' }))).toBe('gated');
  });

  it('a phrase added to the live episode but not published yet is not recordable', async () => {
    w.content = publish(w);
    w.db.exec("INSERT INTO mic_phrases(id, episode_num, sort, en) VALUES('e1-mic-9', 1, 9, 'Unpublished')");
    expect(await code(micScore(w.deps(), { phraseId: 'e1-mic-9', score: 5, source: 'demo' }))).toBe('not_found');
    // The published scripted result is used.
    w.db.exec("UPDATE mic_phrases SET demo_result = 1 WHERE id = 'e1-mic-0'");
    expect(await micScore(w.deps(), { phraseId: 'e1-mic-0', score: 5, source: 'script' })).toMatchObject({ last: 9 });
  });
});

describe('POST /api/progress/mic replays (outbox, reused token)', () => {
  let w: World;
  beforeEach(() => {
    w = world();
    setProg(w, 1, 6);
  });

  const stats = () =>
    w.db.rows('SELECT last_score, best_score, attempts, source FROM mic_scores WHERE user_id = ?', USER);

  it("replaying the same 'ia' attempt counts it once", async () => {
    const attempt = await signAttempt(SECRET, { userId: USER, phraseId: 'e1-mic-0', score: 9 }, NOW);
    const first = await micScore(w.deps(USER, NOW + 1_000), { phraseId: 'e1-mic-0', score: 9, source: 'ia', attempt });
    const replay = await micScore(w.deps(USER, NOW + 60_000), {
      phraseId: 'e1-mic-0',
      score: 9,
      source: 'ia',
      attempt,
    });
    expect(first).toMatchObject({ last: 9, best: 9, attempts: 1 });
    expect(replay).toMatchObject({ last: 9, best: 9, attempts: 1 });
    expect(replay.award?.awarded).toBe(false);
    expect(stats()).toEqual([{ last_score: 9, best_score: 9, attempts: 1, source: 'ia' }]);
  });

  it('a replay after later tries changes nothing; a newer attempt still counts', async () => {
    const a = await signAttempt(SECRET, { userId: USER, phraseId: 'e1-mic-0', score: 9 }, NOW);
    await micScore(w.deps(USER, NOW + 1_000), { phraseId: 'e1-mic-0', score: 9, source: 'ia', attempt: a });
    await micScore(w.deps(USER, NOW + 5_000), { phraseId: 'e1-mic-0', score: 4, source: 'demo' });
    // The outbox replays the first request after the demo try.
    expect(
      await micScore(w.deps(USER, NOW + 9_000), { phraseId: 'e1-mic-0', score: 9, source: 'ia', attempt: a }),
    ).toMatchObject({ last: 4, best: 9, attempts: 2 });
    expect(stats()).toEqual([{ last_score: 4, best_score: 9, attempts: 2, source: 'demo' }]);

    const b = await signAttempt(SECRET, { userId: USER, phraseId: 'e1-mic-0', score: 6 }, NOW + 20_000);
    expect(
      await micScore(w.deps(USER, NOW + 21_000), { phraseId: 'e1-mic-0', score: 6, source: 'ia', attempt: b }),
    ).toMatchObject({ last: 6, best: 9, attempts: 3 });
    expect(stats()).toEqual([{ last_score: 6, best_score: 9, attempts: 3, source: 'ia' }]);
  });

  it('two real attempts both count, even out of order or issued in the same millisecond (spec 06)', async () => {
    const early = await signAttempt(SECRET, { userId: USER, phraseId: 'e1-mic-0', score: 5 }, NOW);
    const late = await signAttempt(SECRET, { userId: USER, phraseId: 'e1-mic-0', score: 8 }, NOW + 2_000);
    const twin = await signAttempt(SECRET, { userId: USER, phraseId: 'e1-mic-0', score: 7 }, NOW + 2_000);
    // The later attempt lands first (the earlier one waited in the outbox).
    await micScore(w.deps(USER, NOW + 3_000), { phraseId: 'e1-mic-0', score: 8, source: 'ia', attempt: late });
    await micScore(w.deps(USER, NOW + 4_000), { phraseId: 'e1-mic-0', score: 5, source: 'ia', attempt: early });
    await micScore(w.deps(USER, NOW + 5_000), { phraseId: 'e1-mic-0', score: 7, source: 'ia', attempt: twin });
    expect(stats()).toEqual([{ last_score: 7, best_score: 8, attempts: 3, source: 'ia' }]);
    expect(w.db.rows('SELECT COUNT(*) AS n FROM attempt_uses WHERE user_id = ?', USER)).toEqual([{ n: 3 }]);
  });
});
