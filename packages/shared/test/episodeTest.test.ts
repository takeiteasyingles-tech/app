import { describe, expect, it } from 'vitest';
import { EPISODE_TEST_SIZE, episodeTestPassScore, pickEpisodeTest } from '../src/domain/episodeTest';

// The prototype's e-book 1 test: [part, n, episode reviewed].
const EBOOK1: [number, number, number][] = [
  [0, 1, 1],
  [0, 2, 2],
  [0, 3, 2],
  [0, 4, 2],
  [0, 5, 2],
  [0, 6, 2],
  [0, 7, 1],
  [0, 8, 1],
  [1, 9, 1],
  [1, 10, 1],
  [1, 11, 1],
  [1, 12, 2],
  [1, 13, 2],
  [2, 14, 1],
  [2, 15, 2],
  [2, 16, 2],
  [2, 17, 2],
  [3, 18, 1],
  [3, 19, 2],
  [3, 20, 1],
];
const qs = EBOOK1.map(([part, n, ep]) => ({ part, n, ep }));

describe('pickEpisodeTest', () => {
  it('keeps six questions about the episode, one part at a time, in test order', () => {
    expect(EPISODE_TEST_SIZE).toBe(6);
    expect(pickEpisodeTest(qs, [1]).map((q) => q.n)).toEqual([1, 7, 9, 10, 14, 18]);
    expect(pickEpisodeTest(qs, [2]).map((q) => q.n)).toEqual([2, 3, 12, 13, 15, 19]);
  });

  it('fills with other episodes when this one has fewer than six', () => {
    const few = qs.filter((q) => q.ep === 2 || q.n === 1 || q.n === 9);
    expect(pickEpisodeTest(few, [1]).map((q) => q.n)).toEqual([1, 2, 9, 12, 15, 19]);
  });

  it('returns a short test whole, and is stable', () => {
    const short = qs.slice(0, 4);
    expect(pickEpisodeTest(short, [9]).map((q) => q.n)).toEqual([1, 2, 3, 4]);
    expect(pickEpisodeTest(qs, [1])).toEqual(pickEpisodeTest([...qs].reverse(), [1]));
  });
});

describe('episodeTestPassScore', () => {
  it('keeps the share of right answers, rounded up', () => {
    expect(episodeTestPassScore(14, 20, 6)).toBe(5);
    expect(episodeTestPassScore(10, 20, 6)).toBe(3);
    expect(episodeTestPassScore(4, 6, 6)).toBe(4);
    expect(episodeTestPassScore(14, 0, 0)).toBe(14);
  });
});
