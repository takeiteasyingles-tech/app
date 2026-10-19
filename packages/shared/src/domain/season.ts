// Season test rules shared by the student app, tie-app and tie-admin (spec 07, feature B).

/**
 * The season test opens once every PUBLISHED episode of the season is done. A season with no
 * published episode never unlocks. `publishedEpisodes` are the episode numbers of the season with
 * status 'published'; `epsDone` is TieState.epsDone (or the server's equivalent set).
 */
export function seasonTestUnlocked(
  publishedEpisodes: readonly number[],
  epsDone: Readonly<Record<string, boolean>>,
): boolean {
  return publishedEpisodes.length > 0 && publishedEpisodes.every((n) => epsDone[String(n)] === true);
}

/** Published episodes of the season not yet done, ascending. */
export function seasonEpisodesMissing(
  publishedEpisodes: readonly number[],
  epsDone: Readonly<Record<string, boolean>>,
): number[] {
  return publishedEpisodes.filter((n) => epsDone[String(n)] !== true).sort((a, b) => a - b);
}

/** round(100 × score / total), 0 when there is nothing to grade. */
export function scorePct(score: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((100 * score) / total)));
}

/** Passing compares the rounded percentage with seasons.test_pass_pct (inclusive). */
export const seasonTestPassed = (pct: number, passPct: number): boolean => pct >= passPct;
