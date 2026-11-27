import { describe, expect, it } from 'vitest';
import { STEP } from '../src/constants';
import {
  cardsOf,
  GRADES,
  gradeCard,
  isKnown,
  KNOWN,
  KNOWN_AT,
  NOT_KNOWN,
  nextIn,
  notKnownDays,
  queue,
  reached,
} from '../src/domain/srs';
import { tsEpisode } from './helpers/catalog';
import { declSource, loadPrototypeCore, plain } from './helpers/core';
import { type Any, extractConst } from './helpers/prototype';

const core = loadPrototypeCore();
const { T } = core;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('srs parity with review.js', () => {
  it('GRADES', () => {
    expect(GRADES.map((g) => [...g])).toEqual(extractConst('js/core/review.js', 'GRADES', { MIN, DAY }));
    expect(GRADES.map((g) => [...g])).toEqual(plain(T.review.GRADES));
  });

  it('cardsOf for every scripted episode and step', () => {
    for (const n of [1, 2, 5]) {
      const E = T.data.EPS[n];
      const ep = tsEpisode(T.data, n);
      // Production steps 1-2 are the prototype's 1-2 and 3-9 its 4-10 (no e-book step); past the last is 10 vs 11.
      const proto = (p: number | undefined) => (p === undefined || p <= 2 ? p : p + 1);
      for (const upTo of [undefined, 0, 1, 3, 4, 7, 8, 9, 10]) {
        expect(cardsOf(ep, upTo), `${n}/${upTo}`).toEqual(plain(T.review.cardsOf(E, proto(upTo))));
      }
    }
  });

  it('reached()', () => {
    // Private in review.js and bound to the store through S(); rebuild it over a given state.
    const protoReached = core.run(`(S) => ${declSource('js/core/review.js', 'reached')}`);
    const states: Any[] = [
      { epsDone: {}, prog: {} },
      { epsDone: { 1: true }, prog: { 1: 3 } },
      { epsDone: {}, prog: { 1: 7 } },
      { epsDone: { 2: true }, prog: { 1: 10 } },
    ];
    for (const s of states) {
      // A done episode reads one past the last step: 10 here (9 steps), 11 in the prototype (10 steps).
      for (const n of [1, 2, 5]) {
        const p = protoReached(() => s)(n);
        expect(reached(s, n)).toBe(p === 11 ? STEP.LAST + 1 : p);
      }
    }
  });

  const now = Date.UTC(2026, 8, 15, 15);
  const offsets = [
    -DAY,
    -1,
    0,
    1,
    30_000,
    59 * MIN,
    60 * MIN,
    61 * MIN,
    23 * HOUR,
    DAY,
    DAY + 1,
    25 * HOUR,
    47 * HOUR,
    3 * DAY,
    5 * DAY + 7,
  ];
  const decks: Any[][] = [
    [],
    [{ en: 'a', pt: 'a', scene: '', at: undefined }],
    ...offsets.map((o) => [{ en: 'x', pt: 'x', scene: '', at: now + o }]),
    offsets.map((o, i) => ({ en: `w${i}`, pt: `p${i}`, scene: '', at: now + o })),
    offsets
      .slice()
      .reverse()
      .filter((o) => o > 0)
      .map((o, i) => ({ en: `f${i}`, pt: `p${i}`, scene: '', at: now + o })),
  ];

  it('queue and nextIn on decks around now', () => {
    core.setNow(now);
    for (const deck of decks) {
      core.setState({ deck: structuredClone(deck) });
      expect(plain(queue(deck, now))).toEqual(plain(T.review.queue()));
      expect(nextIn(deck, now), JSON.stringify(deck)).toBe(T.review.nextIn());
    }
  });

  it('gradeCard follows the fixed intervals', () => {
    core.setNow(now);
    for (let i = 0; i < 4; i++) {
      const deck = [{ en: 'hello', pt: 'olá', scene: '', at: now - 1, reps: i === 2 ? undefined : i }];
      core.setState({ deck: structuredClone(deck), due: 1 });
      T.review.grade('hello', i);
      const after = T.store.s.deck[0];
      expect(gradeCard(deck[0] as { reps?: number }, i, now)).toEqual({ at: after.at, reps: after.reps });
    }
    expect(gradeCard({}, 9, now)).toBeNull();
  });

  it('"Não sei" (NOT_KNOWN) waits 2-4 days by complexity: the longer the card, the sooner it comes back', () => {
    expect(notKnownDays('window')).toBe(4);
    expect(notKnownDays('Hi · Hello')).toBe(3);
    expect(notKnownDays('Nice to meet you.')).toBe(3);
    expect(notKnownDays('I’m Margaret. Good morning, everybody.')).toBe(2);
    expect(notKnownDays('')).toBe(4);
    expect(gradeCard({ en: 'Nice to meet you.', reps: 1 }, NOT_KNOWN, now)).toEqual({
      at: now + 3 * 86_400_000,
      reps: 2,
    });
    // It leaves today's queue.
    const later = gradeCard({ en: 'window' }, NOT_KNOWN, now) as { at: number };
    expect(queue([{ at: later.at }], now + 86_400_000)).toEqual([]);
  });

  it('"Já sei" (KNOWN) leaves the reviews for good; nextIn ignores it (spec 05 "Cards: Já sei / Não sei")', () => {
    expect(gradeCard({ reps: 2 }, KNOWN, now)).toEqual({ at: KNOWN_AT, reps: 3 });
    expect(gradeCard({ en: 'window' }, NOT_KNOWN, now)).toEqual({ at: now + 4 * 86_400_000, reps: 1 });
    const known = { at: KNOWN_AT };
    expect(isKnown(known)).toBe(true);
    expect(isKnown({ at: now + 5 * 86_400_000 })).toBe(false);
    expect(queue([known], now + 100 * 365 * 86_400_000)).toEqual([]);
    expect(nextIn([known], now)).toBe('');
    expect(nextIn([known, { at: now + 2 * 86_400_000 }], now)).toBe('em 2 dias');
  });
});
