// Account data operations: "Zerar progresso", LGPD export and account deletion (spec 01 §12, 04 §3).
import { type Query, q } from '@tie/worker-core';

/**
 * Statements that clear learning progress (the prototype's PROGRESS_KEYS) while keeping the
 * account, profile, settings, plan and the monthly AI usage (quota is not refundable).
 * Exported so the admin progress-reset (S10) can reuse the exact same set.
 */
export function resetProgressQueries(db: D1Database, userId: string): Query<never>[] {
  const del = (table: string) => q<never>(db, `DELETE FROM ${table} WHERE user_id = ?`, userId);
  return [
    del('episode_progress'),
    del('step_completions'),
    del('mic_scores'),
    del('exercise_answers'),
    del('user_ebooks'),
    del('ebook_test_answers'),
    del('ebook_test_results'),
    del('srs_cards'),
    del('user_extras'),
    del('daily_stats'),
    del('point_ledger'),
    del('user_badges'),
    del('mic_sessions'), // mic_turns cascade
    q<never>(
      db,
      `UPDATE user_stats SET points = 0, streak = 0, last_day = NULL, challenge_best = 0, last_extra_id = NULL
       WHERE user_id = ?`,
      userId,
    ),
  ];
}

/** Table → SELECT for the export. Secrets (pass_hash, token hashes) and staff-only notes are left out. */
const EXPORT_TABLES: ReadonlyArray<readonly [string, string]> = [
  ['profiles', 'SELECT * FROM profiles WHERE user_id = ?1'],
  ['user_settings', 'SELECT * FROM user_settings WHERE user_id = ?1'],
  ['user_roles', 'SELECT role, granted_at FROM user_roles WHERE user_id = ?1'],
  [
    'user_plans',
    `SELECT up.plan_id, p.name AS plan_name, up.assigned_at, up.expires_at FROM user_plans up
     LEFT JOIN plans p ON p.id = up.plan_id WHERE up.user_id = ?1`,
  ],
  [
    'sessions',
    'SELECT audience, created_at, last_seen_at, expires_at, ua FROM sessions WHERE user_id = ?1 ORDER BY created_at',
  ],
  ['episode_progress', 'SELECT * FROM episode_progress WHERE user_id = ?1 ORDER BY episode_num'],
  ['step_completions', 'SELECT * FROM step_completions WHERE user_id = ?1 ORDER BY episode_num, step'],
  ['mic_scores', 'SELECT * FROM mic_scores WHERE user_id = ?1'],
  ['exercise_answers', 'SELECT * FROM exercise_answers WHERE user_id = ?1'],
  ['user_ebooks', 'SELECT * FROM user_ebooks WHERE user_id = ?1'],
  ['ebook_test_answers', 'SELECT * FROM ebook_test_answers WHERE user_id = ?1'],
  ['ebook_test_results', 'SELECT * FROM ebook_test_results WHERE user_id = ?1'],
  ['srs_cards', 'SELECT * FROM srs_cards WHERE user_id = ?1 ORDER BY created_at'],
  ['user_extras', 'SELECT * FROM user_extras WHERE user_id = ?1'],
  ['user_stats', 'SELECT * FROM user_stats WHERE user_id = ?1'],
  ['daily_stats', 'SELECT * FROM daily_stats WHERE user_id = ?1 ORDER BY local_date'],
  ['point_ledger', 'SELECT * FROM point_ledger WHERE user_id = ?1 ORDER BY id'],
  ['user_badges', 'SELECT * FROM user_badges WHERE user_id = ?1'],
  [
    'mic_sessions',
    `SELECT id, assistant_key, mode, mission_key, extra_id, started_at, ended_at, secs, status, report, report_source
     FROM mic_sessions WHERE user_id = ?1 ORDER BY started_at`,
  ],
  [
    'mic_turns',
    `SELECT t.* FROM mic_turns t JOIN mic_sessions s ON s.id = t.session_id
     WHERE s.user_id = ?1 ORDER BY s.started_at, t.idx`,
  ],
  ['ai_usage_monthly', 'SELECT * FROM ai_usage_monthly WHERE user_id = ?1 ORDER BY period'],
  [
    'ai_usage_events',
    'SELECT kind, model, seconds, session_id, ok, created_at FROM ai_usage_events WHERE user_id = ?1 ORDER BY id',
  ],
  ['uploads', 'SELECT id, kind, mime, bytes, sha256, status, created_at FROM uploads WHERE user_id = ?1'],
  [
    'moderation_items',
    `SELECT id, kind, ref_type, ref_id, reason, status, created_at, reviewed_at FROM moderation_items
     WHERE subject_user_id = ?1 OR reporter_user_id = ?1 ORDER BY created_at`,
  ],
  ['audit_log', 'SELECT at, action, target_type, target_id FROM audit_log WHERE actor_user_id = ?1 ORDER BY id'],
];

export function exportQueries(db: D1Database, userId: string): { names: string[]; queries: Query[] } {
  return {
    names: EXPORT_TABLES.map(([name]) => name),
    queries: EXPORT_TABLES.map(([, sql]) => q(db, sql, userId)),
  };
}

export const userExportQuery = (db: D1Database, userId: string): Query =>
  q(
    db,
    `SELECT id, email, status, tz, terms_version, terms_accepted_at, created_at, last_login_at
     FROM users WHERE id = ?`,
    userId,
  );

/**
 * Hard delete. users → ON DELETE CASCADE removes every per-user row; ai_usage_events has no FK and
 * moderation reports keep the case but lose the reporter. audit_log is append-only and stays.
 */
export function deleteAccountQueries(db: D1Database, userId: string): Query<never>[] {
  return [
    q<never>(db, 'DELETE FROM ai_usage_events WHERE user_id = ?', userId),
    q<never>(db, 'UPDATE moderation_items SET reporter_user_id = NULL WHERE reporter_user_id = ?', userId),
    q<never>(db, 'DELETE FROM users WHERE id = ?', userId),
  ];
}

/** Deletes every R2 object under users/{uid}/ (photos, recordings), plus any listed extra keys. */
export async function purgeUserObjects(
  bucket: R2Bucket,
  userId: string,
  extraKeys: readonly string[] = [],
): Promise<number> {
  const keys = new Set(extraKeys);
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: `users/${userId}/`, cursor, limit: 1000 });
    for (const o of page.objects) keys.add(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const all = [...keys];
  for (let i = 0; i < all.length; i += 1000) await bucket.delete(all.slice(i, i + 1000));
  return all.length;
}
