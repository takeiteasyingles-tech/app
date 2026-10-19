import { z } from 'zod';
import { IdParams, IsoDate, Timestamp } from './common';
import { endpoint } from './http';

// Learning statistics for staff (spec 07, feature C): one learner's progress, and the course funnel.
// Dates are local dates in America/Sao_Paulo for aggregates, the learner's own tz for one learner
// (daily_stats.local_date is already in the learner's tz).

const Pct = z.int().min(0).max(100);

export const UserLearningStats = z.object({
  userId: z.string(),
  /** One row per episode the learner has opened (episode_progress), by episode number. */
  episodes: z.array(
    z.object({
      num: z.int().positive(),
      title: z.string().nullable(),
      seasonN: z.int().positive().nullable(),
      /** Furthest step reached (1..10), the "current step". */
      furthestStep: z.int().min(1).max(10),
      done: z.boolean(),
      doneAt: Timestamp.nullable(),
      updatedAt: Timestamp,
    }),
  ),
  ebookTests: z.array(
    z.object({
      ebookNum: z.int().positive(),
      score: z.int().min(0),
      passScore: z.int().min(0).nullable(),
      passed: z.boolean(),
      /** 0 while a redo is in progress. */
      submittedAt: Timestamp,
    }),
  ),
  seasonTests: z.array(
    z.object({
      seasonN: z.int().positive(),
      score: z.int().min(0),
      total: z.int().min(0),
      scorePct: Pct,
      bestPct: Pct,
      passed: z.boolean(),
      attempts: z.int().min(0),
      submittedAt: Timestamp,
      passedAt: Timestamp.nullable(),
    }),
  ),
  certificates: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      seasonN: z.int().positive(),
      scorePct: Pct,
      issuedAt: Timestamp,
      revokedAt: Timestamp.nullable(),
    }),
  ),
  study: z.object({
    points: z.int().min(0),
    streak: z.int().min(0),
    lastDay: z.string().nullable(),
    /** Seconds talking to the assistant (daily_stats.maggie_sec), all time and last 30 days. */
    maggieSecTotal: z.int().min(0),
    maggieSec30d: z.int().min(0),
    /** Days with any activity (daily_stats rows) in the last 30 days. */
    activeDays30d: z.int().min(0),
    goalDays: z.int().min(0),
    srsCards: z.int().min(0),
  }),
  /** Last 30 local days, oldest first, zero-filled (points timeline). */
  last30: z.array(
    z.object({
      date: IsoDate,
      points: z.int(),
      steps: z.int(),
      cards: z.int(),
      mic: z.int(),
      extras: z.int(),
      maggieSec: z.int(),
      goal: z.boolean(),
    }),
  ),
  feedback: z.array(
    z.object({
      episodeNum: z.int().positive(),
      stars: z.int().min(1).max(5),
      comment: z.string().nullable(),
      updatedAt: Timestamp,
    }),
  ),
});
export type UserLearningStats = z.infer<typeof UserLearningStats>;

export const LearningStatsQuery = z.object({
  /** Window for activeByDay and the "recent" counters. */
  days: z.coerce.number().int().min(7).max(90).default(30),
});
export type LearningStatsQuery = z.infer<typeof LearningStatsQuery>;

export const LearningStats = z.object({
  generatedAt: Timestamp,
  days: z.int(),
  /** Funnel over every PUBLISHED episode, by number. */
  episodes: z.array(
    z.object({
      num: z.int().positive(),
      title: z.string(),
      seasonN: z.int().positive().nullable(),
      /** Learners with an episode_progress row. */
      started: z.int().min(0),
      /** Learners with done_at set. */
      completed: z.int().min(0),
      /** round(100 × completed / started); 0 when nobody started. */
      completionPct: Pct,
      ratings: z.int().min(0),
      avgStars: z.number().nullable(),
      nps: z.int().min(-100).max(100).nullable(),
    }),
  ),
  ebookTests: z.array(
    z.object({
      ebookNum: z.int().positive(),
      /** Learners with a graded result (submitted_at > 0). */
      takers: z.int().min(0),
      passed: z.int().min(0),
      passPct: Pct,
    }),
  ),
  seasonTests: z.array(
    z.object({
      seasonN: z.int().positive(),
      published: z.boolean(),
      takers: z.int().min(0),
      passed: z.int().min(0),
      passPct: Pct,
      avgAttempts: z.number().nullable(),
      certificates: z.int().min(0),
    }),
  ),
  /** Distinct learners with any daily_stats row per day, oldest first, zero-filled. */
  activeByDay: z.array(z.object({ date: IsoDate, learners: z.int().min(0) })),
});
export type LearningStats = z.infer<typeof LearningStats>;

export const adminStatsApi = {
  user: endpoint({
    method: 'GET',
    path: '/admin-api/users/:id/stats',
    access: 'staff',
    perm: 'users.read',
    params: IdParams,
    res: UserLearningStats,
  }),
  learning: endpoint({
    method: 'GET',
    path: '/admin-api/stats/learning',
    access: 'staff',
    perm: 'users.read',
    query: LearningStatsQuery,
    res: LearningStats,
  }),
} as const;
