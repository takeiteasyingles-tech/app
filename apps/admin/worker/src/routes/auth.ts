// /admin-api/auth/*: staff login (Turnstile + PBKDF2 + lockout), logout, me, invite info/accept and
// the staff password change. The session cookie is __Host-tie_adm: 8h absolute, 30 min idle
// (worker-core SESSION_POLICY.admin); sessions are rotated on login, invite accept and password change.
import {
  ApiError,
  adminAccountApi,
  adminApi,
  canGrantRole,
  DEFAULT_TZ,
  DURATIONS,
  LOCKOUT_FAILED_LOGINS,
  newId,
  type Ok,
  primaryRole,
  ROLES,
  type Role,
  Role as RoleSchema,
} from '@tie/shared';
import {
  type AppEnv,
  authRateKey,
  type Bind,
  batch,
  batchRun,
  checkRateLimit,
  clearSessionCookie,
  clientIp,
  dummyVerify,
  hashIp,
  hashPassword,
  hashToken,
  isTokenShape,
  newSession,
  one,
  type Query,
  q,
  readSessionCookie,
  revokeSession,
  revokeUserSessionsQuery,
  setSessionCookie,
  verifyPassword,
  verifyTurnstile,
} from '@tie/worker-core';
import { Hono } from 'hono';
import { actor, auditAs, auditIf, auditStmt, bodyOf, type Ctx, isConstraint, paramsOf, route } from '../lib/http';
import { authRes, canManage, loadRoles, rolesFromCsv } from '../lib/staff';

const routes = new Hono<AppEnv>();
const api = adminApi.auth;

/** Turnstile widget actions the admin SPA renders. */
export const TURNSTILE_ACTIONS = { login: 'login', invite: 'invite' } as const;

async function turnstileOrThrow(c: Ctx, token: string, action: string): Promise<void> {
  const verdict = await verifyTurnstile(c.env, token, { ip: c.req.header('CF-Connecting-IP') ?? null, action });
  if (!verdict.ok) throw new ApiError('turnstile_failed', undefined, { reason: verdict.reason });
}

async function currentTokenHash(c: Ctx): Promise<string | null> {
  const token = readSessionCookie(c, 'admin');
  return isTokenShape(token) ? hashToken(token) : null;
}

const ipHashOf = (c: Ctx) => hashIp(clientIp(c), c.env.IP_HASH_SALT);

/** Same atomic failure counter as the student login (10 failures → 15 min lock). */
function failedLoginQuery(db: D1Database, userId: string, now: number): Query<FailRow> {
  const next = '(CASE WHEN locked_until IS NULL THEN failed_logins ELSE 0 END) + 1';
  return q<FailRow>(
    db,
    `UPDATE users SET
       failed_logins = CASE WHEN locked_until > ?1 THEN failed_logins + 1 WHEN ${next} >= ?3 THEN 0 ELSE ${next} END,
       locked_until = CASE WHEN locked_until > ?1 THEN locked_until WHEN ${next} >= ?3 THEN ?2 ELSE NULL END
     WHERE id = ?4
     RETURNING failed_logins, locked_until`,
    now,
    now + DURATIONS.lockoutMs,
    LOCKOUT_FAILED_LOGINS,
    userId,
  );
}

interface FailRow {
  failed_logins: number;
  locked_until: number | null;
}

interface LoginRow {
  id: string;
  email: string;
  pass_hash: string | null;
  status: string;
  locked_until: number | null;
  roles: string | null;
}

// ---------- Login / logout / me ----------

route(routes, api.login, async (c) => {
  const body = await bodyOf(c, api.login.body);
  await checkRateLimit(c.env, 'RL_AUTH', `adm|${authRateKey(c, body.email)}`);
  await turnstileOrThrow(c, body.turnstileToken, TURNSTILE_ACTIONS.login);

  const db = c.env.DB;
  const now = Date.now();
  const user = await one<LoginRow>(
    db,
    `SELECT u.id, u.email, u.pass_hash, u.status, u.locked_until,
       (SELECT group_concat(role) FROM user_roles r WHERE r.user_id = u.id) AS roles
     FROM users u WHERE u.email = ?`,
    body.email,
  );

  // Unknown, deleted or password-less (invited, not accepted) account: same cost and answer as a
  // wrong password, so neither the response nor its timing tells which emails exist.
  if (!user || user.status === 'deleted' || !user.pass_hash) {
    await dummyVerify(body.password);
    await batch(db, [failedLoginQuery(db, '', now)]);
    throw new ApiError('invalid_credentials');
  }
  if (user.locked_until != null && user.locked_until > now) {
    await dummyVerify(body.password);
    throw new ApiError('account_locked');
  }
  if (!(await verifyPassword(body.password, user.pass_hash))) {
    const [rows] = await batch(db, [failedLoginQuery(db, user.id, now)]);
    const after = rows[0];
    const locked = after?.locked_until != null && after.locked_until > now;
    if (locked && after.failed_logins === 0) {
      await (
        await auditAs(c, null, null, { action: 'admin.auth.lockout', targetType: 'user', targetId: user.id }, now)
      ).stmt.run();
    }
    throw new ApiError(locked ? 'account_locked' : 'invalid_credentials');
  }
  if (user.status !== 'active') throw new ApiError('account_suspended');
  const roles = rolesFromCsv(user.roles);
  if (roles.length === 0) {
    // A learner with the right password: refused like a wrong one (the admin panel stays invisible),
    // without counting a failure against their account.
    await (
      await auditAs(c, user.id, null, { action: 'admin.auth.login_denied', targetType: 'user', targetId: user.id }, now)
    ).stmt.run();
    throw new ApiError('invalid_credentials');
  }

  const session = await newSession(db, {
    userId: user.id,
    audience: 'admin',
    ipHash: await ipHashOf(c),
    ua: c.req.header('User-Agent') ?? null,
    now,
  });
  const oldHash = await currentTokenHash(c);
  const stmts: Query<unknown>[] = [
    q(db, 'UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', now, user.id),
    session.insert,
    await auditAs(
      c,
      user.id,
      primaryRole(roles),
      { action: 'admin.auth.login', targetType: 'user', targetId: user.id },
      now,
    ),
  ];
  if (oldHash) stmts.unshift(q(db, 'DELETE FROM sessions WHERE token_hash = ?', oldHash));
  await batchRun(db, stmts);
  setSessionCookie(c, 'admin', session.token, session.expiresAt, now);
  return c.json(authRes(user, roles));
});

route(routes, api.logout, async (c) => {
  const hash = await currentTokenHash(c);
  if (hash) await revokeSession(c.env.DB, hash);
  clearSessionCookie(c, 'admin');
  return c.json({ ok: true } satisfies Ok);
});

route(routes, api.me, async (c) => {
  const s = actor(c);
  return c.json(authRes({ id: s.userId, email: s.email }, s.roles));
});

route(routes, adminAccountApi.password, async (c) => {
  const s = actor(c);
  const body = await bodyOf(c, adminAccountApi.password.body);
  const db = c.env.DB;
  const now = Date.now();
  const user = await one<{ pass_hash: string | null }>(db, 'SELECT pass_hash FROM users WHERE id = ?', s.userId);
  if (!(await verifyPassword(body.currentPassword, user?.pass_hash))) throw new ApiError('invalid_credentials');
  const passHash = await hashPassword(body.newPassword);
  const session = await newSession(db, {
    userId: s.userId,
    audience: 'admin',
    ipHash: await ipHashOf(c),
    ua: c.req.header('User-Agent') ?? null,
    now,
  });
  // Every session of the account (app and admin) dies; this device continues on a fresh token.
  await batchRun(db, [
    q(db, 'UPDATE users SET pass_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', passHash, s.userId),
    revokeUserSessionsQuery(db, s.userId),
    session.insert,
    await auditStmt(c, { action: 'admin.auth.password_change', targetType: 'user', targetId: s.userId }, now),
  ]);
  setSessionCookie(c, 'admin', session.token, session.expiresAt, now);
  return c.json({ ok: true } satisfies Ok);
});

// ---------- Invites ----------

interface InviteRow {
  token_hash: string;
  user_id: string | null;
  email: string | null;
  role: string | null;
  created_by: string | null;
  expires_at: number;
  user_email: string | null;
  user_status: string | null;
  user_id_by_email: string | null;
  status_by_email: string | null;
  creator_roles: string | null;
  creator_status: string | null;
  /** Roles the target account holds now (null when it does not exist yet or holds none). */
  target_roles: string | null;
  /** 1 when the target account already has a password of its own. */
  target_has_pass: number | null;
}

/** A live (unused, unexpired) admin_invite with the account it targets. */
async function liveInvite(db: D1Database, tokenHash: string, now: number): Promise<InviteRow | null> {
  return one<InviteRow>(
    db,
    `SELECT t.token_hash, t.user_id, t.email, t.role, t.created_by, t.expires_at,
       u.email AS user_email, u.status AS user_status,
       ue.id AS user_id_by_email, ue.status AS status_by_email,
       (SELECT group_concat(role) FROM user_roles r WHERE r.user_id = t.created_by) AS creator_roles,
       (SELECT status FROM users cu WHERE cu.id = t.created_by) AS creator_status,
       (SELECT group_concat(role) FROM user_roles r WHERE r.user_id = COALESCE(t.user_id, ue.id)) AS target_roles,
       (SELECT x.pass_hash IS NOT NULL FROM users x WHERE x.id = COALESCE(t.user_id, ue.id)) AS target_has_pass
     FROM one_time_tokens t
     LEFT JOIN users u ON u.id = t.user_id
     LEFT JOIN users ue ON t.user_id IS NULL AND ue.email = t.email
     WHERE t.token_hash = ? AND t.kind = 'admin_invite' AND t.used_at IS NULL AND t.expires_at > ?`,
    tokenHash,
    now,
  );
}

interface ResolvedInvite {
  email: string;
  role: Role;
  /** Existing account, or null when accepting creates it. */
  userId: string | null;
  createdBy: string | null;
  /** Roles the target may hold when the token is claimed (null: no limit, the bootstrap invite). */
  allowedTargetRoles: Role[] | null;
  /** Roles the target holds now (none for a new account). */
  targetRoles: Role[];
  expiresAt: number;
}

/**
 * Validates a live invite: a real role, an active (or not yet existing) target account that has no
 * password of its own, and a creator who is still active and still may grant the role AND manage
 * every role the target holds now (an invite dies with its creator's authority, and a target
 * promoted after the invite was made is out of its reach).
 */
function resolveInvite(row: InviteRow | null): ResolvedInvite {
  if (!row) throw new ApiError('token_invalid');
  const role = RoleSchema.safeParse(row.role);
  if (!role.success) throw new ApiError('token_invalid');
  const userId = row.user_id ?? row.user_id_by_email;
  const status = row.user_id ? row.user_status : row.status_by_email;
  const email = row.user_email ?? row.email;
  if (!email || (userId && status !== 'active')) throw new ApiError('token_invalid');
  // Accepting sets the password and signs in, so it never claims an account that has its own
  // password (e.g. a learner who signed up with the invited email after the invite was made).
  if (userId && row.target_has_pass) throw new ApiError('token_invalid');
  let allowedTargetRoles: Role[] | null = null;
  if (row.created_by) {
    const creatorRoles = rolesFromCsv(row.creator_roles);
    if (row.creator_status !== 'active') throw new ApiError('token_invalid');
    if (!canGrantRole(creatorRoles, role.data)) throw new ApiError('token_invalid');
    if (!canManage(creatorRoles, rolesFromCsv(row.target_roles))) throw new ApiError('token_invalid');
    allowedTargetRoles = ROLES.filter((r) => canGrantRole(creatorRoles, r));
  } else if (role.data !== 'super_admin' || !row.user_id) {
    // Only the bootstrap script issues creator-less invites, and only for the super_admin account.
    throw new ApiError('token_invalid');
  }
  return {
    email,
    role: role.data,
    userId,
    createdBy: row.created_by,
    allowedTargetRoles,
    targetRoles: userId ? rolesFromCsv(row.target_roles) : [],
    expiresAt: row.expires_at,
  };
}

route(routes, api.inviteInfo, async (c) => {
  await checkRateLimit(c.env, 'RL_AUTH', `adm-invite|ip:${clientIp(c)}`);
  const { token } = paramsOf(c, api.inviteInfo.params);
  const inv = resolveInvite(await liveInvite(c.env.DB, await hashToken(token), Date.now()));
  return c.json({ email: inv.email, role: inv.role, expiresAt: inv.expiresAt });
});

route(routes, api.inviteAccept, async (c) => {
  const body = await bodyOf(c, api.inviteAccept.body);
  // Keyed by IP alone: a per-token key would give every guessed token its own bucket.
  await checkRateLimit(c.env, 'RL_AUTH', `adm-invite|ip:${clientIp(c)}`);
  const tokenHash = await hashToken(body.token);
  await turnstileOrThrow(c, body.turnstileToken, TURNSTILE_ACTIONS.invite);

  const db = c.env.DB;
  const now = Date.now();
  const inv = resolveInvite(await liveInvite(db, tokenHash, now));
  const userId = inv.userId ?? newId(now);
  const passHash = await hashPassword(body.password);
  const session = await newSession(db, {
    userId,
    audience: 'admin',
    ipHash: await ipHashOf(c),
    ua: c.req.header('User-Agent') ?? null,
    now,
  });

  // The first statement claims the token; every later one applies only if this request's claim won.
  // The claim re-checks the target in SQL, so a change since the lookup (the email registered, a
  // password set, a role the creator cannot manage granted) voids it instead of being overwritten.
  const claimed = '(SELECT used_at FROM one_time_tokens WHERE token_hash = ?) = ?';
  const targetOk: string[] = [];
  const targetBinds: Bind[] = [];
  if (inv.userId) {
    targetOk.push("EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'active' AND pass_hash IS NULL)");
    targetBinds.push(inv.userId);
    if (inv.allowedTargetRoles) {
      targetOk.push(
        `NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = ? AND role NOT IN (${inv.allowedTargetRoles.map(() => '?').join(', ')}))`,
      );
      targetBinds.push(inv.userId, ...inv.allowedTargetRoles);
    }
  } else {
    targetOk.push('NOT EXISTS (SELECT 1 FROM users WHERE email = ?)');
    targetBinds.push(inv.email);
  }
  const stmts: Query<unknown>[] = [
    q(
      db,
      `UPDATE one_time_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND ${targetOk.join(' AND ')}`,
      now,
      tokenHash,
      ...targetBinds,
    ),
  ];
  if (!inv.userId) {
    stmts.push(
      q(
        db,
        `INSERT INTO users(id, email, pass_hash, status, tz, failed_logins, created_at)
         SELECT ?, ?, ?, 'active', ?, 0, ? WHERE ${claimed}`,
        userId,
        inv.email,
        passHash,
        DEFAULT_TZ,
        now,
        tokenHash,
        now,
      ),
    );
  }
  stmts.push(
    q(
      db,
      `UPDATE users SET pass_hash = ?, failed_logins = 0, locked_until = NULL, last_login_at = ?
       WHERE id = ? AND status = 'active' ${inv.userId ? 'AND pass_hash IS NULL' : ''} AND ${claimed}`,
      passHash,
      now,
      userId,
      tokenHash,
      now,
    ),
    q(
      db,
      `INSERT INTO user_roles(user_id, role, granted_by, granted_at) SELECT ?, ?, ?, ? WHERE ${claimed}
       ON CONFLICT(user_id, role) DO NOTHING`,
      userId,
      inv.role,
      inv.createdBy,
      now,
      tokenHash,
      now,
    ),
    // A password was just set: older sessions of the account (app and admin) end here.
    q(db, `DELETE FROM sessions WHERE user_id = ? AND ${claimed}`, userId, tokenHash, now),
    q(
      db,
      `INSERT INTO sessions(token_hash, user_id, audience, created_at, last_seen_at, expires_at, ip_hash, ua)
       SELECT ?, ?, 'admin', ?, ?, ?, ?, ? WHERE ${claimed}`,
      session.tokenHash,
      userId,
      now,
      now,
      session.expiresAt,
      await ipHashOf(c),
      (c.req.header('User-Agent') ?? '').slice(0, 256) || null,
      tokenHash,
      now,
    ),
    // In the same batch as the claim it records: no committed account or role without its audit row.
    await auditIf(
      c,
      {
        action: 'admin.auth.invite_accept',
        targetType: 'user',
        targetId: userId,
        diff: { role: inv.role, invitedBy: inv.createdBy, newAccount: !inv.userId },
      },
      now,
      claimed,
      [tokenHash, now],
      { userId, role: primaryRole([...new Set<Role>([...inv.targetRoles, inv.role])]) },
    ),
  );
  let results: { changes: number }[];
  try {
    results = await batchRun(db, stmts);
  } catch (err) {
    // Someone registered the invited email between the lookup and this batch.
    if (isConstraint(err, 'UNIQUE')) throw new ApiError('token_invalid');
    throw err;
  }
  if (!results[0]?.changes) throw new ApiError('token_invalid');

  const roles = await loadRoles(db, userId);
  setSessionCookie(c, 'admin', session.token, session.expiresAt, now);
  return c.json(authRes({ id: userId, email: inv.email }, roles));
});

export default routes;
