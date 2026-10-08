import { DURATIONS, type PlanInfo, ROLES, type Role, randomToken } from '@tie/shared';
import { sha256Hex } from '../bytes';
import { type Bind, batch, batchRun, fromJson, type Query, q, run } from '../db';
import type { Audience } from '../env';
import { MINUTE } from '../time';

// Session tokens are 32 random bytes (43 base64url chars) held only in the cookie; D1 stores the
// SHA-256 hex of the token, so a database leak does not hand out live sessions.

export interface SessionPolicy {
  /** Lifetime from creation (absolute) or from last activity (sliding). */
  ttlMs: number;
  sliding: boolean;
  /** Max inactivity before the session dies; null for none. */
  idleMs: number | null;
  /** Minimum gap between last_seen_at writes, to keep reads cheap. */
  touchEveryMs: number;
}

export const SESSION_POLICY: Record<Audience, SessionPolicy> = {
  app: { ttlMs: DURATIONS.appSessionMs, sliding: true, idleMs: null, touchEveryMs: 60 * MINUTE },
  admin: {
    ttlMs: DURATIONS.adminSessionAbsoluteMs,
    sliding: false,
    idleMs: DURATIONS.adminSessionIdleMs,
    touchEveryMs: MINUTE,
  },
};

export interface SessionInfo {
  tokenHash: string;
  audience: Audience;
  userId: string;
  email: string;
  name: string;
  fullName: string;
  tz: string;
  roles: Role[];
  /** Assigned (unexpired, active) plan, else the active default plan, else null. */
  plan: PlanInfo | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

export type LookupResult =
  | { ok: true; session: SessionInfo; touched: boolean }
  | { ok: false; reason: 'missing' | 'expired' | 'suspended' };

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isTokenShape(token: string | null | undefined): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

export function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

export function newToken(): string {
  return randomToken(32);
}

export interface NewSessionInput {
  userId: string;
  audience: Audience;
  ipHash?: string | null;
  ua?: string | null;
  now?: number;
}

export interface NewSession {
  token: string;
  tokenHash: string;
  expiresAt: number;
  /** INSERT to run alone or inside a larger batch. */
  insert: Query<never>;
}

/** Builds a session without writing it, so callers can batch the insert with other writes. */
export async function newSession(db: D1Database, input: NewSessionInput): Promise<NewSession> {
  const now = input.now ?? Date.now();
  const token = newToken();
  const tokenHash = await hashToken(token);
  const expiresAt = now + SESSION_POLICY[input.audience].ttlMs;
  const insert = q<never>(
    db,
    `INSERT INTO sessions(token_hash, user_id, audience, created_at, last_seen_at, expires_at, ip_hash, ua)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    tokenHash,
    input.userId,
    input.audience,
    now,
    now,
    expiresAt,
    input.ipHash ?? null,
    input.ua ? input.ua.slice(0, 256) : null,
  );
  return { token, tokenHash, expiresAt, insert };
}

export async function createSession(db: D1Database, input: NewSessionInput): Promise<Omit<NewSession, 'insert'>> {
  const { insert, ...s } = await newSession(db, input);
  await batchRun(db, [insert]);
  return s;
}

/** Replaces a session with a fresh token (login on top of an old cookie, password change). */
export async function rotateSession(
  db: D1Database,
  oldTokenHash: string | null,
  input: NewSessionInput,
): Promise<Omit<NewSession, 'insert'>> {
  const { insert, ...s } = await newSession(db, input);
  const stmts: Query<unknown>[] = [insert];
  if (oldTokenHash) stmts.unshift(q(db, 'DELETE FROM sessions WHERE token_hash = ?', oldTokenHash));
  await batchRun(db, stmts);
  return s;
}

export async function revokeSession(db: D1Database, tokenHash: string): Promise<void> {
  await run(db, 'DELETE FROM sessions WHERE token_hash = ?', tokenHash);
}

/** Revokes every session of a user, optionally only one audience and/or keeping one token. */
export function revokeUserSessionsQuery(
  db: D1Database,
  userId: string,
  opts: { audience?: Audience; exceptTokenHash?: string } = {},
): Query<never> {
  let sql = 'DELETE FROM sessions WHERE user_id = ?';
  const params: Bind[] = [userId];
  if (opts.audience) {
    sql += ' AND audience = ?';
    params.push(opts.audience);
  }
  if (opts.exceptTokenHash) {
    sql += ' AND token_hash <> ?';
    params.push(opts.exceptTokenHash);
  }
  return q<never>(db, sql, ...params);
}

export async function revokeUserSessions(
  db: D1Database,
  userId: string,
  opts: { audience?: Audience; exceptTokenHash?: string } = {},
): Promise<number> {
  const [res] = await batchRun(db, [revokeUserSessionsQuery(db, userId, opts)]);
  return res?.changes ?? 0;
}

interface SessionRow {
  user_id: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  email: string;
  status: string;
  tz: string;
  name: string | null;
  full_name: string | null;
}

interface PlanRow {
  id: string;
  slug: string;
  name: string;
  ai_minutes_month: number;
  features: string;
}

/** Pure expiry rule, exported for tests. */
export function isExpired(audience: Audience, row: { expires_at: number; last_seen_at: number }, now: number): boolean {
  const policy = SESSION_POLICY[audience];
  if (row.expires_at <= now) return true;
  return policy.idleMs !== null && row.last_seen_at + policy.idleMs <= now;
}

/**
 * Resolves a cookie token to a session in one D1 round trip (session + user + profile, roles, plan).
 * Expired sessions are deleted; sliding app sessions are extended at most once per touch interval.
 */
export async function lookupSession(
  db: D1Database,
  token: string | null | undefined,
  audience: Audience,
  now: number = Date.now(),
): Promise<LookupResult> {
  if (!isTokenShape(token)) return { ok: false, reason: 'missing' };
  const tokenHash = await hashToken(token);

  const [sessions, roles, plans] = await batch(db, [
    q<SessionRow>(
      db,
      `SELECT s.user_id, s.created_at, s.last_seen_at, s.expires_at, u.email, u.status, u.tz, p.name, p.full_name
       FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN profiles p ON p.user_id = s.user_id
       WHERE s.token_hash = ?1 AND s.audience = ?2`,
      tokenHash,
      audience,
    ),
    q<{ role: string }>(
      db,
      'SELECT r.role FROM user_roles r JOIN sessions s ON s.user_id = r.user_id WHERE s.token_hash = ?1',
      tokenHash,
    ),
    q<PlanRow>(
      db,
      `SELECT pl.id, pl.slug, pl.name, pl.ai_minutes_month, pl.features FROM plans pl
       WHERE pl.id = COALESCE(
         (SELECT up.plan_id FROM user_plans up JOIN sessions s ON s.user_id = up.user_id
          JOIN plans ap ON ap.id = up.plan_id AND ap.active = 1
          WHERE s.token_hash = ?1 AND (up.expires_at IS NULL OR up.expires_at > ?2)),
         (SELECT id FROM plans WHERE is_default = 1 AND active = 1))`,
      tokenHash,
      now,
    ),
  ]);

  const row = sessions[0];
  if (!row) return { ok: false, reason: 'missing' };
  if (row.status === 'deleted') {
    await revokeSession(db, tokenHash);
    return { ok: false, reason: 'missing' };
  }
  if (row.status !== 'active') return { ok: false, reason: 'suspended' };
  if (isExpired(audience, row, now)) {
    await revokeSession(db, tokenHash);
    return { ok: false, reason: 'expired' };
  }

  const policy = SESSION_POLICY[audience];
  let { last_seen_at: lastSeenAt, expires_at: expiresAt } = row;
  const touched = now - lastSeenAt >= policy.touchEveryMs;
  if (touched) {
    lastSeenAt = now;
    if (policy.sliding) expiresAt = now + policy.ttlMs;
    await run(
      db,
      'UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?',
      lastSeenAt,
      expiresAt,
      tokenHash,
    );
  }

  const plan = plans[0];
  return {
    ok: true,
    touched,
    session: {
      tokenHash,
      audience,
      userId: row.user_id,
      email: row.email,
      name: row.name ?? '',
      fullName: row.full_name ?? '',
      tz: row.tz,
      roles: roles.map((r) => r.role).filter((r): r is Role => (ROLES as readonly string[]).includes(r)),
      plan: plan
        ? {
            id: plan.id,
            slug: plan.slug,
            name: plan.name,
            aiMinutesMonth: plan.ai_minutes_month,
            features: fromJson<Record<string, unknown>>(plan.features, {}),
          }
        : null,
      createdAt: row.created_at,
      lastSeenAt,
      expiresAt,
    },
  };
}

/** Deletes expired and idle-timed-out sessions (retention cron). */
export async function purgeExpiredSessions(db: D1Database, now: number = Date.now()): Promise<number> {
  const res = await run(
    db,
    "DELETE FROM sessions WHERE expires_at <= ? OR (audience = 'admin' AND last_seen_at <= ?)",
    now,
    now - (SESSION_POLICY.admin.idleMs ?? 0),
  );
  return res.changes;
}
