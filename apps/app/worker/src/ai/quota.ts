// QuotaService (slice S7, spec 04 §3.1 "Quota"): monthly AI seconds per user.
// Limit = plan.ai_minutes_month * 60 (assigned active unexpired plan, else the active default plan,
// else 0). Period = YYYY-MM in the user's timezone. reserve() is one conditional UPDATE, so two
// concurrent calls can never push seconds_used past the limit. Every reserve writes ai_usage_events.
import type { QuotaInfo } from '@tie/shared';
import {
  type AiUsageKind,
  type Env,
  fail,
  one,
  period,
  type QuotaService,
  quotaServiceStub,
  type ReserveInput,
  type ReserveResult,
  run,
  type ServiceFactory,
  type Services,
} from '@tie/worker-core';

interface Subject {
  tz: string;
  limitS: number;
}

export interface UsageOutcome {
  ok: boolean;
  latencyMs?: number | null;
  model?: string | null;
}

export type ReserveResultWithEvent = ReserveResult & { eventId: number | null };

/** The registered QuotaService plus the event bookkeeping the AI routes use. */
export interface AiQuotaService extends QuotaService {
  reserve(userId: string, seconds: number, input: ReserveInput): Promise<ReserveResultWithEvent>;
  /** Records the outcome (ok, latency, model actually used) on the event reserve() wrote. */
  finish(eventId: number | null, outcome: UsageOutcome): Promise<void>;
  /**
   * Gives back a reservation whose AI call failed (the user got nothing for it): credits the month
   * and zeroes the event's seconds, once (a replayed refund is a no-op).
   */
  refund(userId: string, r: ReserveResultWithEvent, outcome: Omit<UsageOutcome, 'ok'>): Promise<void>;
  /** Logs a call that billed nothing (cache hit, demo fallback, guard). */
  log(userId: string, kind: AiUsageKind, outcome: UsageOutcome & { sessionId?: string | null }): Promise<void>;
}

export function createQuotaService(env: Pick<Env, 'DB'>, clock: () => number = Date.now): AiQuotaService {
  const db = env.DB;

  async function subject(userId: string, now: number): Promise<Subject> {
    const row = await one<{ tz: string; minutes: number | null }>(
      db,
      `SELECT u.tz AS tz, COALESCE(
         (SELECT p.ai_minutes_month FROM user_plans up JOIN plans p ON p.id = up.plan_id
           WHERE up.user_id = u.id AND p.active = 1 AND (up.expires_at IS NULL OR up.expires_at > ?)),
         (SELECT p.ai_minutes_month FROM plans p WHERE p.is_default = 1 AND p.active = 1),
         0) AS minutes
       FROM users u WHERE u.id = ?`,
      now,
      userId,
    );
    if (!row) throw fail('unauthorized');
    return { tz: row.tz, limitS: Math.max(0, Math.floor(Number(row.minutes ?? 0))) * 60 };
  }

  function info(p: string, limitS: number, usedS: number): QuotaInfo {
    const used = Math.max(0, Math.floor(usedS));
    return { period: p, limitS, usedS: used, leftS: Math.max(0, limitS - used) };
  }

  async function used(userId: string, p: string): Promise<number> {
    const row = await one<{ s: number }>(
      db,
      'SELECT seconds_used AS s FROM ai_usage_monthly WHERE user_id = ? AND period = ?',
      userId,
      p,
    );
    return row?.s ?? 0;
  }

  async function writeEvent(
    userId: string,
    kind: string,
    seconds: number,
    ok: boolean,
    extra: { model?: string | null; sessionId?: string | null; latencyMs?: number | null },
    now: number,
  ): Promise<number | null> {
    const res = await run(
      db,
      `INSERT INTO ai_usage_events(user_id, kind, model, seconds, session_id, ok, latency_ms, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      userId,
      kind,
      extra.model ?? null,
      seconds,
      extra.sessionId ?? null,
      ok,
      extra.latencyMs ?? null,
      now,
    );
    return res.lastRowId;
  }

  async function finishEvent(eventId: number | null, outcome: UsageOutcome): Promise<void> {
    if (eventId === null) return;
    await run(
      db,
      'UPDATE ai_usage_events SET ok = ?, latency_ms = ?, model = COALESCE(?, model) WHERE id = ?',
      outcome.ok,
      outcome.latencyMs ?? null,
      outcome.model ?? null,
      eventId,
    );
  }

  return {
    async remaining(userId) {
      const now = clock();
      const s = await subject(userId, now);
      const p = period(now, s.tz);
      return info(p, s.limitS, await used(userId, p));
    },

    async reserve(userId, seconds, input) {
      const now = clock();
      const secs = Math.max(0, Math.ceil(seconds));
      const s = await subject(userId, now);
      const p = period(now, s.tz);
      // A zero-second reservation still needs a second left, so an exhausted quota always says no.
      const need = Math.max(secs, 1);
      // One round trip: ensure the month row, conditional UPDATE, the event (ok = whether that
      // UPDATE changed a row, via changes()), and the month total for the answer.
      const [, , ev, total] = await db.batch([
        db
          .prepare('INSERT OR IGNORE INTO ai_usage_monthly(user_id, period, seconds_used) VALUES(?, ?, 0)')
          .bind(userId, p),
        db
          .prepare(
            `UPDATE ai_usage_monthly SET seconds_used = seconds_used + ?
             WHERE user_id = ? AND period = ? AND seconds_used + ? <= ?`,
          )
          .bind(secs, userId, p, need, s.limitS),
        db
          .prepare(
            `INSERT INTO ai_usage_events(user_id, kind, model, seconds, session_id, ok, latency_ms, created_at)
             SELECT ?1, ?2, ?3, CASE WHEN r.ok THEN ?4 ELSE 0 END, ?5, r.ok, NULL, ?6
             FROM (SELECT changes() > 0 AS ok) r
             RETURNING id, ok`,
          )
          .bind(userId, input.kind, input.model ?? null, secs, input.sessionId ?? null, now),
        db.prepare('SELECT seconds_used AS s FROM ai_usage_monthly WHERE user_id = ? AND period = ?').bind(userId, p),
      ]);
      const event = (ev?.results?.[0] ?? null) as { id: number; ok: number } | null;
      const usedS = Number((total?.results?.[0] as { s?: number } | undefined)?.s ?? 0);
      const eventId = event?.id ?? null;
      if (event?.ok !== 1) return { ok: false, quota: info(p, s.limitS, usedS), eventId };
      return { ok: true, reservedS: secs, quota: info(p, s.limitS, usedS), eventId };
    },

    async refund(userId, r, outcome) {
      if (r.eventId === null) return;
      if (!r.ok || r.reservedS <= 0) {
        await finishEvent(r.eventId, { ...outcome, ok: false });
        return;
      }
      // Idempotent: the month is credited only while the event still carries its seconds.
      await db.batch([
        db
          .prepare(
            `UPDATE ai_usage_monthly SET seconds_used = MAX(0, seconds_used - ?1)
             WHERE user_id = ?2 AND period = ?3
               AND EXISTS(SELECT 1 FROM ai_usage_events WHERE id = ?4 AND user_id = ?2 AND seconds > 0)`,
          )
          .bind(r.reservedS, userId, r.quota.period, r.eventId),
        db
          .prepare(
            'UPDATE ai_usage_events SET seconds = 0, ok = 0, latency_ms = ?, model = COALESCE(?, model) WHERE id = ?',
          )
          .bind(outcome.latencyMs ?? null, outcome.model ?? null, r.eventId),
      ]);
    },

    finish: finishEvent,

    async log(userId, kind, outcome) {
      await writeEvent(userId, kind, 0, outcome.ok, outcome, clock());
    },
  };
}

/** Throws the 429 quota_exceeded envelope (the client then switches to demo mode). */
export async function reserveOrThrow(
  quota: AiQuotaService,
  userId: string,
  seconds: number,
  input: ReserveInput,
): Promise<ReserveResultWithEvent & { ok: true }> {
  const r = await quota.reserve(userId, seconds, input);
  if (!r.ok) throw fail('quota_exceeded', undefined, { quota: r.quota });
  return r as ReserveResultWithEvent & { ok: true };
}

/** Factory for createApp({services: {quota: quotaFactory}}) (integration step I1). */
export const quotaFactory: ServiceFactory<'quota'> = (env) => createQuotaService(env);

function isAiQuota(q: QuotaService): q is AiQuotaService {
  return typeof (q as Partial<AiQuotaService>).finish === 'function';
}

/** The registered quota service, or this slice's implementation while the registry still has the stub. */
export function quotaOf(env: Env, services: Services): AiQuotaService {
  const q = services.quota;
  if (q !== quotaServiceStub && isAiQuota(q)) return q;
  return createQuotaService(env);
}
