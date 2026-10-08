// S1 Auth & account: /api/auth/* (config, signup, login, logout, reset/consume, password). Spec 04 §3, §5.
// Mounted at '/' by worker/src/index.ts, so paths are absolute (appApi.*.path) and middleware is per route.
import { ApiError, type AuthConfig, type AuthRes, appApi, DEFAULT_TZ, LIMITS, newId, type Ok } from '@tie/shared';
import {
  type AppEnv,
  auditFor,
  authRateKey,
  batch,
  batchRun,
  CLAIMED_BY,
  checkRateLimit,
  clearMediaCookie,
  clearSessionCookie,
  clientIp,
  dummyVerify,
  failedLoginQuery,
  hashPassword,
  hashToken,
  issueMediaCookie,
  isTokenShape,
  isValidTimeZone,
  localDate,
  newClaim,
  newSession,
  one,
  type Query,
  q,
  readSessionCookie,
  requireUser,
  revokeSession,
  revokeUserSessionsQuery,
  sessionOf,
  setSessionCookie,
  verifyPassword,
  verifyTurnstile,
  vJson,
} from '@tie/worker-core';
import { type Context, Hono } from 'hono';
import { appSettingQuery, auditAs, checkBirth, requestIpHash, TERMS_SETTING, termsVersionOf } from '../account/common';

const routes = new Hono<AppEnv>();
const api = appApi.auth;

async function turnstileOrThrow(c: Context<AppEnv>, token: string, action: string): Promise<void> {
  const verdict = await verifyTurnstile(c.env, token, { ip: c.req.header('CF-Connecting-IP') ?? null, action });
  if (!verdict.ok) throw new ApiError('turnstile_failed', undefined, { reason: verdict.reason });
}

/** Hash of the session cookie this request already carries (replaced on login/signup). */
async function currentTokenHash(c: Context<AppEnv>): Promise<string | null> {
  const token = readSessionCookie(c, 'app');
  return isTokenShape(token) ? hashToken(token) : null;
}

function isUniqueEmailError(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed: users\.email/i.test(err.message);
}

routes.get(api.config.path, async (c) => {
  const [row] = await batch(c.env.DB, [appSettingQuery(c.env.DB, TERMS_SETTING)]);
  return c.json({
    turnstileSiteKey: c.env.TURNSTILE_SITEKEY ?? '',
    termsVersion: termsVersionOf(row?.[0]?.value),
    passwordMin: LIMITS.passwordMin,
  } satisfies AuthConfig);
});

routes.post(api.signup.path, vJson(api.signup.body), async (c) => {
  const body = c.req.valid('json');
  await checkRateLimit(c.env, 'RL_AUTH', authRateKey(c, body.email));
  await turnstileOrThrow(c, body.turnstileToken, 'signup');

  const db = c.env.DB;
  const now = Date.now();
  const tz = isValidTimeZone(body.tz) ? body.tz : DEFAULT_TZ;
  const ageBand = checkBirth(body.birth, localDate(now, tz));

  const [existing, terms] = await batch(db, [
    q<{ id: string }>(db, 'SELECT id FROM users WHERE email = ?', body.email),
    appSettingQuery(db, TERMS_SETTING),
  ]);
  if (existing.length) throw new ApiError('email_taken');
  const termsVersion = termsVersionOf(terms[0]?.value);
  if (body.termsVersion !== termsVersion) {
    throw new ApiError('validation_failed', 'Os termos foram atualizados. Recarregue a página.', {
      issues: [{ path: 'termsVersion', code: 'stale', message: `current: ${termsVersion}` }],
    });
  }

  const userId = newId(now);
  const passHash = await hashPassword(body.password);
  const session = await newSession(db, {
    userId,
    audience: 'app',
    ipHash: await requestIpHash(c),
    ua: c.req.header('User-Agent') ?? null,
    now,
  });
  const oldHash = await currentTokenHash(c);

  const stmts: Query<unknown>[] = [
    q(
      db,
      `INSERT INTO users(id, email, pass_hash, status, tz, failed_logins, terms_version, terms_accepted_at, created_at, last_login_at)
       VALUES(?, ?, ?, 'active', ?, 0, ?, ?, ?, ?)`,
      userId,
      body.email,
      passHash,
      tz,
      termsVersion,
      now,
      now,
      now,
    ),
    q(
      db,
      `INSERT INTO profiles(user_id, full_name, name, birth, age_band, onb_step, updated_at) VALUES(?, ?, ?, ?, ?, 2, ?)`,
      userId,
      body.fullName,
      body.name,
      body.birth,
      ageBand,
      now,
    ),
    q(db, 'INSERT INTO user_settings(user_id) VALUES(?)', userId),
    q(db, 'INSERT INTO user_stats(user_id) VALUES(?)', userId),
    q(
      db,
      `INSERT INTO user_plans(user_id, plan_id, assigned_by, assigned_at)
       SELECT ?, id, NULL, ? FROM plans WHERE is_default = 1 AND active = 1`,
      userId,
      now,
    ),
    session.insert,
    await auditAs(
      c,
      userId,
      { action: 'auth.signup', targetType: 'user', targetId: userId, diff: { tz, termsVersion } },
      now,
    ),
  ];
  if (oldHash) stmts.unshift(q(db, 'DELETE FROM sessions WHERE token_hash = ?', oldHash));
  try {
    await batchRun(db, stmts);
  } catch (err) {
    if (isUniqueEmailError(err)) throw new ApiError('email_taken');
    throw err;
  }

  setSessionCookie(c, 'app', session.token, session.expiresAt, now);
  await issueMediaCookie(c, userId, now);
  return c.json(
    { user: { id: userId, email: body.email, name: body.name, fullName: body.fullName } } satisfies AuthRes,
    201,
  );
});

interface LoginRow {
  id: string;
  email: string;
  pass_hash: string | null;
  status: string;
  failed_logins: number;
  locked_until: number | null;
  name: string | null;
  full_name: string | null;
}

routes.post(api.login.path, vJson(api.login.body), async (c) => {
  const body = c.req.valid('json');
  await checkRateLimit(c.env, 'RL_AUTH', authRateKey(c, body.email));
  await turnstileOrThrow(c, body.turnstileToken, 'login');

  const db = c.env.DB;
  const now = Date.now();
  const user = await one<LoginRow>(
    db,
    `SELECT u.id, u.email, u.pass_hash, u.status, u.failed_logins, u.locked_until, p.name, p.full_name
     FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.email = ?`,
    body.email,
  );

  // Unknown or deleted account: same PBKDF2 cost, the same failure-counter write round trip (it
  // matches no row) and the same generic error as a wrong password, so neither the answer nor the
  // timing tells whether the email exists.
  if (!user || user.status === 'deleted') {
    await dummyVerify(body.password);
    await batch(db, [failedLoginQuery(db, '', now)]);
    throw new ApiError('invalid_credentials');
  }
  // Known trade-off: 'account_locked' (423, "Muitas tentativas…") tells a locked account exists. Reaching
  // it takes 10 failures that RL_AUTH (ip+email) and Turnstile throttle, and the user needs to know why
  // a correct password is refused. The password is never checked while locked (no oracle).
  if (user.locked_until != null && user.locked_until > now) {
    await dummyVerify(body.password);
    throw new ApiError('account_locked');
  }

  const ok = await verifyPassword(body.password, user.pass_hash);
  if (!ok) {
    const [rows] = await batch(db, [failedLoginQuery(db, user.id, now)]);
    const after = rows[0];
    const locked = after?.locked_until != null && after.locked_until > now;
    // Only the request that crossed the threshold sees failed_logins reset to 0 (racers that land
    // while the lock is on bump it to 1, 2, …), so the lockout is audited exactly once.
    if (locked && after.failed_logins === 0) {
      await (await auditAs(c, null, { action: 'auth.lockout', targetType: 'user', targetId: user.id }, now)).stmt.run();
    }
    throw new ApiError(locked ? 'account_locked' : 'invalid_credentials');
  }
  if (user.status !== 'active') throw new ApiError('account_suspended');

  const session = await newSession(db, {
    userId: user.id,
    audience: 'app',
    ipHash: await requestIpHash(c),
    ua: c.req.header('User-Agent') ?? null,
    now,
  });
  const oldHash = await currentTokenHash(c);
  const stmts: Query<unknown>[] = [
    q(db, 'UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', now, user.id),
    session.insert,
    await auditAs(c, user.id, { action: 'auth.login', targetType: 'user', targetId: user.id }, now),
  ];
  if (oldHash) stmts.unshift(q(db, 'DELETE FROM sessions WHERE token_hash = ?', oldHash));
  await batchRun(db, stmts);

  setSessionCookie(c, 'app', session.token, session.expiresAt, now);
  await issueMediaCookie(c, user.id, now);
  return c.json({
    user: { id: user.id, email: user.email, name: user.name ?? '', fullName: user.full_name ?? '' },
  } satisfies AuthRes);
});

routes.post(api.logout.path, async (c) => {
  const hash = await currentTokenHash(c);
  if (hash) await revokeSession(c.env.DB, hash);
  clearSessionCookie(c, 'app');
  clearMediaCookie(c);
  return c.json({ ok: true } satisfies Ok);
});

routes.post(api.resetConsume.path, vJson(api.resetConsume.body), async (c) => {
  const body = c.req.valid('json');
  // Keyed by IP alone: a per-token key would give every guessed token its own bucket.
  await checkRateLimit(c.env, 'RL_AUTH', `ip:${clientIp(c)}|reset`);
  const tokenHash = await hashToken(body.token);
  await turnstileOrThrow(c, body.turnstileToken, 'reset');

  const db = c.env.DB;
  const now = Date.now();
  const row = await one<{ user_id: string | null; status: string | null }>(
    db,
    `SELECT t.user_id, u.status FROM one_time_tokens t LEFT JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.kind = 'reset' AND t.used_at IS NULL AND t.expires_at > ?`,
    tokenHash,
    now,
  );
  if (!row?.user_id || !row.status || row.status === 'deleted') throw new ApiError('token_invalid');
  const userId = row.user_id;
  const passHash = await hashPassword(body.password);

  // The first statement claims the token with a per-request nonce; the rest only apply if this
  // request's claim won (two consumers in the same millisecond cannot both win).
  const nonce = newClaim();
  const [claim] = await batchRun(db, [
    q(
      db,
      'UPDATE one_time_tokens SET used_at = ?, claim = ? WHERE token_hash = ? AND used_at IS NULL',
      now,
      nonce,
      tokenHash,
    ),
    q(
      db,
      `UPDATE users SET pass_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ? AND ${CLAIMED_BY}`,
      passHash,
      userId,
      tokenHash,
      nonce,
    ),
    q(db, `DELETE FROM sessions WHERE user_id = ? AND ${CLAIMED_BY}`, userId, tokenHash, nonce),
  ]);
  if (!claim?.changes) throw new ApiError('token_invalid');
  // Audited only by the request whose claim won (a racer that lost writes nothing).
  await (
    await auditAs(c, userId, { action: 'auth.reset_consume', targetType: 'user', targetId: userId }, now)
  ).stmt.run();
  return c.json({ ok: true } satisfies Ok);
});

routes.post(api.changePassword.path, requireUser(), vJson(api.changePassword.body), async (c) => {
  const s = sessionOf(c);
  const body = c.req.valid('json');
  await checkRateLimit(c.env, 'RL_AUTH', `u:${s.userId}`);

  const db = c.env.DB;
  const now = Date.now();
  const user = await one<{ pass_hash: string | null }>(db, 'SELECT pass_hash FROM users WHERE id = ?', s.userId);
  if (!(await verifyPassword(body.currentPassword, user?.pass_hash))) throw new ApiError('invalid_credentials');

  const passHash = await hashPassword(body.newPassword);
  const session = await newSession(db, {
    userId: s.userId,
    audience: 'app',
    ipHash: await requestIpHash(c),
    ua: c.req.header('User-Agent') ?? null,
    now,
  });
  // Every session of the user (app and admin) dies; this device continues on a fresh token.
  await batchRun(db, [
    q(db, 'UPDATE users SET pass_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', passHash, s.userId),
    revokeUserSessionsQuery(db, s.userId),
    session.insert,
    await auditFor(c, { action: 'auth.password_change', targetType: 'user', targetId: s.userId }, now),
  ]);
  setSessionCookie(c, 'app', session.token, session.expiresAt, now);
  return c.json({ ok: true } satisfies Ok);
});

export default routes;
