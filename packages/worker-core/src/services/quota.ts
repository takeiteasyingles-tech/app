import type { QuotaInfo } from '@tie/shared';
import { NotImplementedError } from '../errors';

export type AiUsageKind = 'tutor' | 'report' | 'pronounce' | 'tts' | 'asr' | 'guard';

export interface ReserveInput {
  kind: AiUsageKind;
  model?: string;
  sessionId?: string;
}

export type ReserveResult = { ok: true; reservedS: number; quota: QuotaInfo } | { ok: false; quota: QuotaInfo };

/**
 * Monthly AI-seconds quota (slice S7). Limit = plan.ai_minutes_month*60, period YYYY-MM in the
 * user's tz. reserve() is a conditional UPDATE (seconds_used + ? <= limit); on ok:false the route
 * answers 429 quota_exceeded and the client falls back to demo mode.
 */
export interface QuotaService {
  reserve(userId: string, seconds: number, input: ReserveInput): Promise<ReserveResult>;
  remaining(userId: string): Promise<QuotaInfo>;
}

const notImplemented = (what: string) => Promise.reject(new NotImplementedError(`QuotaService.${what} (slice S7)`));

export const quotaServiceStub: QuotaService = {
  reserve: () => notImplemented('reserve'),
  remaining: () => notImplemented('remaining'),
};
