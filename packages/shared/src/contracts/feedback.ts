import { z } from 'zod';
import { LIMITS } from '../constants';
import { EpisodeFeedbackState } from '../state';
import { NumParams, Page, PageQuery, QueryBool, Timestamp } from './common';
import { endpoint } from './http';

// NPS per episode (spec 07, feature C). The learner rates an episode 1-5 stars on the Concluído
// screen, with an optional comment; staff read the ratings and an NPS-style summary in the admin.

export const Stars = z.int().min(1).max(5);

/** Trimmed; a blank comment is stored as NULL. */
export const FeedbackComment = z
  .string()
  .trim()
  .max(LIMITS.feedbackCommentMax)
  .transform((v) => (v === '' ? null : v));

// ---------- Student (tie-app) ----------

/**
 * Upsert of the learner's rating for episode :n (one per learner and episode). Idempotent and
 * queueable offline (OUTBOX_PATHS). `comment` absent keeps the stored one; null clears it.
 * 409 gated while the episode is not done (epsDone); 404 for an unknown or unpublished episode.
 */
export const EpisodeFeedbackBody = z.object({
  stars: Stars,
  comment: FeedbackComment.nullable().optional(),
});
export type EpisodeFeedbackBody = z.infer<typeof EpisodeFeedbackBody>;

export const EpisodeFeedbackRes = z.object({
  episode: z.int().positive(),
  feedback: EpisodeFeedbackState,
  updatedAt: Timestamp,
});
export type EpisodeFeedbackRes = z.infer<typeof EpisodeFeedbackRes>;

export const feedbackApi = {
  episode: endpoint({
    method: 'PUT',
    path: '/api/feedback/episodes/:n',
    access: 'user',
    params: NumParams,
    body: EpisodeFeedbackBody,
    res: EpisodeFeedbackRes,
    rateLimit: 'RL_API',
  }),
} as const;

// ---------- Admin (tie-admin) ----------

/** Learner identity in feedback rows: id and display name only (editors hold no users.read). */
export const AdminFeedbackRow = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string().nullable(),
  episodeNum: z.int().positive(),
  episodeTitle: z.string().nullable(),
  stars: Stars,
  comment: z.string().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type AdminFeedbackRow = z.infer<typeof AdminFeedbackRow>;

const QueryInt = z.coerce.number().int();

/** Newest first (updated_at DESC). `q` searches the comment (LIKE, case-insensitive). */
export const FeedbackQuery = PageQuery.extend({
  episode: QueryInt.positive().optional(),
  stars: QueryInt.min(1).max(5).optional(),
  minStars: QueryInt.min(1).max(5).optional(),
  maxStars: QueryInt.min(1).max(5).optional(),
  hasComment: QueryBool.optional(),
  q: z.string().trim().max(200).optional(),
  /** updated_at range, unix ms. */
  from: z.coerce.number().int().min(0).optional(),
  to: z.coerce.number().int().min(0).optional(),
});
export type FeedbackQuery = z.infer<typeof FeedbackQuery>;

/** domain/feedback.ts feedbackStats(): dist[0] = 1★ … dist[4] = 5★; nps = %5★ − %(1-2★), −100..100. */
export const FeedbackStatsSchema = z.object({
  count: z.int().min(0),
  avg: z.number().min(1).max(5).nullable(),
  dist: z.tuple([z.int(), z.int(), z.int(), z.int(), z.int()]),
  nps: z.int().min(-100).max(100).nullable(),
  /** Ratings that carry a comment. */
  comments: z.int().min(0),
});
export type FeedbackStatsSchema = z.infer<typeof FeedbackStatsSchema>;

export const FeedbackSummaryQuery = z.object({
  from: z.coerce.number().int().min(0).optional(),
  to: z.coerce.number().int().min(0).optional(),
});

export const FeedbackSummary = z.object({
  overall: FeedbackStatsSchema,
  /** Every episode with at least one rating in the range, by episode number. */
  episodes: z.array(
    FeedbackStatsSchema.extend({ episodeNum: z.int().positive(), title: z.string().nullable() }),
  ),
});
export type FeedbackSummary = z.infer<typeof FeedbackSummary>;

export const adminFeedbackApi = {
  list: endpoint({
    method: 'GET',
    path: '/admin-api/feedback',
    access: 'staff',
    perm: 'feedback.read',
    query: FeedbackQuery,
    res: Page(AdminFeedbackRow),
  }),
  summary: endpoint({
    method: 'GET',
    path: '/admin-api/feedback/summary',
    access: 'staff',
    perm: 'feedback.read',
    query: FeedbackSummaryQuery,
    res: FeedbackSummary,
  }),
} as const;
