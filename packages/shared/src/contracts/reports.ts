import { z } from 'zod';
import { LIMITS } from '../constants';
import { IdString } from './common';
import { endpoint } from './http';

/** A user flags something; it lands in moderation_items with kind 'report'. */
export const ReportRefType = z.enum(['mic_session', 'mic_turn', 'extra', 'episode', 'other']);
export type ReportRefType = z.infer<typeof ReportRefType>;

export const UserReportBody = z.object({
  refType: ReportRefType,
  refId: IdString.optional(),
  reason: z.string().trim().min(1).max(LIMITS.freeTextMax),
});
export type UserReportBody = z.infer<typeof UserReportBody>;

export const UserReportRes = z.object({ id: z.string() });
export type UserReportRes = z.infer<typeof UserReportRes>;

export const reportsApi = {
  create: endpoint({
    method: 'POST',
    path: '/api/reports',
    access: 'user',
    body: UserReportBody,
    res: UserReportRes,
    rateLimit: 'RL_UPLOAD',
  }),
} as const;
