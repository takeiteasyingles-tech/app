import type { AwardResult, PointKind } from '@tie/shared';
import { NotImplementedError } from '../errors';

/** Extra data stored in point_ledger.meta; maggieSec also feeds daily_stats.maggie_sec. */
export interface AwardMeta {
  maggieSec?: number;
  /** Server clock override (tests, replayed outbox writes). */
  now?: number;
  [k: string]: unknown;
}

/**
 * Game engine (slice S4). award() is idempotent per (userId, key): a replayed key returns
 * awarded:false with the current totals. Keys follow spec 04 §2 "Award keys", e.g. `step:1:5`.
 */
export interface AwardService {
  award(userId: string, kind: PointKind, key: string, meta?: AwardMeta): Promise<AwardResult>;
}

export const awardServiceStub: AwardService = {
  award() {
    return Promise.reject(new NotImplementedError('AwardService.award (slice S4)'));
  },
};
