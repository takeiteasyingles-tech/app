import { ApiError } from '@tie/shared';
import { invalidateFlags } from '@tie/worker-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { download } from '../ebook';
import { advance, episodeDone, exercise, micScore, stepOk } from '../progress';
import { publish, setProg, USER, type World, world } from './helpers/fixtures';

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ApiError) return err.code;
    throw err;
  }
  return 'ok';
}

async function message(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ApiError) return err.message;
    throw err;
  }
  return '';
}

const prog = (w: World, ep = 1) =>
  w.db.rows<{ furthest_step: number; done_at: number | null }>(
    'SELECT furthest_step, done_at FROM episode_progress WHERE user_id = ? AND episode_num = ?',
    USER,
    ep,
  )[0];

/** Satisfies everything step `n` of episode 1 asks for. */
async function satisfy(w: World, n: number) {
  const d = w.deps();
  if (n === 3) await download(d, 1);
  if (n === 1 || n === 2 || n === 4 || n === 5 || n === 10) await stepOk(d, { ep: 1, step: n });
  if (n === 6) for (const id of ['e1-mic-0', 'e1-mic-1']) await micScore(d, { phraseId: id, score: 5, source: 'demo' });
  if (n === 9) {
    for (const itemId of ['e1-ex0-i0', 'e1-ex0-i1', 'e1-ex1-i0', 'e1-ex1-i1']) await exercise(d, { itemId, choice: 0 });
  }
}

async function walkTo(w: World, target: number) {
  for (let n = 1; n < target; n++) {
    await satisfy(w, n);
    await advance(w.deps(), { ep: 1, step: n + 1 });
  }
}

describe('advance gating (server-side need())', () => {
  let w: World;
  beforeEach(() => {
    w = world();
  });

  it('cannot skip ahead', async () => {
    expect(await code(advance(w.deps(), { ep: 1, step: 3 }))).toBe('gated');
    await satisfy(w, 1);
    expect(await code(advance(w.deps(), { ep: 1, step: 3 }))).toBe('gated');
    expect(await code(advance(w.deps(), { ep: 1, step: 10 }))).toBe('gated');
    expect(prog(w)).toBeUndefined();
    expect(w.award.calls).toEqual([]);
  });

  it('step 1 needs the intro played to the end, then awards step:1:2 once', async () => {
    expect(await message(advance(w.deps(), { ep: 1, step: 2 }))).toBe('Ouça a abertura até o fim');
    await stepOk(w.deps(), { ep: 1, step: 1 });
    const res = await advance(w.deps(), { ep: 1, step: 2 });
    expect(res).toMatchObject({ prog: 2, cardsAdded: 0, award: { awarded: true, kind: 'step' } });
    expect(prog(w)?.furthest_step).toBe(2);
    // Navigating back and forth to reached steps neither awards nor regresses.
    expect(await advance(w.deps(), { ep: 1, step: 1 })).toEqual({ prog: 2, cardsAdded: 0, award: null });
    expect(await advance(w.deps(), { ep: 1, step: 2 })).toEqual({ prog: 2, cardsAdded: 0, award: null });
    expect(w.award.calls.map((c) => c.key)).toEqual(['step:1:2']);
  });

  it('step 3 needs the e-book downloaded', async () => {
    await walkTo(w, 3);
    expect(prog(w)?.furthest_step).toBe(3);
    expect(await message(advance(w.deps(), { ep: 1, step: 4 }))).toBe('Baixe o e-book para seguir');
    await download(w.deps(), 1);
    expect((await advance(w.deps(), { ep: 1, step: 4 })).prog).toBe(4);
  });

  it('the e-book unlock is per e-book, shared by its episodes', async () => {
    await download(w.deps(), 1);
    // Episode 2 belongs to e-book 1 too and has no scene video: step 4 does not gate.
    setProg(w, 1, 10, true);
    setProg(w, 2, 3);
    expect((await advance(w.deps(), { ep: 2, step: 4 })).prog).toBe(4);
    expect((await advance(w.deps(), { ep: 2, step: 5 })).prog).toBe(5);
  });

  it('step 4 with a video needs it watched; leaving 4 and 8 unlocks the cards', async () => {
    await walkTo(w, 4);
    expect(await message(advance(w.deps(), { ep: 1, step: 5 }))).toBe('Assista à cena até o fim');
    expect(w.srs.calls).toEqual([]);
    await stepOk(w.deps(), { ep: 1, step: 4 });
    expect(await advance(w.deps(), { ep: 1, step: 5 })).toMatchObject({ prog: 5, cardsAdded: 2 });
    await walkTo(w, 9);
    expect(w.srs.calls).toEqual([
      { episode: 1, step: 4 },
      { episode: 1, step: 8 },
    ]);
  });

  it('step 6 needs every phrase recorded, step 9 every exercise answered', async () => {
    await walkTo(w, 6);
    expect(await message(advance(w.deps(), { ep: 1, step: 7 }))).toBe('Faltam 2 frases para gravar');
    await micScore(w.deps(), { phraseId: 'e1-mic-0', score: 3, source: 'demo' });
    expect(await message(advance(w.deps(), { ep: 1, step: 7 }))).toBe('Falta gravar 1 frase');
    await satisfy(w, 6);
    await advance(w.deps(), { ep: 1, step: 7 });
    await advance(w.deps(), { ep: 1, step: 8 });
    await advance(w.deps(), { ep: 1, step: 9 });
    expect(await message(advance(w.deps(), { ep: 1, step: 10 }))).toBe('Faltam 4 respostas');
    await satisfy(w, 9);
    expect((await advance(w.deps(), { ep: 1, step: 10 })).prog).toBe(10);
    expect(w.award.awardedKeys().filter((k) => k.startsWith('step:'))).toEqual(
      [2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `step:1:${n}`),
    );
  });

  it('unpublished or unknown episodes are unavailable', async () => {
    expect(await code(advance(w.deps(), { ep: 3, step: 2 }))).toBe('content_unavailable');
    expect(await code(advance(w.deps(), { ep: 99, step: 2 }))).toBe('content_unavailable');
    expect(await code(stepOk(w.deps(), { ep: 3, step: 1 }))).toBe('content_unavailable');
  });

  it('"Etapas livres" skips need() only with the dev.free_steps flag, and never skips ahead', async () => {
    w.db.exec('INSERT INTO user_settings(user_id, free) VALUES(?, 1)', USER);
    expect(await code(advance(w.deps(), { ep: 1, step: 2 }))).toBe('gated');
    w.db.exec("INSERT INTO feature_flags(key, enabled, rollout_pct, updated_at) VALUES('dev.free_steps', 1, 100, 1)");
    invalidateFlags();
    try {
      expect((await advance(w.deps(), { ep: 1, step: 2 })).prog).toBe(2);
      expect(await code(advance(w.deps(), { ep: 1, step: 4 }))).toBe('gated');
    } finally {
      w.db.exec("DELETE FROM feature_flags WHERE key = 'dev.free_steps'");
      invalidateFlags();
    }
  });

  it('other users progress independently', async () => {
    await walkTo(w, 3);
    expect(await code(advance(w.deps('u_bob'), { ep: 1, step: 2 }))).toBe('gated');
  });
});

describe('episode lock (trilha: only done and current episodes open)', () => {
  it('refuses every write on an episode while an earlier published one is unfinished', async () => {
    const w = world();
    const d = w.deps();
    await download(d, 1);
    setProg(w, 2, 6);
    expect(await message(stepOk(d, { ep: 2, step: 1 }))).toBe('Termine o episódio 1 para abrir este.');
    expect(await code(advance(d, { ep: 2, step: 7 }))).toBe('gated');
    expect(await code(episodeDone(d, { ep: 2 }))).toBe('gated');
    expect(w.db.rows('SELECT * FROM step_completions')).toEqual([]);
    expect(w.award.calls).toEqual([]);
    // Navigation to reached steps writes nothing and stays allowed.
    expect(await advance(d, { ep: 2, step: 3 })).toEqual({ prog: 6, cardsAdded: 0, award: null });

    setProg(w, 1, 10, true);
    expect(await stepOk(d, { ep: 2, step: 1 })).toMatchObject({ stepOk: '2-1' });
    expect((await advance(d, { ep: 2, step: 7 })).prog).toBe(7);
  });

  it('"Etapas livres" does not open locked episodes', async () => {
    const w = world();
    w.db.exec('INSERT INTO user_settings(user_id, free) VALUES(?, 1)', USER);
    w.db.exec("INSERT INTO feature_flags(key, enabled, rollout_pct, updated_at) VALUES('dev.free_steps', 1, 100, 1)");
    invalidateFlags();
    try {
      expect(await code(advance(w.deps(), { ep: 2, step: 2 }))).toBe('gated');
      expect((await advance(w.deps(), { ep: 1, step: 2 })).prog).toBe(2);
    } finally {
      w.db.exec("DELETE FROM feature_flags WHERE key = 'dev.free_steps'");
      invalidateFlags();
    }
  });
});

describe('gating against the published snapshot (S9 ContentService)', () => {
  it('need() counts only published phrases and items, not unpublished D1 edits', async () => {
    const w = world();
    w.content = publish(w);
    w.db.exec("INSERT INTO mic_phrases(id, episode_num, sort, en) VALUES('e1-mic-9', 1, 9, 'Unpublished')");
    w.db.exec(
      `INSERT INTO exercise_items(id, exercise_id, sort, q, opts, answer_idx) VALUES('e1-ex0-i9', 'e1-ex0', 9, 'new', '["a","b"]', 0)`,
    );
    await walkTo(w, 6);
    await satisfy(w, 6);
    expect((await advance(w.deps(), { ep: 1, step: 7 })).prog).toBe(7);
    await advance(w.deps(), { ep: 1, step: 8 });
    await advance(w.deps(), { ep: 1, step: 9 });
    await satisfy(w, 9);
    expect((await advance(w.deps(), { ep: 1, step: 10 })).prog).toBe(10);
  });

  it('an episode unpublished in the snapshot is unavailable even if D1 says published, and vice versa', async () => {
    const w = world();
    w.db.exec("UPDATE episodes SET status = 'draft' WHERE num = 1");
    w.content = publish(w);
    w.db.exec("UPDATE episodes SET status = 'published' WHERE num IN (1, 3)");
    expect(await code(stepOk(w.deps(), { ep: 1, step: 1 }))).toBe('content_unavailable');
    expect(await code(stepOk(w.deps(), { ep: 3, step: 1 }))).toBe('content_unavailable');
    // Episode 2 is now the first published one, so it is open.
    expect(await stepOk(w.deps(), { ep: 2, step: 1 })).toMatchObject({ stepOk: '2-1' });
  });

  it('falls back to D1 while the ContentService is the NotImplemented stub or nothing is published', async () => {
    const w = world();
    const notImplemented = Object.assign(new Error('ContentService.current (slice S9)'), {
      name: 'NotImplementedError',
    });
    w.content = {
      current: () => Promise.reject(notImplemented),
      catalog: () => Promise.reject(notImplemented),
      episode: () => Promise.reject(notImplemented),
      ebook: () => Promise.reject(notImplemented),
      extra: () => Promise.reject(notImplemented),
    };
    expect(await stepOk(w.deps(), { ep: 1, step: 1 })).toMatchObject({ stepOk: '1-1' });
    w.content = { ...publish(w), current: async () => null };
    expect(await stepOk(w.deps(), { ep: 1, step: 1 })).toMatchObject({ stepOk: '1-1' });
  });
});

describe('step-ok', () => {
  it('records reached media steps only; step 10 also awards song once', async () => {
    const w = world();
    expect(await code(stepOk(w.deps(), { ep: 1, step: 2 }))).toBe('gated');
    expect(await code(stepOk(w.deps(), { ep: 1, step: 3 }))).toBe('bad_request');
    expect(await stepOk(w.deps(), { ep: 1, step: 1 })).toEqual({ stepOk: '1-1', award: null });
    expect(await stepOk(w.deps(), { ep: 1, step: 1 })).toEqual({ stepOk: '1-1', award: null });
    expect(w.db.rows('SELECT step FROM step_completions WHERE user_id = ?', USER)).toEqual([{ step: 1 }]);

    setProg(w, 1, 10);
    const first = await stepOk(w.deps(), { ep: 1, step: 10 });
    expect(first.award).toMatchObject({ awarded: true, kind: 'song' });
    expect((await stepOk(w.deps(), { ep: 1, step: 10 })).award?.awarded).toBe(false);
    expect(w.award.awardedKeys()).toEqual(['song:1']);
  });
});

describe('episode-done', () => {
  it('needs step 10 reached and sung, then awards episode once', async () => {
    const w = world();
    expect(await code(episodeDone(w.deps(), { ep: 1 }))).toBe('gated');
    await walkTo(w, 10);
    expect(await message(episodeDone(w.deps(), { ep: 1 }))).toBe('Cante a música até o fim');
    await stepOk(w.deps(), { ep: 1, step: 10 });
    const res = await episodeDone(w.deps(), { ep: 1 });
    expect(res).toMatchObject({ epsDone: true, cardsAdded: 0, award: { awarded: true, kind: 'episode' } });
    expect(prog(w)).toEqual({ furthest_step: 10, done_at: expect.any(Number) });
    const doneAt = prog(w)?.done_at;

    const again = await episodeDone(w.deps(undefined, Date.now() + 1000), { ep: 1 });
    expect(again.award?.awarded).toBe(false);
    expect(prog(w)?.done_at).toBe(doneAt);
    // A finished episode is fully open for navigation.
    expect(await advance(w.deps(), { ep: 1, step: 3 })).toEqual({ prog: 10, cardsAdded: 0, award: null });
  });
});
