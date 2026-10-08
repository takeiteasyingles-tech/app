// GET /api/me/summary: the game part is S4's summary (game/engine.ts, exported as gameSummaryFor),
// so /me/summary and the award engine share one streak rule, one badge/level/episode source and one
// shape. This module only adds the plan, the monthly AI quota and, when the published content
// snapshot (ContentService, slice S9) is wired, the snapshot's level table.
import { DEFAULT_TZ, type MeSummary } from '@tie/shared';
import { batch, period, q, type Services, type SessionInfo } from '@tie/worker-core';
import { gameSummaryFor, summaryLevel } from '../game';
import { quotaInfo } from './common';

/** Level table [minPoints, name][] from the content snapshot; null while ContentService is not wired. */
async function catalogLevels(services: Services): Promise<(readonly [number, string])[] | null> {
  try {
    const cat = await services.content.catalog();
    const levels = cat.game.levels
      .slice()
      .sort((a, b) => a.min - b.min)
      .map((l) => [l.min, l.name] as const);
    return levels.length ? levels : null;
  } catch {
    // ContentService not wired yet (NotImplementedError) or nothing published: keep S4's D1 table.
    return null;
  }
}

export async function buildSummary(
  db: D1Database,
  services: Services,
  s: SessionInfo,
  now: number,
): Promise<MeSummary> {
  const tz = s.tz || DEFAULT_TZ;
  const per = period(now, tz);
  const [game, levels, [usage]] = await Promise.all([
    gameSummaryFor(db, s.userId, { now, tz }),
    catalogLevels(services),
    batch(db, [
      q<{ seconds_used: number }>(
        db,
        'SELECT seconds_used FROM ai_usage_monthly WHERE user_id = ? AND period = ?',
        s.userId,
        per,
      ),
    ]),
  ]);
  return {
    ...game,
    level: levels ? summaryLevel(game.points, levels) : game.level,
    plan: s.plan,
    quota: quotaInfo(s.plan, usage[0]?.seconds_used ?? 0, per),
  };
}
