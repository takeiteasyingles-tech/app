// /admin-api/users*, /admin-api/invites and /admin-api/mic-sessions* (spec 04 §3 admin table).
// Moderators read and suspend; admins delete, assign plans, issue reset links, reset progress and
// grant editor/moderator; only the super_admin grants admin. Account actions, role changes and invites
// on a staff member need authority over all of their roles (lib/staff canManage), and nobody acts on
// their own account here (except resetting their own learner progress). An invite never names an
// account that already has a password: such a person gets the role directly (grantRole).
import {
  type AdminMicSessionRow,
  type AdminMicTurn,
  type AdminUserRow,
  ApiError,
  adminApi,
  Bilingual,
  canGrantRole,
  DEFAULT_TZ,
  DURATIONS,
  Feedback,
  MicMode,
  mediaUrl,
  type Ok,
  PronTip,
  type Role,
  randomToken,
  type UserDetail,
} from '@tie/shared';
import {
  type AppEnv,
  all,
  type Bind,
  batch,
  batchRun,
  hashToken,
  one,
  period,
  type Query,
  q,
  revokeUserSessionsQuery,
  safeTimeZone,
} from '@tie/worker-core';
import { Hono } from 'hono';
import { z } from 'zod';
import { actor, auditStmt, bodyOf, type Ctx, likeEscape, paramsOf, queryOf, route } from '../lib/http';
import { adminOrigin, inviteUrl, resetUrl, studentOrigin } from '../lib/origin';
import { decodeCursor, pageOf } from '../lib/page';
import { PLAN_COLS, type PlanRowDb, parsedOrNull, planFromRow, reportOrNull } from '../lib/rows';
import { canManage, loadRoles, rolesFromCsv } from '../lib/staff';
import { deleteAccountQueries, purgeUserObjects, resetProgressQueries } from '../lib/userData';

const routes = new Hono<AppEnv>();
const api = adminApi.users;

const forbiddenSelf = () => new ApiError('forbidden', 'Use a sua própria conta pelo perfil, não pelo painel.');

/** Effective plan slug of `u.id`: the assigned plan while active and unexpired, else the default. */
const PLAN_SLUG_SQL = `COALESCE(
  (SELECT ap.slug FROM user_plans up JOIN plans ap ON ap.id = up.plan_id AND ap.active = 1
   WHERE up.user_id = u.id AND (up.expires_at IS NULL OR up.expires_at > ?1)),
  (SELECT slug FROM plans WHERE is_default = 1 AND active = 1))`;

interface Target {
  id: string;
  email: string;
  status: 'active' | 'suspended' | 'deleted';
  roles: Role[];
}

/** The user an admin action targets (404 when missing); refuses the actor's own account. */
async function target(c: Ctx, id: string, opts: { allowSelf?: boolean } = {}): Promise<Target> {
  const row = await one<{ id: string; email: string; status: Target['status']; roles: string | null }>(
    c.env.DB,
    `SELECT u.id, u.email, u.status, (SELECT group_concat(role) FROM user_roles r WHERE r.user_id = u.id) AS roles
     FROM users u WHERE u.id = ?`,
    id,
  );
  if (!row || row.status === 'deleted') throw new ApiError('not_found');
  if (!opts.allowSelf && row.id === actor(c).userId) throw forbiddenSelf();
  return { id: row.id, email: row.email, status: row.status, roles: rolesFromCsv(row.roles) };
}

/** Account actions (and role changes) on a staff member need authority over every role they hold. */
function assertManage(c: Ctx, targetRoles: readonly Role[]): void {
  if (!canManage(actor(c).roles, targetRoles)) {
    throw new ApiError('forbidden', 'Só quem pode conceder todos os papéis desta conta pode fazer isso.');
  }
}

// ---------- List and detail ----------

interface ListRow {
  id: string;
  email: string;
  status: AdminUserRow['status'];
  created_at: number;
  last_login_at: number | null;
  name: string | null;
  roles: string | null;
  plan_slug: string | null;
  points: number;
}

route(routes, api.list, async (c) => {
  const query = queryOf(c, api.list.query);
  const now = Date.now();
  const binds: Bind[] = [now];
  const p = (v: Bind) => {
    binds.push(v);
    return `?${binds.length}`;
  };
  const where: string[] = [];
  if (query.q) {
    const like = p(`%${likeEscape(query.q)}%`);
    where.push(
      `(x.email LIKE ${like} ESCAPE '\\' OR x.name LIKE ${like} ESCAPE '\\' OR x.full_name LIKE ${like} ESCAPE '\\' OR x.id = ${p(query.q)})`,
    );
  }
  if (query.status) where.push(`x.status = ${p(query.status)}`);
  if (query.role)
    where.push(`EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = x.id AND r.role = ${p(query.role)})`);
  if (query.plan) where.push(`x.plan_slug = ${p(query.plan)}`);
  const cur = decodeCursor(query.cursor, ['n', 's']);
  if (cur) {
    const [at, id] = cur;
    where.push(`(x.created_at < ${p(at)} OR (x.created_at = ${p(at)} AND x.id < ${p(id)}))`);
  }
  const rows = await all<ListRow>(
    c.env.DB,
    `SELECT * FROM (
       SELECT u.id, u.email, u.status, u.created_at, u.last_login_at, pr.name, pr.full_name,
         (SELECT group_concat(role) FROM user_roles r WHERE r.user_id = u.id) AS roles,
         ${PLAN_SLUG_SQL} AS plan_slug, COALESCE(st.points, 0) AS points
       FROM users u LEFT JOIN profiles pr ON pr.user_id = u.id LEFT JOIN user_stats st ON st.user_id = u.id
     ) x ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY x.created_at DESC, x.id DESC LIMIT ${p(query.limit + 1)}`,
    ...binds,
  );
  return c.json(
    pageOf(
      rows,
      query.limit,
      (r): AdminUserRow => ({
        id: r.id,
        email: r.email,
        name: r.name,
        status: r.status,
        roles: rolesFromCsv(r.roles),
        planSlug: r.plan_slug,
        points: Math.max(0, r.points),
        createdAt: r.created_at,
        lastLoginAt: r.last_login_at,
      }),
      (r) => [r.created_at, r.id],
    ),
  );
});

interface UserRowDb {
  id: string;
  email: string;
  status: UserDetail['status'];
  tz: string;
  created_at: number;
  last_login_at: number | null;
  failed_logins: number;
  locked_until: number | null;
  terms_version: string | null;
  terms_accepted_at: number | null;
}

route(routes, api.get, async (c) => {
  const { id } = paramsOf(c, api.get.params);
  const db = c.env.DB;
  const now = Date.now();
  const user = await one<UserRowDb>(
    db,
    `SELECT id, email, status, tz, created_at, last_login_at, failed_logins, locked_until, terms_version,
       terms_accepted_at FROM users WHERE id = ?`,
    id,
  );
  if (!user || user.status === 'deleted') throw new ApiError('not_found');
  const tz = safeTimeZone(user.tz);
  const [roles, assigned, fallback, profiles, stats, usage, photos, sessions] = await batch(db, [
    q<{ role: string }>(db, 'SELECT role FROM user_roles WHERE user_id = ?', id),
    q<PlanRowDb & { assigned_at: number; expires_at: number | null }>(
      db,
      `SELECT ${PLAN_COLS.split(', ')
        .map((col) => `p.${col}`)
        .join(', ')}, up.assigned_at, up.expires_at
       FROM user_plans up JOIN plans p ON p.id = up.plan_id WHERE up.user_id = ?`,
      id,
    ),
    q<PlanRowDb>(db, `SELECT ${PLAN_COLS} FROM plans WHERE is_default = 1 AND active = 1`),
    q<{
      name: string | null;
      full_name: string | null;
      age_band: string | null;
      level_key: string;
      onb_step: number;
      onb_completed_at: number | null;
      photo_upload: string | null;
    }>(
      db,
      'SELECT name, full_name, age_band, level_key, onb_step, onb_completed_at, photo_upload FROM profiles WHERE user_id = ?',
      id,
    ),
    q<{ points: number; streak: number; last_day: string | null }>(
      db,
      'SELECT points, streak, last_day FROM user_stats WHERE user_id = ?',
      id,
    ),
    q<{ seconds_used: number }>(
      db,
      'SELECT seconds_used FROM ai_usage_monthly WHERE user_id = ? AND period = ?',
      id,
      period(now, tz),
    ),
    q<{ id: string; r2_key: string; status: 'active' | 'removed' }>(
      db,
      `SELECT up.id, up.r2_key, up.status FROM uploads up JOIN profiles pr ON pr.photo_upload = up.id
       WHERE pr.user_id = ?1 AND up.user_id = ?1`,
      id,
    ),
    q<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM mic_sessions WHERE user_id = ?', id),
  ]);
  const a = assigned[0];
  const live = a && a.active === 1 && (a.expires_at == null || a.expires_at > now) ? a : undefined;
  const effective = live ?? fallback[0];
  const limitS = Math.max(0, (effective?.ai_minutes_month ?? 0) * 60);
  const usedS = Math.max(0, usage[0]?.seconds_used ?? 0);
  const pr = profiles[0];
  const st = stats[0];
  const photo = photos[0];
  const out: UserDetail = {
    id: user.id,
    email: user.email,
    status: user.status,
    tz: user.tz || DEFAULT_TZ,
    roles: rolesFromCsv(roles.map((r) => r.role).join(',')),
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
    failedLogins: Math.max(0, user.failed_logins),
    lockedUntil: user.locked_until,
    termsVersion: user.terms_version,
    termsAcceptedAt: user.terms_accepted_at,
    plan: a ? { plan: planFromRow(a), assignedAt: a.assigned_at, expiresAt: a.expires_at } : null,
    profile: pr
      ? {
          name: pr.name,
          fullName: pr.full_name,
          ageBand: pr.age_band,
          level: pr.level_key,
          onbStep: pr.onb_step,
          onbCompletedAt: pr.onb_completed_at,
        }
      : null,
    stats: {
      points: Math.max(0, st?.points ?? 0),
      streak: Math.max(0, st?.streak ?? 0),
      lastDay: st?.last_day ?? null,
    },
    quota: { period: period(now, tz), limitS, usedS, leftS: Math.max(0, limitS - usedS) },
    photo: photo ? { uploadId: photo.id, url: mediaUrl(photo.r2_key), status: photo.status } : null,
    micSessions: sessions[0]?.n ?? 0,
  };
  return c.json(out);
});

// ---------- Account actions ----------

route(routes, api.suspend, async (c) => {
  const { id } = paramsOf(c, api.suspend.params);
  const body = await bodyOf(c, api.suspend.body);
  const t = await target(c, id);
  assertManage(c, t.roles);
  const db = c.env.DB;
  const now = Date.now();
  const status = body.suspended ? 'suspended' : 'active';
  const stmts: Query<unknown>[] = [
    q(db, 'UPDATE users SET status = ? WHERE id = ?', status, id),
    await auditStmt(
      c,
      {
        action: body.suspended ? 'users.suspend' : 'users.unsuspend',
        targetType: 'user',
        targetId: id,
        diff: { status: { from: t.status, to: status }, reason: body.reason },
      },
      now,
    ),
  ];
  // Suspension ends every session at once (lookupSession would refuse them anyway).
  if (body.suspended) stmts.push(revokeUserSessionsQuery(db, id));
  await batchRun(db, stmts);
  return c.json({ status });
});

route(routes, api.remove, async (c) => {
  const { id } = paramsOf(c, api.remove.params);
  const body = await bodyOf(c, api.remove.body);
  const t = await target(c, id);
  assertManage(c, t.roles);
  const db = c.env.DB;
  const now = Date.now();
  const uploads = await all<{ r2_key: string }>(db, 'SELECT r2_key FROM uploads WHERE user_id = ?', id);
  await batchRun(db, [
    await auditStmt(
      c,
      {
        action: 'users.delete',
        targetType: 'user',
        targetId: id,
        diff: { email: t.email, roles: t.roles, uploads: uploads.length, reason: body.reason },
      },
      now,
    ),
    ...deleteAccountQueries(db, id),
  ]);
  // The rows are gone; a failed purge leaves private, unreachable objects behind (logged).
  await purgeUserObjects(
    c.env.MEDIA,
    id,
    uploads.map((u) => u.r2_key),
  ).catch((err) => console.error(JSON.stringify({ level: 'error', msg: 'r2 purge failed', err: String(err) })));
  return c.json({ ok: true } satisfies Ok);
});

route(routes, api.assignPlan, async (c) => {
  const { id } = paramsOf(c, api.assignPlan.params);
  const body = await bodyOf(c, api.assignPlan.body);
  const db = c.env.DB;
  const now = Date.now();
  // Same rule as every account action: never one's own plan (no self-granted premium) and only on
  // accounts whose roles the actor could grant.
  const t = await target(c, id);
  assertManage(c, t.roles);
  const [plans, before] = await batch(db, [
    q<{ id: string; active: number; slug: string }>(db, 'SELECT id, active, slug FROM plans WHERE id = ?', body.planId),
    q<{ plan_id: string; expires_at: number | null }>(
      db,
      'SELECT plan_id, expires_at FROM user_plans WHERE user_id = ?',
      id,
    ),
  ]);
  const plan = plans[0];
  if (plan?.active !== 1) {
    throw new ApiError('validation_failed', 'Escolha um plano ativo.', {
      issues: [{ path: 'planId', code: 'unknown', message: 'Plano inexistente ou inativo.' }],
    });
  }
  if (body.expiresAt !== null && body.expiresAt <= now) {
    throw new ApiError('validation_failed', 'A validade precisa ser no futuro.', {
      issues: [{ path: 'expiresAt', code: 'past', message: 'A validade precisa ser no futuro.' }],
    });
  }
  await batchRun(db, [
    q(
      db,
      `INSERT INTO user_plans(user_id, plan_id, assigned_by, assigned_at, expires_at) VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET plan_id = excluded.plan_id, assigned_by = excluded.assigned_by,
         assigned_at = excluded.assigned_at, expires_at = excluded.expires_at`,
      id,
      plan.id,
      actor(c).userId,
      now,
      body.expiresAt,
    ),
    await auditStmt(
      c,
      {
        action: 'users.plan',
        targetType: 'user',
        targetId: id,
        before: before[0] ? { planId: before[0].plan_id, expiresAt: before[0].expires_at } : null,
        after: { planId: plan.id, expiresAt: body.expiresAt },
      },
      now,
    ),
  ]);
  return c.json({ planId: plan.id, expiresAt: body.expiresAt });
});

route(routes, api.resetLink, async (c) => {
  const { id } = paramsOf(c, api.resetLink.params);
  const t = await target(c, id);
  assertManage(c, t.roles);
  const db = c.env.DB;
  const now = Date.now();
  const token = randomToken(32);
  const expiresAt = now + DURATIONS.resetTokenMs;
  await batchRun(db, [
    // One live link per account: issuing a new one voids the previous unused ones.
    q(db, "DELETE FROM one_time_tokens WHERE user_id = ? AND kind = 'reset' AND used_at IS NULL", id),
    q(
      db,
      `INSERT INTO one_time_tokens(token_hash, user_id, kind, email, role, created_by, expires_at, used_at)
       VALUES(?, ?, 'reset', ?, NULL, ?, ?, NULL)`,
      await hashToken(token),
      id,
      t.email,
      actor(c).userId,
      expiresAt,
    ),
    await auditStmt(c, { action: 'users.reset_link', targetType: 'user', targetId: id, diff: { expiresAt } }, now),
  ]);
  return c.json({ url: resetUrl(await studentOrigin(c), token), expiresAt });
});

route(routes, api.progressReset, async (c) => {
  const { id } = paramsOf(c, api.progressReset.params);
  const body = await bodyOf(c, api.progressReset.body);
  // Own learner progress is allowed; another staff member's needs authority over all their roles.
  const t = await target(c, id, { allowSelf: true });
  if (t.id !== actor(c).userId) assertManage(c, t.roles);
  const db = c.env.DB;
  const now = Date.now();
  await batchRun(db, [
    ...resetProgressQueries(db, id),
    await auditStmt(
      c,
      { action: 'users.progress_reset', targetType: 'user', targetId: id, diff: { reason: body.reason } },
      now,
    ),
  ]);
  return c.json({ ok: true } satisfies Ok);
});

// ---------- Roles and invites ----------

function assertGrant(c: Ctx, role: Role): void {
  if (!canGrantRole(actor(c).roles, role)) {
    throw new ApiError(
      'forbidden',
      role === 'super_admin'
        ? 'O papel super_admin não é concedido pelo painel.'
        : 'Só o super_admin concede o papel admin.',
    );
  }
}

route(routes, api.grantRole, async (c) => {
  const { id, role } = paramsOf(c, api.grantRole.params);
  assertGrant(c, role);
  const t = await target(c, id);
  assertManage(c, t.roles);
  const db = c.env.DB;
  const now = Date.now();
  if (t.status !== 'active') throw new ApiError('conflict', 'Reative a conta antes de dar um papel a ela.');
  if (!t.roles.includes(role)) {
    await batchRun(db, [
      q(
        db,
        `INSERT INTO user_roles(user_id, role, granted_by, granted_at) VALUES(?, ?, ?, ?)
         ON CONFLICT(user_id, role) DO NOTHING`,
        id,
        role,
        actor(c).userId,
        now,
      ),
      await auditStmt(
        c,
        {
          action: 'roles.grant',
          targetType: 'user',
          targetId: id,
          diff: { roles: { from: t.roles, to: [...t.roles, role] } },
        },
        now,
      ),
    ]);
  }
  return c.json({ roles: await loadRoles(db, id) });
});

route(routes, api.revokeRole, async (c) => {
  const { id, role } = paramsOf(c, api.revokeRole.params);
  assertGrant(c, role);
  const t = await target(c, id);
  assertManage(c, t.roles);
  const db = c.env.DB;
  const now = Date.now();
  if (t.roles.includes(role)) {
    const left = t.roles.filter((r) => r !== role);
    const stmts: Query<unknown>[] = [
      q(db, 'DELETE FROM user_roles WHERE user_id = ? AND role = ?', id, role),
      await auditStmt(
        c,
        { action: 'roles.revoke', targetType: 'user', targetId: id, diff: { roles: { from: t.roles, to: left } } },
        now,
      ),
    ];
    // No staff role left: the admin sessions of the account end now.
    if (left.length === 0) stmts.push(revokeUserSessionsQuery(db, id, { audience: 'admin' }));
    await batchRun(db, stmts);
  }
  return c.json({ roles: await loadRoles(db, id) });
});

route(routes, api.invite, async (c) => {
  const body = await bodyOf(c, api.invite.body);
  assertGrant(c, body.role);
  const db = c.env.DB;
  const now = Date.now();
  const existing = await one<{ id: string; status: string; has_pass: number; roles: string | null }>(
    db,
    `SELECT u.id, u.status, u.pass_hash IS NOT NULL AS has_pass,
       (SELECT group_concat(role) FROM user_roles r WHERE r.user_id = u.id) AS roles
     FROM users u WHERE u.email = ?`,
    body.email,
  );
  if (existing) {
    if (existing.id === actor(c).userId) throw forbiddenSelf();
    // Same rule as every account action: an admin never invites (and so never claims) the account
    // of another admin or of the super_admin.
    assertManage(c, rolesFromCsv(existing.roles));
    if (existing.status !== 'active') {
      throw new ApiError('conflict', 'Esta conta está suspensa. Reative-a antes de convidar.');
    }
    // An invite sets the password of the account it names, and its link is handed to the inviter:
    // an account that already has its own password gets the role directly instead.
    if (existing.has_pass) {
      throw new ApiError(
        'conflict',
        'Esta pessoa já tem conta. Dê o papel pela página dela; ela entra no painel com a própria senha.',
        { userId: existing.id },
      );
    }
  }
  const token = randomToken(32);
  const expiresAt = now + DURATIONS.inviteTokenMs;
  await batchRun(db, [
    // One live invite per email: a new one voids the previous unused ones.
    q(db, "DELETE FROM one_time_tokens WHERE kind = 'admin_invite' AND email = ? AND used_at IS NULL", body.email),
    q(
      db,
      `INSERT INTO one_time_tokens(token_hash, user_id, kind, email, role, created_by, expires_at, used_at)
       VALUES(?, ?, 'admin_invite', ?, ?, ?, ?, NULL)`,
      await hashToken(token),
      existing?.id ?? null,
      body.email,
      body.role,
      actor(c).userId,
      expiresAt,
    ),
    await auditStmt(
      c,
      {
        action: 'roles.invite',
        targetType: existing ? 'user' : 'email',
        targetId: existing?.id ?? body.email,
        diff: { email: body.email, role: body.role, expiresAt },
      },
      now,
    ),
  ]);
  return c.json({ url: inviteUrl(adminOrigin(c), token), expiresAt });
});

// ---------- Mic transcripts (every read is audited) ----------

interface MicRowDb {
  id: string;
  user_id: string;
  email: string;
  assistant_key: string;
  mode: string;
  mission_key: string | null;
  extra_id: string | null;
  started_at: number;
  ended_at: number | null;
  secs: number;
  flagged: number;
  turns: number;
  report?: string | null;
}

const MIC_SELECT = `SELECT s.id, s.user_id, u.email, s.assistant_key, s.mode, s.mission_key, s.extra_id, s.started_at,
  s.ended_at, s.secs, s.flagged, (SELECT COUNT(*) FROM mic_turns t WHERE t.session_id = s.id) AS turns
  FROM mic_sessions s JOIN users u ON u.id = s.user_id`;

function micRow(r: MicRowDb): AdminMicSessionRow {
  const mode = MicMode.safeParse(r.mode);
  return {
    id: r.id,
    userId: r.user_id,
    userEmail: r.email,
    assistant: r.assistant_key,
    mode: mode.success ? mode.data : 'livre',
    mission: r.mission_key,
    extraId: r.extra_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    secs: Math.max(0, r.secs),
    turns: r.turns,
    flagged: r.flagged === 1,
  };
}

route(routes, api.micSessions, async (c) => {
  const query = queryOf(c, api.micSessions.query);
  const binds: Bind[] = [];
  const where: string[] = [];
  if (query.userId) {
    where.push('s.user_id = ?');
    binds.push(query.userId);
  }
  if (query.flagged !== undefined) {
    where.push('s.flagged = ?');
    binds.push(query.flagged ? 1 : 0);
  }
  const cur = decodeCursor(query.cursor, ['n', 's']);
  if (cur) {
    where.push('(s.started_at < ? OR (s.started_at = ? AND s.id < ?))');
    binds.push(cur[0], cur[0], cur[1]);
  }
  const rows = await all<MicRowDb>(
    c.env.DB,
    `${MIC_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY s.started_at DESC, s.id DESC LIMIT ?`,
    ...binds,
    query.limit + 1,
  );
  const page = pageOf(rows, query.limit, micRow, (r) => [r.started_at, r.id]);
  await (
    await auditStmt(
      c,
      {
        action: 'transcripts.list',
        targetType: query.userId ? 'user' : null,
        targetId: query.userId ?? null,
        diff: { flagged: query.flagged ?? null, cursor: query.cursor ?? null, sessions: page.items.map((i) => i.id) },
      },
      Date.now(),
    )
  ).stmt.run();
  return c.json(page);
});

const Words = z.array(Bilingual);
const Tips = z.array(PronTip);

route(routes, api.micSession, async (c) => {
  const { id } = paramsOf(c, api.micSession.params);
  const db = c.env.DB;
  const [sessions, turns] = await batch(db, [
    q<MicRowDb>(db, `${MIC_SELECT.replace('SELECT s.id,', 'SELECT s.report, s.id,')} WHERE s.id = ?`, id),
    q<{
      idx: number;
      who: AdminMicTurn['who'];
      en: string;
      pt: string | null;
      feedback: string | null;
      pron: string | null;
      words: string | null;
      source: string | null;
      created_at: number;
    }>(
      db,
      'SELECT idx, who, en, pt, feedback, pron, words, source, created_at FROM mic_turns WHERE session_id = ? ORDER BY idx',
      id,
    ),
  ]);
  const s = sessions[0];
  if (!s) throw new ApiError('not_found');
  // The read is recorded before the transcript leaves the Worker.
  await (
    await auditStmt(
      c,
      { action: 'transcripts.read', targetType: 'mic_session', targetId: id, diff: { userId: s.user_id } },
      Date.now(),
    )
  ).stmt.run();
  return c.json({
    session: {
      ...micRow(s),
      report: reportOrNull(s.report),
      turnsList: turns.map(
        (t): AdminMicTurn => ({
          idx: t.idx,
          who: t.who,
          en: t.en,
          pt: t.pt,
          feedback: parsedOrNull(Feedback, t.feedback),
          pron: parsedOrNull(Tips, t.pron),
          words: parsedOrNull(Words, t.words),
          source: t.source,
          createdAt: t.created_at,
        }),
      ),
    },
  });
});

export default routes;
