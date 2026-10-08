import type { AddCardsRes, GradeRes, SrsQueueRes } from '@tie/shared';
import { localDate } from '@tie/worker-core';
import { describe, expect, it } from 'vitest';
import { SRS_DECK_MAX, SRS_MANUAL_ADDS_PER_DAY } from '../../src/services/srs.impl';
import { harness, TZ } from './harness';

const MIN = 60_000;
const DAY = 86_400_000;

describe('SrsService.unlock', () => {
  it('step 4 adds the visual words once, deduped by norm (INSERT OR IGNORE)', async () => {
    const h = await harness();
    const added = await h.srs.unlock('u1', 1, 4);
    // "The kitchen." folds into "the kitchen"; the malformed item is dropped.
    expect(added.map((c) => c.en)).toEqual(['the kitchen', 'I am home!']);
    expect(added[0]).toMatchObject({ pt: 'a cozinha', scene: 'Ep. 1 · Take a Look', note: '', at: h.clock.t, reps: 0 });
    expect(await h.srs.unlock('u1', 1, 4)).toEqual([]);
    const rows = h.db.sql<{ norm_key: string; source: string }>(
      'SELECT norm_key, source FROM srs_cards WHERE user_id = ? ORDER BY rowid',
      'u1',
    );
    expect(rows).toEqual([
      { norm_key: 'the kitchen', source: 'ep_visual' },
      { norm_key: "i'm home", source: 'ep_visual' },
    ]);
  });

  it('step 8 adds the awayExp expressions with notes; other steps and unknown episodes add nothing', async () => {
    const h = await harness();
    const added = await h.srs.unlock('u1', 1, 8);
    expect(added.map((c) => [c.en, c.note, c.scene])).toEqual([
      ['Take it easy', 'informal', 'Ep. 1 · Take Away'],
      ['See you', '', 'Ep. 1 · Take Away'],
    ]);
    expect(h.db.sql('SELECT DISTINCT source FROM srs_cards')).toEqual([{ source: 'ep_away' }]);
    expect(await h.srs.unlock('u1', 1, 5)).toEqual([]);
    expect(await h.srs.unlock('u1', 99, 4)).toEqual([]);
  });

  it('decks are per user, and a manual card blocks the same unlocked card', async () => {
    const h = await harness();
    await h.srs.add('u1', [{ en: "I'm home", pt: 'manual', scene: 'Mic · Maggie', source: 'mic' }]);
    expect((await h.srs.unlock('u1', 1, 4)).map((c) => c.en)).toEqual(['the kitchen']);
    expect(await h.srs.unlock('u2', 1, 4)).toHaveLength(2);
  });
});

describe('SrsService.add', () => {
  it('dedupes within the batch and against the deck, counting skipped', async () => {
    const h = await harness();
    const a = await h.srs.add('u1', [
      { en: 'Grab a coffee', pt: 'Pegar um café', scene: 'Woods · A', source: 'extra' },
      { en: 'grab a coffee!', pt: 'dup', scene: 'x', source: 'extra' },
      { en: '?!', pt: 'empty norm', scene: 'x', source: 'extra' },
    ]);
    expect(a.added.map((c) => c.en)).toEqual(['Grab a coffee']);
    expect(a).toMatchObject({ skipped: 2, due: 1 });
    const b = await h.srs.add('u1', [{ en: 'GRAB A COFFEE', pt: 'x', scene: 'x', note: 'n', source: 'report' }]);
    expect(b).toMatchObject({ added: [], skipped: 1, due: 1 });
  });

  it('caps manual adds per rolling day (overflow skipped, then quota_exceeded); unlocks are not capped', async () => {
    const h = await harness();
    const batchOf = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({ en: `word ${from + i}`, pt: '', scene: '', source: 'mic' as const }));
    let added = 0;
    for (let i = 0; i < SRS_MANUAL_ADDS_PER_DAY; i += 50) added += (await h.srs.add('u1', batchOf(i, 50))).added.length;
    expect(added).toBe(SRS_MANUAL_ADDS_PER_DAY);
    await expect(h.srs.add('u1', batchOf(10_000, 1))).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(await h.srs.unlock('u1', 1, 4)).toHaveLength(2);
    expect(await h.srs.add('u2', batchOf(0, 1))).toMatchObject({ skipped: 0 }); // per user
    h.clock.t += DAY + 1;
    expect((await h.srs.add('u1', batchOf(20_000, 3))).added).toHaveLength(3);
  });

  it('skips the overflow inside one batch at the daily cap', async () => {
    const h = await harness();
    const batchOf = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({ en: `w ${from + i}`, pt: '', scene: '', source: 'extra' as const }));
    for (let i = 0; i < SRS_MANUAL_ADDS_PER_DAY - 10; i += 10) await h.srs.add('u1', batchOf(i, 10));
    const r = await h.srs.add('u1', batchOf(5_000, 25));
    expect(r).toMatchObject({ skipped: 15 });
    expect(r.added).toHaveLength(10);
  });

  it('caps the deck size for manual adds', async () => {
    const h = await harness();
    const t = h.clock.t - 2 * DAY; // old cards: outside the daily window, inside the deck cap
    for (let i = 0; i < SRS_DECK_MAX; i++) {
      h.db.sql(
        `INSERT INTO srs_cards(id, user_id, norm_key, en, pt, source, due_at, created_at) VALUES(?, 'u1', ?, ?, '', 'mic', ?, ?)`,
        `c${i}`,
        `k${i}`,
        `k${i}`,
        t,
        t,
      );
    }
    await expect(h.srs.add('u1', [{ en: 'one more', pt: '', scene: '', source: 'mic' }])).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
  });
});

describe('SrsService.grade', () => {
  it('follows GRADES: De novo now (back of queue), Difícil 10 min, Bom 2 d, Fácil 5 d; reps++', async () => {
    const h = await harness();
    const cards = await h.srs.unlock('u1', 1, 8);
    const [a, b] = cards as [(typeof cards)[0], (typeof cards)[0]];
    const t0 = h.clock.t;
    h.clock.t = t0 + 1000;
    const r0 = await h.srs.grade('u1', a.id, 0);
    expect(r0.card).toMatchObject({ at: t0 + 1000, reps: 1 });
    // De novo puts the card after the other due card.
    expect((await h.srs.queue('u1')).cards.map((c) => c.id)).toEqual([b.id, a.id]);
    const r1 = await h.srs.grade('u1', a.id, 1);
    expect(r1.card).toMatchObject({ at: t0 + 1000 + 10 * MIN, reps: 2 });
    expect(r1.due).toBe(1);
    expect((await h.srs.grade('u1', a.id, 2)).card.at).toBe(t0 + 1000 + 2 * DAY);
    expect((await h.srs.grade('u1', a.id, 3)).card).toMatchObject({ at: t0 + 1000 + 5 * DAY, reps: 4 });
    expect(await h.srs.nextIn('u1')).toBe('em 1 min');
    await h.srs.grade('u1', b.id, 2);
    expect(await h.srs.nextIn('u1')).toBe('em 2 dias');
  });

  it('awards card:{id}:{date} once per card per local day, only for due cards', async () => {
    const h = await harness();
    const [c] = await h.srs.unlock('u1', 1, 4);
    const id = c?.id as string;
    // De novo keeps it due: the regrade is a replay of the same day's key.
    expect((await h.srs.grade('u1', id, 0)).award?.awarded).toBe(true);
    expect((await h.srs.grade('u1', id, 1)).award?.awarded).toBe(false);
    // Not due for 10 min: grading early reschedules but awards nothing.
    const early = await h.srs.grade('u1', id, 2);
    expect(early.award).toBeNull();
    expect(early.card).toMatchObject({ reps: 3, at: h.clock.t + 2 * DAY });
    h.clock.t += 2 * DAY; // due again
    expect((await h.srs.grade('u1', id, 2)).award?.awarded).toBe(true);
    expect(h.award.calls.map((x) => x.key)).toEqual([
      `card:${id}:${localDate(h.clock.t - 2 * DAY, TZ)}`,
      `card:${id}:${localDate(h.clock.t - 2 * DAY, TZ)}`,
      `card:${id}:${localDate(h.clock.t, TZ)}`,
    ]);
  });

  it("rejects another user's card as not found and leaves it untouched (IDOR)", async () => {
    const h = await harness();
    const [c] = await h.srs.unlock('u1', 1, 4);
    await expect(h.srs.grade('u2', c?.id as string, 3)).rejects.toMatchObject({ code: 'not_found' });
    expect(h.db.sql('SELECT reps, due_at FROM srs_cards WHERE id = ?', c?.id)).toEqual([{ reps: 0, due_at: c?.at }]);
    expect(h.award.calls).toEqual([]);
  });
});

describe('/api/srs routes', () => {
  it('require a session', async () => {
    const h = await harness();
    expect((await h.call(null, 'GET', '/api/srs/queue')).status).toBe(401);
    expect((await h.call(null, 'POST', '/api/srs/cards', { cards: [] })).status).toBe(401);
  });

  it('GET /api/srs/queue lists due cards oldest first with counts and nextAt', async () => {
    const h = await harness();
    const cards = await h.srs.unlock('u1', 1, 4);
    await h.srs.grade('u1', cards[0]?.id as string, 3);
    const res = await h.call('u1', 'GET', '/api/srs/queue');
    expect(res.status).toBe(200);
    const body = (await res.json()) as SrsQueueRes;
    expect(body.cards.map((c) => c.en)).toEqual(['I am home!']);
    expect(body).toMatchObject({ due: 1, total: 2, nextAt: cards[1]?.at });
    const other = (await (await h.call('u2', 'GET', '/api/srs/queue')).json()) as SrsQueueRes;
    expect(other).toEqual({ cards: [], due: 0, total: 0, nextAt: null });
  });

  it('POST /api/srs/cards adds, skips duplicates and awards word:{normKey} once', async () => {
    const h = await harness();
    const card = { en: 'Grab a coffee!', pt: 'Pegar um café', scene: 'Woods · A', source: 'extra' };
    const r1 = (await (await h.call('u1', 'POST', '/api/srs/cards', { cards: [card] })).json()) as AddCardsRes;
    expect(r1.added).toHaveLength(1);
    expect(r1.award).toMatchObject({ awarded: true, kind: 'word' });
    const r2 = (await (await h.call('u1', 'POST', '/api/srs/cards', { cards: [card] })).json()) as AddCardsRes;
    expect(r2).toMatchObject({ added: [], skipped: 1, award: null });
    expect(h.award.calls.map((x) => x.key)).toEqual(['word:grab a coffee']);
  });

  it('POST /api/srs/cards rejects episode sources and oversized batches', async () => {
    const h = await harness();
    const bad = { en: 'x', pt: 'y', scene: 'z', source: 'ep_visual' };
    expect((await h.call('u1', 'POST', '/api/srs/cards', { cards: [bad] })).status).toBe(400);
    const many = Array.from({ length: 51 }, (_, i) => ({ en: `w${i}`, pt: '', scene: '', source: 'mic' }));
    expect((await h.call('u1', 'POST', '/api/srs/cards', { cards: many })).status).toBe(400);
  });

  it("POST /api/srs/cards/:id/grade grades the owner's card and 404s for anyone else", async () => {
    const h = await harness();
    const [c] = await h.srs.unlock('u1', 1, 4);
    const id = c?.id as string;
    const denied = await h.call('u2', 'POST', `/api/srs/cards/${id}/grade`, { grade: 3 });
    expect(denied.status).toBe(404);
    expect(h.db.sql('SELECT reps FROM srs_cards WHERE id = ?', id)).toEqual([{ reps: 0 }]);
    expect((await h.call('u1', 'POST', `/api/srs/cards/${id}/grade`, { grade: 4 })).status).toBe(400);
    const ok = await h.call('u1', 'POST', `/api/srs/cards/${id}/grade`, { grade: 2 });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as GradeRes;
    expect(body.card).toMatchObject({ id, reps: 1, at: h.clock.t + 2 * DAY });
    expect(body.award).toMatchObject({ awarded: true, kind: 'card' });
  });
});
