// PROD (spec 05 "Take the Test: six questions"): an episode's test asks EPISODE_TEST_SIZE questions.
// The e-book rows the episodes inherited hold the prototype's 20-question test, which covers two
// lessons; publishing keeps six of them, the same way on every run, so the published file, the
// server's grading and the client all see the same questions.

/** Questions in one episode's Take the Test. */
export const EPISODE_TEST_SIZE = 6;

export interface EpisodeTestCandidate {
  /** Test part index (Parte A, B…). */
  part: number;
  /** Order inside the test. */
  n: number;
  /** Episode the question reviews (null: the test's own episode). */
  ep: number | null;
}

/**
 * The questions an episode's test keeps: the ones about this episode first (any of `eps`), taken one
 * part at a time (Parte A, B, C, D, A…) so a short test still covers every part, then the others the
 * same way while there is room. Returned in the test's order. A test of `max` questions or fewer is
 * returned whole.
 */
export function pickEpisodeTest<T extends EpisodeTestCandidate>(
  qs: readonly T[],
  eps: readonly number[],
  max: number = EPISODE_TEST_SIZE,
): T[] {
  const order = (a: T, b: T) => a.part - b.part || a.n - b.n;
  if (qs.length <= max) return [...qs].sort(order);
  const own = (q: T) => q.ep == null || eps.includes(q.ep);
  const picked: T[] = [];
  for (const pool of [qs.filter(own), qs.filter((q) => !own(q))]) {
    const byPart = new Map<number, T[]>();
    for (const q of [...pool].sort(order)) {
      const list = byPart.get(q.part) ?? [];
      list.push(q);
      byPart.set(q.part, list);
    }
    const lanes = [...byPart.values()];
    for (let i = 0; picked.length < max && lanes.some((l) => l.length > i); i++) {
      for (const lane of lanes) {
        const q = lane[i];
        if (q && picked.length < max) picked.push(q);
      }
    }
  }
  return picked.sort(order);
}

/**
 * The pass score for the kept questions: the same share of right answers as `passScore` of `total`
 * (rounded up, so 14 of 20 = 70% becomes 5 of 6), unchanged when nothing was dropped.
 */
export function episodeTestPassScore(passScore: number, total: number, kept: number): number {
  if (kept >= total || total <= 0) return passScore;
  return Math.max(0, Math.min(kept, Math.ceil((passScore * kept) / total - 1e-9)));
}
