// Audit log, feature flags, app settings and the dashboard numbers (admin).
import {
  type AdminStats,
  type AppSetting,
  type AuditEntry,
  adminApi,
  DEFAULT_TZ,
  type FeatureFlag,
  SETTINGS,
} from '@tie/shared';
import {
  type AppEnv,
  all,
  type Bind,
  batch,
  batchRun,
  DAY,
  fromJson,
  HOUR,
  invalidateFlags,
  localDate,
  one,
  q,
} from '@tie/worker-core';
import { Hono } from 'hono';
import { z } from 'zod';
import { actor, auditStmt, bodyOf, invalid, paramsOf, patchOf, queryOf, route } from '../lib/http';
import { STUDENT_ORIGIN_SETTING } from '../lib/origin';
import { decodeCursor, pageOf } from '../lib/page';

const routes = new Hono<AppEnv>();
const api = adminApi.ops;

// ---------- Audit ----------

interface AuditDb {
  id: number;
  at: number;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  ip_hash: string | null;
  ua: string | null;
  diff: string | null;
}

route(routes, api.audit, async (c) => {
  const query = queryOf(c, api.audit.query);
  const where: string[] = [];
  const binds: Bind[] = [];
  const add = (sql: string, v: Bind) => {
    where.push(sql);
    binds.push(v);
  };
  if (query.actor) add('actor_user_id = ?', query.actor);
  // "users." matches every users.* action; an exact name matches itself only.
  if (query.action) {
    if (query.action.endsWith('.'))
      add("action LIKE ? ESCAPE '\\'", `${query.action.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    else add('action = ?', query.action);
  }
  if (query.targetType) add('target_type = ?', query.targetType);
  if (query.targetId) add('target_id = ?', query.targetId);
  if (query.from !== undefined) add('at >= ?', query.from);
  if (query.to !== undefined) add('at < ?', query.to);
  const cur = decodeCursor(query.cursor, ['n']);
  if (cur) add('id < ?', cur[0] as number);
  const rows = await all<AuditDb>(
    c.env.DB,
    `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`,
    ...binds,
    query.limit + 1,
  );
  return c.json(
    pageOf(
      rows,
      query.limit,
      (r): AuditEntry => ({
        id: r.id,
        at: r.at,
        actorUserId: r.actor_user_id,
        actorRole: r.actor_role,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        ipHash: r.ip_hash,
        ua: r.ua,
        diff: fromJson<unknown>(r.diff, null),
      }),
      (r) => [r.id],
    ),
  );
});

// ---------- Feature flags ----------

interface FlagDb {
  key: string;
  enabled: number;
  rollout_pct: number;
  rules: string | null;
  updated_by: string | null;
  updated_at: number;
}

const flagOf = (r: FlagDb): FeatureFlag => ({
  key: r.key,
  enabled: r.enabled === 1,
  rolloutPct: r.rollout_pct,
  rules: fromJson<unknown>(r.rules, null),
  updatedBy: r.updated_by,
  updatedAt: r.updated_at,
});

const FLAG_KEY = /^[a-z][a-z0-9_.-]{0,79}$/;
/** worker-core FlagRules: allowlists that get the flag regardless of rollout_pct. */
const FlagRulesSchema = z
  .strictObject({
    users: z.array(z.string().min(1).max(120)).max(500).optional(),
    plans: z.array(z.string().min(1).max(60)).max(50).optional(),
    roles: z.array(z.string().min(1).max(40)).max(10).optional(),
  })
  .nullable();

route(routes, api.flags, async (c) => {
  const rows = await all<FlagDb>(c.env.DB, 'SELECT * FROM feature_flags ORDER BY key');
  return c.json({ items: rows.map(flagOf) });
});

route(routes, api.setFlag, async (c) => {
  const { key } = paramsOf(c, api.setFlag.params);
  if (!FLAG_KEY.test(key)) throw invalid('key', 'Chave: minúsculas, números, ".", "-" e "_".');
  // FlagPutBody defaults rolloutPct (100) and rules (null): those apply to a new flag only. On an
  // existing flag, absent keys keep their stored values, so {enabled:false} only turns it off.
  const { body: parsed, sent } = await patchOf(c, api.setFlag.body);
  const db = c.env.DB;
  const now = Date.now();
  const before = await one<FlagDb>(db, 'SELECT * FROM feature_flags WHERE key = ?', key);
  const body = {
    enabled: parsed.enabled,
    rolloutPct: before && !sent.has('rolloutPct') ? before.rollout_pct : parsed.rolloutPct,
    rules: before && !sent.has('rules') ? fromJson<unknown>(before.rules, null) : parsed.rules,
  };
  const rules = FlagRulesSchema.safeParse(body.rules);
  if (!rules.success) throw invalid('rules', 'Regras: {users?, plans?, roles?} com listas de texto.');
  await batchRun(db, [
    q(
      db,
      `INSERT INTO feature_flags(key, enabled, rollout_pct, rules, updated_by, updated_at) VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled, rollout_pct = excluded.rollout_pct,
         rules = excluded.rules, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      key,
      body.enabled,
      body.rolloutPct,
      rules.data === null ? null : JSON.stringify(rules.data),
      actor(c).userId,
      now,
    ),
    await auditStmt(
      c,
      {
        action: 'flags.set',
        targetType: 'feature_flag',
        targetId: key,
        before: before
          ? { enabled: before.enabled === 1, rolloutPct: before.rollout_pct, rules: fromJson(before.rules, null) }
          : null,
        after: { enabled: body.enabled, rolloutPct: body.rolloutPct, rules: rules.data },
      },
      now,
    ),
  ]);
  // This isolate sees the change now; others within worker-core's 30 s flag cache.
  invalidateFlags();
  const row = await one<FlagDb>(db, 'SELECT * FROM feature_flags WHERE key = ?', key);
  return c.json({ item: flagOf(row as FlagDb) });
});

// ---------- Settings ----------

const MODEL_ID = /^@cf\/[\w.-]+\/[\w.:-]{1,120}$/;

/**
 * Keys an admin may set, each with its rule. content.current is not here: it moves only through
 * publish and rollback, which check that the snapshot exists.
 */
export const SETTING_RULES: Record<string, { check: (v: string) => boolean; hint: string }> = {
  [SETTINGS.retentionTranscriptsDays]: {
    check: (v) => /^\d{1,4}$/.test(v) && Number(v) >= 1 && Number(v) <= 3650,
    hint: 'Dias entre 1 e 3650.',
  },
  [SETTINGS.termsVersion]: { check: (v) => /^[\w.-]{1,40}$/.test(v), hint: 'Versão curta, por exemplo 2026-10.' },
  [SETTINGS.modelTutor]: { check: (v) => MODEL_ID.test(v), hint: 'Um id de modelo do Workers AI (@cf/…).' },
  [SETTINGS.modelTutorFallback]: { check: (v) => MODEL_ID.test(v), hint: 'Um id de modelo do Workers AI (@cf/…).' },
  [SETTINGS.modelAsr]: { check: (v) => MODEL_ID.test(v), hint: 'Um id de modelo do Workers AI (@cf/…).' },
  [SETTINGS.modelTts]: { check: (v) => MODEL_ID.test(v), hint: 'Um id de modelo do Workers AI (@cf/…).' },
  [SETTINGS.modelGuard]: { check: (v) => MODEL_ID.test(v), hint: 'Um id de modelo do Workers AI (@cf/…).' },
  [STUDENT_ORIGIN_SETTING]: {
    check: (v) => {
      try {
        const u = new URL(v);
        return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === v;
      } catch {
        return false;
      }
    },
    hint: 'A origem do app dos alunos, sem barra no fim (https://…).',
  },
};

interface SettingDb {
  key: string;
  value: string;
  updated_by: string | null;
  updated_at: number;
}

const settingOf = (r: SettingDb): AppSetting => ({
  key: r.key,
  value: r.value,
  updatedBy: r.updated_by,
  updatedAt: r.updated_at,
});

route(routes, api.settings, async (c) => {
  const rows = await all<SettingDb>(
    c.env.DB,
    'SELECT key, value, updated_by, updated_at FROM app_settings ORDER BY key',
  );
  return c.json({ items: rows.map(settingOf) });
});

route(routes, api.setSetting, async (c) => {
  const { key } = paramsOf(c, api.setSetting.params);
  const body = await bodyOf(c, api.setSetting.body);
  if (key === SETTINGS.contentCurrent) {
    throw invalid('key', 'A versão publicada muda só por publicação ou rollback.', 'managed');
  }
  const rule = SETTING_RULES[key];
  if (!rule)
    throw invalid('key', `Configuração desconhecida. Use: ${Object.keys(SETTING_RULES).join(', ')}.`, 'unknown');
  const value = body.value.trim();
  if (!rule.check(value)) throw invalid('value', rule.hint);
  const db = c.env.DB;
  const now = Date.now();
  const before = await one<SettingDb>(
    db,
    'SELECT key, value, updated_by, updated_at FROM app_settings WHERE key = ?',
    key,
  );
  await batchRun(db, [
    q(
      db,
      `INSERT INTO app_settings(key, value, updated_by, updated_at) VALUES(?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      key,
      value,
      actor(c).userId,
      now,
    ),
    await auditStmt(
      c,
      {
        action: 'settings.set',
        targetType: 'app_setting',
        targetId: key,
        diff: { value: { from: before?.value ?? null, to: value } },
      },
      now,
    ),
  ]);
  const row = await one<SettingDb>(
    db,
    'SELECT key, value, updated_by, updated_at FROM app_settings WHERE key = ?',
    key,
  );
  return c.json({ item: settingOf(row as SettingDb) });
});

// ---------- Stats ----------

/** Unix ms of local midnight of `now` in `tz` (the day the dashboard calls "today"). */
export function startOfLocalDay(now: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(now));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const sinceMidnight = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000 + (now % 1000);
  return now - sinceMidnight;
}

/** Unix ms of local midnight on the 1st of `now`'s month in `tz` (DST-safe: re-anchored at noon). */
export function startOfLocalMonth(now: number, tz: string): number {
  const today = startOfLocalDay(now, tz);
  const dayOfMonth = Number(localDate(now, tz).slice(8, 10));
  return startOfLocalDay(today - (dayOfMonth - 1) * DAY + 12 * HOUR, tz);
}

/** Learners active since `since`: a session seen, a login or a counted study day. */
const activeSql = `SELECT COUNT(*) AS n FROM (
  SELECT user_id AS id FROM sessions WHERE audience = 'app' AND last_seen_at >= ?1
  UNION SELECT id FROM users WHERE last_login_at >= ?1
  UNION SELECT user_id FROM daily_stats WHERE local_date >= ?2 AND points > 0
) a JOIN users u ON u.id = a.id WHERE u.status <> 'deleted'
  AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id)`;

route(routes, api.stats, async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  const tz = DEFAULT_TZ;
  const today = startOfLocalDay(now, tz);
  const d7 = now - 7 * DAY;
  const d30 = now - 30 * DAY;
  const learner = "status <> 'deleted' AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = users.id)";
  const [total, activeToday, active7, active30, new7, suspended, aiMonth, ai24, pending, flagged, current] =
    await batch(db, [
      q<{ n: number }>(db, `SELECT COUNT(*) AS n FROM users WHERE ${learner}`),
      q<{ n: number }>(db, activeSql, today, localDate(now, tz)),
      q<{ n: number }>(db, activeSql, d7, localDate(d7, tz)),
      q<{ n: number }>(db, activeSql, d30, localDate(d30, tz)),
      q<{ n: number }>(db, `SELECT COUNT(*) AS n FROM users WHERE ${learner} AND created_at >= ?`, d7),
      q<{ n: number }>(db, "SELECT COUNT(*) AS n FROM users WHERE status = 'suspended'"),
      // From the events, not ai_usage_monthly: those periods are keyed in each learner's own timezone,
      // so near a month boundary they would not match the dashboard's São Paulo month.
      q<{ s: number | null }>(
        db,
        'SELECT SUM(seconds) AS s FROM ai_usage_events WHERE created_at >= ?',
        startOfLocalMonth(now, tz),
      ),
      q<{ calls: number; errors: number | null }>(
        db,
        'SELECT COUNT(*) AS calls, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errors FROM ai_usage_events WHERE created_at >= ?',
        now - 24 * HOUR,
      ),
      q<{ n: number }>(db, "SELECT COUNT(*) AS n FROM moderation_items WHERE status = 'pending'"),
      q<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM mic_sessions WHERE flagged = 1'),
      q<{ version: string; published_at: number | null }>(
        db,
        `SELECT s.value AS version, r.published_at FROM app_settings s LEFT JOIN content_releases r ON r.version = s.value
       WHERE s.key = ?`,
        SETTINGS.contentCurrent,
      ),
    ]);
  const seconds = aiMonth[0]?.s ?? 0;
  const calls = ai24[0]?.calls ?? 0;
  const errors = ai24[0]?.errors ?? 0;
  const out: AdminStats = {
    users: {
      total: total[0]?.n ?? 0,
      activeToday: activeToday[0]?.n ?? 0,
      active7d: active7[0]?.n ?? 0,
      active30d: active30[0]?.n ?? 0,
      new7d: new7[0]?.n ?? 0,
      suspended: suspended[0]?.n ?? 0,
    },
    ai: {
      secondsThisMonth: seconds,
      minutesThisMonth: Math.ceil(seconds / 60),
      calls24h: calls,
      errors24h: errors,
      failureRate24h: calls ? Math.round((errors / calls) * 10_000) / 10_000 : 0,
    },
    moderation: { pending: pending[0]?.n ?? 0, flaggedSessions: flagged[0]?.n ?? 0 },
    content: { current: current[0]?.version ?? null, publishedAt: current[0]?.published_at ?? null },
  };
  return c.json(out);
});

export default routes;
