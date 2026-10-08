// Small request helpers shared by the S7 routes.
import type { AppEnv, FlagSubject, SessionInfo } from '@tie/worker-core';
import type { Context } from 'hono';

/** ctx.waitUntil when the runtime gives one; otherwise the promise just runs (errors are logged). */
export function background(c: Context<AppEnv>, p: Promise<unknown>): void {
  const guarded = p.catch((err) =>
    console.error(JSON.stringify({ level: 'error', msg: 'background', error: String(err) })),
  );
  try {
    c.executionCtx.waitUntil(guarded);
  } catch {
    // No ExecutionContext (unit tests calling app.request without one).
  }
}

/** Feature-flag subject for the signed-in user. */
export function flagSubject(s: SessionInfo): FlagSubject {
  return { userId: s.userId, planSlug: s.plan?.slug ?? null, roles: s.roles };
}
