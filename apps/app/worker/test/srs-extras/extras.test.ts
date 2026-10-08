import type { ChallengeRes, DubRes, ExtraSeenRes, KaraokeGapRes } from '@tie/shared';
import { describe, expect, it } from 'vitest';
import { signAttempt } from '../../src/ai/attempt';
import { CHALLENGE_MAX_HITS, challengeMaxScore, challengePlausible, resolveGap } from '../../src/routes/extras';
import { harness, MEDIA_TOKEN_KEY } from './harness';

const json = async <T>(r: Response | Promise<Response>): Promise<T> => (await r).json() as Promise<T>;

describe('challenge sanity caps', () => {
  it('matches the prototype scoring (10 × combo, combo up to ×5)', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map(challengeMaxScore)).toEqual([0, 10, 30, 60, 100, 150, 200, 400]);
  });

  it('accepts reachable results and rejects impossible ones', () => {
    expect(challengePlausible(0, 0)).toBe(true);
    expect(challengePlausible(150, 5)).toBe(true);
    expect(challengePlausible(50, 5)).toBe(true);
    expect(challengePlausible(160, 5)).toBe(false); // above the max for 5 hits
    expect(challengePlausible(40, 5)).toBe(false); // below 10 per hit
    expect(challengePlausible(55, 5)).toBe(false); // not a multiple of 10
    expect(challengePlausible(10, 0)).toBe(false);
    expect(challengePlausible(challengeMaxScore(CHALLENGE_MAX_HITS), CHALLENGE_MAX_HITS)).toBe(true);
    expect(challengePlausible(10 * (CHALLENGE_MAX_HITS + 1), CHALLENGE_MAX_HITS + 1)).toBe(false);
  });
});

describe('/api/extras', () => {
  it('require a session', async () => {
    const h = await harness();
    expect((await h.call(null, 'POST', '/api/extras/woods/seen')).status).toBe(401);
    expect((await h.call(null, 'POST', '/api/extras/challenge', { score: 0, hits: 0 })).status).toBe(401);
    expect((await h.call(null, 'POST', '/api/karaoke/gap', { trackId: 't-own', line: 0, choice: 'x' })).status).toBe(
      401,
    );
  });

  it('POST /:id/seen marks seen, sets last_extra_id and awards extra:{id} once', async () => {
    const h = await harness();
    const r1 = await json<ExtraSeenRes>(h.call('u1', 'POST', '/api/extras/woods/seen'));
    expect(r1).toMatchObject({ seen: true, lastId: 'woods', award: { awarded: true, kind: 'extra' } });
    const first = h.db.sql<{ seen_at: number }>('SELECT seen_at FROM user_extras WHERE user_id = ?', 'u1')[0];
    const r2 = await json<ExtraSeenRes>(h.call('u1', 'POST', '/api/extras/woods/seen'));
    expect(r2.award?.awarded).toBe(false);
    expect(h.db.sql('SELECT seen_at FROM user_extras WHERE user_id = ?', 'u1')).toEqual([first]);
    expect(h.db.sql('SELECT last_extra_id, points FROM user_stats WHERE user_id = ?', 'u1')).toEqual([
      { last_extra_id: 'woods', points: 20 },
    ]);
    expect(h.award.calls.map((c) => c.key)).toEqual(['extra:woods', 'extra:woods']);
  });

  it('POST /:id/seen 404s for unknown, locked and unpublished extras', async () => {
    const h = await harness();
    for (const id of ['nope', 'soon', 'draft']) {
      expect((await h.call('u1', 'POST', `/api/extras/${id}/seen`)).status).toBe(404);
    }
    expect(h.award.calls).toEqual([]);
  });

  it('POST /:id/dub keeps the prototype running average and awards dub:{id} once', async () => {
    const h = await harness();
    const dub = (score: number, line = 0) =>
      json<DubRes>(h.call('u1', 'POST', '/api/extras/woods/dub', { score, source: 'demo', line }));
    expect(await dub(6)).toMatchObject({ avg: 6, count: 1, award: { awarded: true, kind: 'dub' } });
    const second = await dub(9, 1);
    expect(second).toMatchObject({ avg: 8, count: 2 }); // round((6 + 9) / 2)
    expect(second.award?.awarded).toBe(false);
    expect(await dub(2, 2)).toMatchObject({ avg: 5, count: 3 });
    // Another character's line, an out-of-range line and an out-of-range score are rejected.
    for (const body of [
      { score: 5, source: 'demo', line: 3 },
      { score: 5, source: 'demo', line: 4 },
      { score: 11, source: 'demo', line: 0 },
    ]) {
      expect((await h.call('u1', 'POST', '/api/extras/woods/dub', body)).status).toBe(400);
    }
    expect(h.award.calls.map((c) => c.key)).toEqual(['dub:woods', 'dub:woods', 'dub:woods']);
  });

  it('POST /:id/dub 404s for extras without a dubbing character', async () => {
    const h = await harness();
    const r = await h.call('u1', 'POST', '/api/extras/nodub/dub', { score: 5, source: 'demo', line: 0 });
    expect(r.status).toBe(404);
    expect(h.db.sql('SELECT * FROM user_extras')).toEqual([]);
    expect(h.award.calls).toEqual([]);
  });

  it("POST /:id/dub accepts an 'ia' score only with the server-signed attempt token", async () => {
    const h = await harness();
    const dub = (body: Record<string, unknown>) => h.call('u1', 'POST', '/api/extras/woods/dub', body);
    const sign = (userId: string, phraseId: string, score: number) =>
      signAttempt(MEDIA_TOKEN_KEY, { userId, phraseId, score });
    const good = await sign('u1', 'woods:1', 9);
    const bad = [
      { score: 9, source: 'ia', line: 1 }, // missing token
      { score: 10, source: 'ia', line: 1, attempt: good }, // score differs from the signed one
      { score: 9, source: 'ia', line: 2, attempt: good }, // another line
      { score: 9, source: 'ia', line: 1, attempt: await sign('u2', 'woods:1', 9) }, // another user
      {
        score: 9,
        source: 'ia',
        line: 1,
        attempt: await signAttempt('other-key', { userId: 'u1', phraseId: 'woods:1', score: 9 }),
      },
      { score: 9, source: 'ia', line: 1, attempt: `${good.slice(0, -4)}AAAA` }, // tampered
    ];
    for (const body of bad) {
      const r = await dub(body);
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe('token_invalid');
    }
    expect(h.db.sql('SELECT * FROM user_extras')).toEqual([]);
    expect(h.award.calls).toEqual([]);
    const ok = await dub({ score: 9, source: 'ia', line: 1, attempt: good });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ avg: 9, count: 1, award: { awarded: true, kind: 'dub' } });
  });

  it('premium extras need a plan with premium_extras (no points otherwise)', async () => {
    const h = await harness();
    for (const [path, body] of [
      ['/api/extras/vip/seen', undefined],
      ['/api/extras/vip/dub', { score: 5, source: 'demo', line: 0 }],
    ] as const) {
      const denied = await h.call('u1', 'POST', path, body);
      expect(denied.status).toBe(403);
      expect(((await denied.json()) as { error: { code: string } }).error.code).toBe('plan_required');
      expect((await h.call('u2', 'POST', path, body)).status).toBe(200);
    }
    expect(h.award.calls.map((c) => [c.userId, c.key])).toEqual([
      ['u2', 'extra:vip'],
      ['u2', 'dub:vip'],
    ]);
  });

  it('POST /challenge keeps the record, rejects implausible results and awards once a day at ≥5 hits', async () => {
    const h = await harness();
    const play = (score: number, hits: number, extraId?: string) =>
      h.call('u1', 'POST', '/api/extras/challenge', { score, hits, extraId });
    expect((await play(160, 5)).status).toBe(400);
    expect((await play(10 * 200, 200)).status).toBe(400);
    expect((await play(50, 5, 'nope')).status).toBe(404);
    expect((await play(50, 5, 'draft')).status).toBe(404);
    expect(h.award.calls).toEqual([]);

    const r1 = await json<ChallengeRes>(play(40, 4));
    expect(r1).toEqual({ best: 40, newRecord: true, award: null });
    const r2 = await json<ChallengeRes>(play(150, 5, 'woods'));
    expect(r2).toMatchObject({ best: 150, newRecord: true, award: { awarded: true, kind: 'ex_right' } });
    const r3 = await json<ChallengeRes>(play(100, 7));
    expect(r3).toMatchObject({ best: 150, newRecord: false, award: { awarded: false } });
    expect(h.db.sql('SELECT challenge_best FROM user_stats WHERE user_id = ?', 'u1')).toEqual([
      { challenge_best: 150 },
    ]);
    expect(h.award.calls.map((c) => c.key)).toEqual([
      expect.stringMatching(/^challenge:\d{4}-\d{2}-\d{2}$/),
      expect.stringMatching(/^challenge:\d{4}-\d{2}-\d{2}$/),
    ]);
    // Another user's record is separate.
    expect(await json<ChallengeRes>(h.call('u2', 'POST', '/api/extras/challenge', { score: 0, hits: 0 }))).toEqual({
      best: 0,
      newRecord: false,
      award: null,
    });
  });
});

describe('/api/karaoke/gap', () => {
  it('grades on the server and awards kgap:{track}:{line} once for a right pick', async () => {
    const h = await harness();
    const pick = (trackId: string, line: number, choice: string) =>
      json<KaraokeGapRes>(h.call('u1', 'POST', '/api/karaoke/gap', { trackId, line, choice }));
    expect(await pick('t-own', 0, 'Do')).toEqual({ correct: false, answer: 'Don’t', award: null });
    const right = await pick('t-own', 0, "don't");
    expect(right).toMatchObject({ correct: true, answer: 'Don’t', award: { awarded: true, kind: 'ex_right' } });
    expect((await pick('t-own', 0, 'Don’t')).award?.awarded).toBe(false);
    expect(h.award.calls.map((c) => c.key)).toEqual(['kgap:t-own:0', 'kgap:t-own:0']);
  });

  it('reads the episode lyrics for tracks that point at an episode', async () => {
    const h = await harness();
    const r = await json<KaraokeGapRes>(
      h.call('u1', 'POST', '/api/karaoke/gap', { trackId: 't-ep', line: 0, choice: 'There' }),
    );
    expect(r).toMatchObject({ correct: true, answer: 'there' });
  });

  it('an episode lyric line without a gap blanks its first word (compile.ts / tracksOf)', async () => {
    const h = await harness();
    const r = await json<KaraokeGapRes>(
      h.call('u1', 'POST', '/api/karaoke/gap', { trackId: 't-ep', line: 1, choice: 'no' }),
    );
    expect(r).toMatchObject({ correct: true, answer: 'No', award: { awarded: true, kind: 'ex_right' } });
    expect(h.award.calls.map((c) => c.key)).toEqual(['kgap:t-ep:1']);
  });

  it('404s for unknown tracks, missing lines and tracks of unpublished episodes (no answer leak)', async () => {
    const h = await harness();
    const gap = (trackId: string, line: number) =>
      h.call('u1', 'POST', '/api/karaoke/gap', { trackId, line, choice: 'draft' });
    expect((await gap('nope', 0)).status).toBe(404);
    expect((await gap('t-ep', 2)).status).toBe(404);
    expect((await gap('t-own', 5)).status).toBe(404);
    const draft = await gap('t-draft', 0);
    expect(draft.status).toBe(404);
    expect(await draft.json()).not.toHaveProperty('answer');
    expect(h.award.calls).toEqual([]);
  });

  it('resolveGap mirrors the compiler fallback', () => {
    expect(resolveGap({ en: 'Hello there', gap: 'there,' }, true)).toBe('there,');
    expect(resolveGap({ en: 'Hello there' }, true)).toBe('Hello');
    expect(resolveGap({ en: 'Hello there', gap: '' }, true)).toBe('Hello');
    expect(resolveGap({ en: 'Hello there' }, false)).toBe('');
    expect(resolveGap(undefined, true)).toBe('');
  });
});
