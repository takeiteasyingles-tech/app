import type { AppEnv, AwardService, ContentService, FlagSubject, SrsService } from '@tie/worker-core';
import { sessionOf } from '@tie/worker-core';
import type { Context } from 'hono';

/** What the learning use cases need; routes build it from the request, tests pass fakes. */
export interface LearningDeps {
  db: D1Database;
  award: AwardService;
  srs: SrsService;
  /**
   * Published content snapshot (S9). Gating and grading read it when it answers; while it is the
   * NotImplemented stub, or before the first publish, they fall back to the D1 content tables.
   */
  content?: ContentService;
  /** MEDIA_TOKEN_KEY: verifies the /api/pronounce attempt tokens. */
  attemptSecret: string;
  userId: string;
  /** Feature-flag subject (dev.free_steps). */
  subject: FlagSubject;
  now: number;
}

export function depsFrom(c: Context<AppEnv>): LearningDeps {
  const session = sessionOf(c);
  const services = c.get('services');
  return {
    db: c.env.DB,
    // Getters on the registry build services lazily; resolving them here is cheap (factories only).
    get award() {
      return services.award;
    },
    get srs() {
      return services.srs;
    },
    get content() {
      return services.content;
    },
    attemptSecret: c.env.MEDIA_TOKEN_KEY,
    userId: session.userId,
    subject: { userId: session.userId, planSlug: session.plan?.slug ?? null, roles: session.roles },
    now: Date.now(),
  };
}
