// S1 Auth & account: /api/me/* (state, summary, profile, settings, reset-progress, export, delete).
// Mounted at '/' by worker/src/index.ts, so paths are absolute (appApi.*.path) and middleware is per route.
// Every query is keyed by the session user id; no route takes a user id from the client (no IDOR surface).
import {
  ApiError,
  appApi,
  DEFAULT_TZ,
  defaults,
  FLAGS,
  type MeExport,
  type Ok,
  type ProfileCompleteRes,
  type ProfileRes,
  SettingsPatch,
  type SettingsRes,
  reminders as sortedReminders,
} from '@tie/shared';
import {
  type AppEnv,
  addDays,
  auditFor,
  batch,
  batchRun,
  bool,
  checkRateLimit,
  clearMediaCookie,
  clearSessionCookie,
  HOUR,
  issueMediaCookie,
  localDate,
  one,
  type Query,
  q,
  rateLimit,
  readMediaCookie,
  requireUser,
  sessionOf,
  toJson,
  verifyPassword,
  vJson,
} from '@tie/worker-core';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { evaluateRows, flagQuery, flagSubject } from '../account/common';
import {
  deleteAccountQueries,
  exportQueries,
  purgeUserObjects,
  resetProgressQueries,
  userExportQuery,
} from '../account/data';
import {
  PROFILE_SELECT,
  type ProfileRow,
  profileFromRow,
  profileSet,
  type SettingsRow,
  sanitizeProfilePatch,
  settingsFromRow,
  settingsSet,
} from '../account/profile';
import { buildState } from '../account/state';
import { buildSummary } from '../account/summary';

const routes = new Hono<AppEnv>();
const api = appApi.me;

/** Re-issue tie_m when it is missing, foreign or has less than this left (it lives 12h). */
const MEDIA_REFRESH_MS = 6 * HOUR;

/** The settings PATCH also takes `free`, applied only while dev.free_steps is on for the user. */
const SettingsPatchIn = SettingsPatch.extend({ free: z.boolean().optional() });

async function freeStepsOn(c: Context<AppEnv>): Promise<boolean> {
  const s = sessionOf(c);
  const [rows] = await batch(c.env.DB, [flagQuery(c.env.DB, FLAGS.freeSteps)]);
  return evaluateRows(rows, flagSubject(s), [FLAGS.freeSteps])[FLAGS.freeSteps] === true;
}

const profileQuery = (db: D1Database, userId: string): Query<ProfileRow> =>
  q<ProfileRow>(db, `${PROFILE_SELECT} WHERE p.user_id = ?`, userId);

const settingsQuery = (db: D1Database, userId: string): Query<SettingsRow> =>
  q<SettingsRow>(
    db,
    'SELECT ts, sound, hd, trans, slow, remind, fx, free FROM user_settings WHERE user_id = ?',
    userId,
  );

/**
 * GET /api/me/state?probe=1 (the shell's start-up call): signed out, or with an expired session, 204
 * instead of 401, so a first visit logs no failed request. The session is resolved once: requireUser
 * caches it on the context for the route's own requireUser.
 */
const SIGNED_OUT = new Set(['unauthorized', 'session_expired']);
const stateProbe: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.query('probe') !== '1') return next();
  try {
    await requireUser()(c, async () => {});
  } catch (err) {
    if (err instanceof ApiError && SIGNED_OUT.has(err.code)) {
      c.header('Cache-Control', 'no-store');
      return c.body(null, 204);
    }
    throw err;
  }
  return next();
};

routes.get(api.state.path, stateProbe, requireUser(), rateLimit('RL_API'), async (c) => {
  const s = sessionOf(c);
  const now = Date.now();
  const state = await buildState(c.env.DB, s, now);
  const media = await readMediaCookie(c);
  if (!media || media.userId !== s.userId || media.expiresAt - now < MEDIA_REFRESH_MS) {
    await issueMediaCookie(c, s.userId, now);
  }
  return c.json(state);
});

routes.get(api.summary.path, requireUser(), rateLimit('RL_API'), async (c) => {
  return c.json(await buildSummary(c.env.DB, c.get('services'), sessionOf(c), Date.now()));
});

routes.put(api.profile.path, requireUser(), rateLimit('RL_API'), vJson(api.profile.body), async (c) => {
  const s = sessionOf(c);
  const db = c.env.DB;
  const now = Date.now();
  const patch = sanitizeProfilePatch(c.req.valid('json'), localDate(now, s.tz || DEFAULT_TZ));
  if (patch.assistant !== undefined) {
    const known = await one(db, 'SELECT key FROM assistants WHERE key = ? AND active = 1', patch.assistant);
    if (!known) {
      throw new ApiError('validation_failed', undefined, {
        issues: [{ path: 'assistant', code: 'unknown', message: 'Assistente desconhecido.' }],
      });
    }
  }

  const { sets, binds } = profileSet(patch);
  if (patch.onbStep !== undefined) {
    sets.push('onb_step = MAX(onb_step, ?)');
    binds.push(patch.onbStep);
  }
  const stmts: Query<unknown>[] = [];
  if (sets.length) {
    stmts.push(
      q(db, `UPDATE profiles SET ${sets.join(', ')}, updated_at = ? WHERE user_id = ?`, ...binds, now, s.userId),
    );
  }
  stmts.push(profileQuery(db, s.userId));
  const results = await batch(db, stmts);
  const row = results[results.length - 1]?.[0] as ProfileRow | undefined;
  if (!row) throw new ApiError('not_found');
  return c.json({
    profile: profileFromRow(row),
    onbStep: Math.min(7, Math.max(1, row.onb_step)),
    completed: row.onb_completed_at != null,
  } satisfies ProfileRes);
});

routes.post(api.profileComplete.path, requireUser(), rateLimit('RL_API'), async (c) => {
  const s = sessionOf(c);
  const db = c.env.DB;
  const now = Date.now();
  const tz = s.tz || DEFAULT_TZ;

  const [profiles, flagRows] = await batch(db, [profileQuery(db, s.userId), flagQuery(db, FLAGS.freeSteps)]);
  const row = profiles[0];
  if (!row) throw new ApiError('not_found');
  // onbFinish (prototype cadastro.js): reminders sorted, settings.slow from the personalization
  // defaults, and finishing counts as activity (streak touch). Only the first completion applies
  // slow and the touch, so calling this again never overwrites the user's own settings.
  const stored = profileFromRow(row);
  const profile = { ...stored, reminders: sortedReminders(stored) };
  const slow = defaults(profile).speed < 1;
  const today = localDate(now, tz);
  const firstTime = 'EXISTS (SELECT 1 FROM profiles WHERE user_id = ?1 AND onb_completed_at IS NULL)';

  const [, , , , settingsRows] = await batch(db, [
    q(db, 'INSERT OR IGNORE INTO user_settings(user_id) VALUES(?)', s.userId),
    q(db, `UPDATE user_settings SET slow = ?2 WHERE user_id = ?1 AND ${firstTime}`, s.userId, slow),
    q(db, 'INSERT OR IGNORE INTO user_stats(user_id) VALUES(?)', s.userId),
    // Same rule as shared touchStreak() and the S4 engine, done in SQL so a concurrent award cannot be lost.
    q(
      db,
      `UPDATE user_stats SET streak = CASE WHEN last_day = ?2 THEN MAX(streak, 1) WHEN last_day = ?3 THEN streak + 1 ELSE 1 END,
         last_day = ?2 WHERE user_id = ?1 AND ${firstTime}`,
      s.userId,
      today,
      addDays(today, -1),
    ),
    settingsQuery(db, s.userId),
    // Last, so the conditions above still see onb_completed_at IS NULL on the first call.
    q(
      db,
      `UPDATE profiles SET onb_completed_at = COALESCE(onb_completed_at, ?), onb_step = 7, reminders = ?, updated_at = ?
       WHERE user_id = ?`,
      now,
      toJson(profile.reminders),
      now,
      s.userId,
    ),
  ]);
  const free = evaluateRows(flagRows, flagSubject(s), [FLAGS.freeSteps])[FLAGS.freeSteps] === true;
  return c.json({
    profile,
    settings: settingsFromRow(settingsRows[0], free && bool(settingsRows[0]?.free)),
  } satisfies ProfileCompleteRes);
});

routes.patch(api.settings.path, requireUser(), rateLimit('RL_API'), vJson(SettingsPatchIn), async (c) => {
  const s = sessionOf(c);
  const body = c.req.valid('json');
  const db = c.env.DB;
  const free = await freeStepsOn(c);
  // "Etapas livres" is a dev bypass: without the flag the field is ignored, like any unknown key.
  const patch = free ? body : { ...body, free: undefined };
  const { sets, binds } = settingsSet(patch);
  const stmts: Query<unknown>[] = [q(db, 'INSERT OR IGNORE INTO user_settings(user_id) VALUES(?)', s.userId)];
  if (sets.length)
    stmts.push(q(db, `UPDATE user_settings SET ${sets.join(', ')} WHERE user_id = ?`, ...binds, s.userId));
  stmts.push(settingsQuery(db, s.userId));
  const results = await batch(db, stmts);
  const row = results[results.length - 1]?.[0] as SettingsRow | undefined;
  return c.json({ settings: settingsFromRow(row, free && bool(row?.free)) } satisfies SettingsRes);
});

/** RL_AUTH (5/60s) keyed by the session user and the action: heavy or destructive account routes. */
const userAction = (action: string) => rateLimit('RL_AUTH', (c) => `u:${sessionOf(c).userId}|${action}`);

routes.post(
  api.resetProgress.path,
  requireUser(),
  userAction('reset-progress'),
  vJson(api.resetProgress.body),
  async (c) => {
    const s = sessionOf(c);
    const db = c.env.DB;
    const now = Date.now();
    await batchRun(db, [
      ...resetProgressQueries(db, s.userId),
      await auditFor(c, { action: 'me.reset_progress', targetType: 'user', targetId: s.userId }, now),
    ]);
    return c.json({ ok: true } satisfies Ok);
  },
);

routes.get(api.export.path, requireUser(), userAction('export'), async (c) => {
  const s = sessionOf(c);
  const db = c.env.DB;
  const now = Date.now();
  const { names, queries } = exportQueries(db, s.userId);
  const [userRows, ...tables] = await batch(db, [userExportQuery(db, s.userId), ...queries]);
  await (await auditFor(c, { action: 'me.export', targetType: 'user', targetId: s.userId }, now)).stmt.run();
  const out: MeExport = {
    exportedAt: now,
    user: userRows[0] ?? {},
    tables: Object.fromEntries(names.map((n, i) => [n, (tables[i] ?? []) as Record<string, unknown>[]])),
  };
  c.header('Content-Disposition', `attachment; filename="takeiteasy-dados-${localDate(now, s.tz || DEFAULT_TZ)}.json"`);
  return c.json(out);
});

routes.delete(api.deleteAccount.path, requireUser(), vJson(api.deleteAccount.body), async (c) => {
  const s = sessionOf(c);
  const body = c.req.valid('json');
  await checkRateLimit(c.env, 'RL_AUTH', `u:${s.userId}`);
  const db = c.env.DB;
  const now = Date.now();

  const user = await one<{ pass_hash: string | null }>(db, 'SELECT pass_hash FROM users WHERE id = ?', s.userId);
  if (!(await verifyPassword(body.password, user?.pass_hash))) throw new ApiError('invalid_credentials');
  // Staff accounts are removed from the admin panel, so the last super_admin cannot vanish by accident.
  if (s.roles.length) throw new ApiError('forbidden', 'Contas da equipe são excluídas pelo painel admin.');

  const [uploads] = await batch(db, [
    q<{ r2_key: string }>(db, 'SELECT r2_key FROM uploads WHERE user_id = ?', s.userId),
  ]);
  await batchRun(db, [
    await auditFor(
      c,
      { action: 'me.delete_account', targetType: 'user', targetId: s.userId, diff: { uploads: uploads.length } },
      now,
    ),
    ...deleteAccountQueries(db, s.userId),
  ]);
  // The rows are gone already; a failed R2 purge is logged (objects stay private, owner-only and orphaned).
  await purgeUserObjects(
    c.env.MEDIA,
    s.userId,
    uploads.map((u) => u.r2_key),
  ).catch((err) => console.error(JSON.stringify({ level: 'error', msg: 'r2 purge failed', err: String(err) })));
  clearSessionCookie(c, 'app');
  clearMediaCookie(c);
  return c.json({ ok: true } satisfies Ok);
});

export default routes;
