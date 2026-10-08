// Small helpers shared by the auth, me and uploads routes.
import { ApiError, DEFAULT_TERMS_VERSION, FLAGS, type PlanInfo, type QuotaInfo, SETTINGS } from '@tie/shared';
import {
  type AppEnv,
  type AuditEntry,
  auditQuery,
  clientIp,
  evaluateFlag,
  type Flag,
  type FlagRules,
  type FlagSubject,
  fromJson,
  hashIp,
  type Query,
  q,
  type SessionInfo,
} from '@tie/worker-core';
import type { Context } from 'hono';

/** Feature flags the client reads (TieState.flags); server-only flags stay out of the payload. */
export const CLIENT_FLAGS: readonly string[] = [FLAGS.freeSteps];

/** Age in whole years on `today` (YYYY-MM-DD) for a YYYY-MM-DD birth date; null when malformed. */
export function ageOn(birth: string, today: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth);
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!m || !t) return null;
  const [by, bm, bd] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (bm < 1 || bm > 12 || bd < 1 || bd > 31) return null;
  const [ty, tm, td] = [Number(t[1]), Number(t[2]), Number(t[3])];
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return age;
}

/** Prototype ageBand (cadastro.js). */
export function ageBand(age: number | null): string {
  if (age == null) return '';
  if (age < 18) return '-18';
  if (age < 25) return '18-24';
  if (age < 35) return '25-34';
  if (age < 45) return '35-44';
  if (age < 60) return '45-59';
  return '60+';
}

export const AGE_MIN = 5;
export const AGE_MAX = 110;

/** Validates the onboarding age rule (5..110); returns the age band. */
export function checkBirth(birth: string, today: string): string {
  const age = ageOn(birth, today);
  if (age === null || age < AGE_MIN || age > AGE_MAX) {
    throw new ApiError('validation_failed', 'Confira a data de nascimento.', {
      issues: [{ path: 'birth', code: 'out_of_range', message: `Idade entre ${AGE_MIN} e ${AGE_MAX} anos.` }],
    });
  }
  return ageBand(age);
}

/** Salted hash of the client IP (sessions.ip_hash, audit_log.ip_hash). */
export function requestIpHash(c: Context<AppEnv>): Promise<string> {
  return hashIp(clientIp(c), c.env.IP_HASH_SALT);
}

/**
 * Audit row with an explicit actor, for routes where the actor is not (yet) the session user:
 * signup, login, reset. Logged-in routes use worker-core auditFor().
 */
export async function auditAs(
  c: Context<AppEnv>,
  actorUserId: string | null,
  entry: AuditEntry,
  now: number,
): Promise<Query<never>> {
  return auditQuery(c.env.DB, {
    ...entry,
    at: now,
    actorUserId,
    actorRole: null,
    ipHash: await requestIpHash(c),
    ua: c.req.header('User-Agent') ?? null,
  });
}

export interface FlagRow {
  key: string;
  enabled: number;
  rollout_pct: number;
  rules: string | null;
}

export const flagRowsQuery = (db: D1Database): Query<FlagRow> =>
  q<FlagRow>(db, 'SELECT key, enabled, rollout_pct, rules FROM feature_flags');

export function flagSubject(s: SessionInfo): FlagSubject {
  return { userId: s.userId, planSlug: s.plan?.slug ?? null, roles: s.roles };
}

/** Evaluates flags from rows fetched inside a batch (no extra round trip, no isolate cache). */
export function evaluateRows(
  rows: readonly FlagRow[],
  subject: FlagSubject,
  keys: readonly string[],
): Record<string, boolean> {
  const byKey = new Map<string, Flag>(
    rows.map((r) => [
      r.key,
      {
        key: r.key,
        enabled: r.enabled === 1,
        rolloutPct: r.rollout_pct,
        rules: fromJson<FlagRules | null>(r.rules, null),
      },
    ]),
  );
  const out: Record<string, boolean> = {};
  for (const k of keys) out[k] = evaluateFlag(byKey.get(k), subject);
  return out;
}

export const flagQuery = (db: D1Database, key: string): Query<FlagRow> =>
  q<FlagRow>(db, 'SELECT key, enabled, rollout_pct, rules FROM feature_flags WHERE key = ?', key);

export const appSettingQuery = (db: D1Database, key: string): Query<{ value: string }> =>
  q<{ value: string }>(db, 'SELECT value FROM app_settings WHERE key = ?', key);

/** app_settings values are JSON or bare strings; both read as a string. */
export function settingString(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const v = fromJson<unknown>(raw, raw);
  if (typeof v === 'string') return v.trim() || null;
  if (v && typeof v === 'object' && typeof (v as { version?: unknown }).version === 'string') {
    return (v as { version: string }).version;
  }
  return typeof raw === 'string' ? raw.trim() || null : null;
}

export const termsVersionOf = (raw: string | null | undefined): string => settingString(raw) ?? DEFAULT_TERMS_VERSION;
export const TERMS_SETTING = SETTINGS.termsVersion;

/** Monthly quota numbers from the plan limit and ai_usage_monthly.seconds_used. */
export function quotaInfo(plan: PlanInfo | null, usedS: number, period: string): QuotaInfo {
  const limitS = Math.max(0, Math.floor((plan?.aiMinutesMonth ?? 0) * 60));
  const used = Math.max(0, Math.floor(usedS));
  return { period, limitS, usedS: used, leftS: Math.max(0, limitS - used) };
}
