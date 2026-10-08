import { describe, expect, it } from 'vitest';
import { cardsOf, GRADES, gradeCard, nextIn, queue, reached } from '../src/domain/srs';
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
      for (const upTo of [undefined, 0, 1, 4, 5, 8, 9, 10, 11]) {
        expect(cardsOf(ep, upTo), `${n}/${upTo}`).toEqual(plain(T.review.cardsOf(E, upTo)));
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
      for (const n of [1, 2, 5]) expect(reached(s, n)).toBe(protoReached(() => s)(n));
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
});
