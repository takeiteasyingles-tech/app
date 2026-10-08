// Award calls from the AI routes. The game engine (S4) owns AwardService; an award failure (or the
// stub before integration) must never fail a conversation turn, so it is logged and reported as null.
import type { AwardResult, PointKind } from '@tie/shared';
import type { AwardMeta, Services } from '@tie/worker-core';

export async function tryAward(
  services: Services,
  userId: string,
  kind: PointKind,
  key: string,
  meta?: AwardMeta,
): Promise<AwardResult | null> {
  try {
    return await services.award.award(userId, kind, key, meta);
  } catch (err) {
    console.error(JSON.stringify({ level: 'warn', msg: 'award failed', kind, key, error: String(err) }));
    return null;
  }
}

/** Seconds of Mic time per tutor turn and per pronunciation try (spec 03 §B "Sessions"). */
export const MAGGIE_SEC_TURN = 20;
export const MAGGIE_SEC_PRONOUNCE = 15;

/** The rolling window of S7's own per-user award bounds. */
export const AWARD_WINDOW_MS = 86_400_000;

/**
 * At most this many maggie_turn awards per user per rolling 24 h (S7's own bound, on every path:
 * model turns, server-side demo turns and pronunciation tries). Server-side demo turns cost no
 * quota, so without it they could be farmed at the RL_AI rate. point_rules.daily_cap (S4) may be
 * stricter.
 */
export const MAX_TURN_AWARDS_PER_DAY = 100;

/**
 * At most this many maggie_session awards per user per rolling 24 h (S7's own bound;
 * point_rules.daily_cap may be stricter).
 */
export const MAX_SESSION_AWARDS_PER_DAY = 8;

/**
 * Batchable count (`n`, read with countOf) of the user's `kind` awards that landed in
 * point_ledger within the window ending at `now`. The ledger is the record of points that were
 * actually granted, and nothing in S7 deletes from it (Mic session retention does not touch it),
 * so the count cannot be reset by deleting sessions.
 *
 * Cost: `+kind` keeps SQLite off ix_ledger_kind (every row of that kind ever) and on ix_ledger_day
 * (user_id, local_date, kind), so only the user's ledger rows of the last ~3 local days are read.
 * local_date is the user's local day; a local day never starts more than a day before the UTC
 * one, so the UTC date two days back is a safe lower bound for the window in any timezone.
 */
export function recentAwards(
  db: D1Database,
  userId: string,
  kind: PointKind,
  now: number,
  windowMs: number = AWARD_WINDOW_MS,
): D1PreparedStatement {
  const fromDate = new Date(now - windowMs - AWARD_WINDOW_MS).toISOString().slice(0, 10);
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM point_ledger
       WHERE user_id = ? AND local_date >= ? AND +kind = ? AND created_at > ?`,
    )
    .bind(userId, fromDate, kind, now - windowMs);
}
