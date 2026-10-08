import { z } from 'zod';
import { BadgeDef, PointKind } from '../content/schema';
import { DailyStats } from '../state';
import { endpoint } from './http';

/** Result of any award; the client plays the prototype's toasts and confetti from it. */
export const AwardResult = z.object({
  /** false when the award key already existed (idempotent replay) or a daily cap was hit. */
  awarded: z.boolean(),
  kind: PointKind,
  /** Points for this award, without mission bonuses. */
  points: z.int().min(0),
  /** New total, including any mission bonus. */
  total: z.int().min(0),
  /** Points today, for "Meta do dia batida. N pontos hoje." */
  dayPoints: z.int().min(0),
  levelUp: z.object({ n: z.int().positive(), name: z.string() }).nullable(),
  goalHit: z.boolean(),
  newBadges: z.array(BadgeDef),
  /** Daily missions completed by this award (each adds the mission bonus once a day). */
  missionsDone: z.array(z.string()),
});
export type AwardResult = z.infer<typeof AwardResult>;

export const LevelInfo = z.object({
  n: z.int().positive(),
  name: z.string(),
  from: z.int().min(0),
  next: z.int().min(0).nullable(),
  pct: z.int().min(0).max(100),
});
export type LevelInfo = z.infer<typeof LevelInfo>;

export const DailyMission = z.object({
  k: z.string(),
  t: z.string(),
  /** Hash route without "#/". */
  go: z.string(),
  done: z.boolean(),
});
export type DailyMission = z.infer<typeof DailyMission>;

/** game.summary() from the prototype. */
export const GameSummary = z.object({
  points: z.int().min(0),
  level: LevelInfo,
  streak: z.int().min(0),
  goal: z.object({
    target: z.int().positive(),
    done: z.int().min(0),
    pct: z.int().min(0).max(100),
    hit: z.boolean(),
  }),
  daily: DailyStats,
  badges: z.array(BadgeDef.extend({ has: z.boolean() })),
  missions: z.array(DailyMission),
});
export type GameSummary = z.infer<typeof GameSummary>;

/**
 * Badge rules (badges.rule JSON). Every prototype BADGES test maps to one of these:
 * count of a ledger kind, current streak, total points, or days with the goal hit.
 */
export const BadgeRule = z.discriminatedUnion('type', [
  z.object({ type: z.literal('count'), kind: PointKind, min: z.int().positive() }),
  z.object({ type: z.literal('streak'), min: z.int().positive() }),
  z.object({ type: z.literal('points'), min: z.int().positive() }),
  z.object({ type: z.literal('goal_days'), min: z.int().positive() }),
]);
export type BadgeRule = z.infer<typeof BadgeRule>;

/** Client-attested awards accepted by POST /api/game/event (capped by point_rules.daily_cap). */
export const SOFT_EVENT_KINDS = ['song', 'quiz_hit', 'word'] as const;
export const SoftEventKind = z.enum(SOFT_EVENT_KINDS);
export type SoftEventKind = z.infer<typeof SoftEventKind>;

export const GameEventBody = z.object({
  kind: SoftEventKind,
  /**
   * Award-key suffix: song → episode num or track id, quiz_hit → `${scope}:${q}`, word → the word.
   * The server builds the full key (e.g. `word:{normKey}`) and adds the date where the table says so.
   */
  key: z.string().min(1).max(200),
});
export type GameEventBody = z.infer<typeof GameEventBody>;

export const gameApi = {
  event: endpoint({
    method: 'POST',
    path: '/api/game/event',
    access: 'user',
    body: GameEventBody,
    res: AwardResult,
    rateLimit: 'RL_API',
  }),
} as const;
