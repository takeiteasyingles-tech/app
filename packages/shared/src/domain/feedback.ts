// NPS-style summary of the 1-5 star episode ratings (spec 07, feature C). Shared so the admin
// summary endpoint, its tests and any client chart compute the same numbers.
//
// Stars map to the classic NPS buckets: 5★ = promoter, 3-4★ = passive, 1-2★ = detractor.
//   nps = round(100 × (promoters − detractors) / count), from −100 to 100 (null with no ratings)
//   avg = mean stars rounded to 2 decimals (null with no ratings)

/** Count of ratings per star, index 0 = 1★ … index 4 = 5★. */
export type StarDist = readonly [number, number, number, number, number];

export interface FeedbackStats {
  count: number;
  avg: number | null;
  dist: StarDist;
  nps: number | null;
}

export const emptyStarDist = (): [number, number, number, number, number] => [0, 0, 0, 0, 0];

/** Adds one rating (1..5) to a distribution; other values are ignored. */
export function addStar(dist: [number, number, number, number, number], stars: number): void {
  if (Number.isInteger(stars) && stars >= 1 && stars <= 5) dist[stars - 1] = (dist[stars - 1] ?? 0) + 1;
}

export function feedbackStats(dist: StarDist): FeedbackStats {
  const d = dist.map((n) => Math.max(0, Math.floor(n || 0))) as unknown as [number, number, number, number, number];
  const count = d.reduce((a, b) => a + b, 0);
  if (count === 0) return { count: 0, avg: null, dist: d, nps: null };
  const sum = d.reduce((acc, n, i) => acc + n * (i + 1), 0);
  const promoters = d[4];
  const detractors = d[0] + d[1];
  return {
    count,
    avg: Math.round((sum / count) * 100) / 100,
    dist: d,
    nps: Math.round((100 * (promoters - detractors)) / count),
  };
}
