// PROD (0014, "Take the Test"): the episode test is a short slice of its e-book's test. Compile and the
// e-book route pick the same questions so the published file and the grading agree.

/** Questions an episode test keeps at most. */
export const EPISODE_TEST_SIZE = 6;

/** A test question as the picker sees it: its part, its number in the part and its episode. */
export interface EpisodeTestCandidate {
  part: number;
  n: number;
  ep: number | null;
}

/**
 * Picks up to `max` questions: the episode's own questions (and those of no episode) first, then the
 * rest, taking one question from each part in turn so every part is represented. Returns them in
 * test order (part, then number).
 */
export function pickEpisodeTest<T extends EpisodeTestCandidate>(
  qs: readonly T[],
  eps: readonly number[],
  max = EPISODE_TEST_SIZE,
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

/** The e-book's pass score scaled to the questions kept (rounded up, never above `kept`). */
export function episodeTestPassScore(passScore: number, total: number, kept: number): number {
  if (kept >= total || total <= 0) return passScore;
  return Math.max(0, Math.min(kept, Math.ceil((passScore * kept) / total - 1e-9)));
}
