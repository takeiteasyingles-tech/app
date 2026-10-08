// Per-user data operations the admin runs on a learner's account. The table lists mirror the
// student-side "Zerar progresso" and account deletion (apps/app/worker/src/account/data.ts); they
// are repeated here so the admin Worker never bundles tie-app code.
import { type Query, q } from '@tie/worker-core';

/**
 * Clears learning progress while keeping the account, profile, settings, plan and the month's AI
 * usage (quota is not refundable). Unlike the learner's own reset, Mic sessions that are flagged
 * for moderation are kept: they are evidence for a pending or decided review (spec 06 "Reset progress").
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
    q<never>(db, 'DELETE FROM mic_sessions WHERE user_id = ? AND flagged = 0', userId),
    q<never>(
      db,
      `UPDATE user_stats SET points = 0, streak = 0, last_day = NULL, challenge_best = 0, last_extra_id = NULL
       WHERE user_id = ?`,
      userId,
    ),
  ];
}

/**
 * Hard delete: users → ON DELETE CASCADE removes every per-user row; ai_usage_events has no FK and
 * reports keep the case but lose the reporter. audit_log is append-only and stays.
 */
export function deleteAccountQueries(db: D1Database, userId: string): Query<never>[] {
  return [
    q<never>(db, 'DELETE FROM ai_usage_events WHERE user_id = ?', userId),
    q<never>(db, 'UPDATE moderation_items SET reporter_user_id = NULL WHERE reporter_user_id = ?', userId),
    q<never>(db, 'DELETE FROM users WHERE id = ?', userId),
  ];
}

/** Deletes every R2 object under users/{uid}/ plus any listed keys. */
export async function purgeUserObjects(bucket: R2Bucket, userId: string, extraKeys: readonly string[] = []) {
  const keys = new Set(extraKeys);
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: `users/${userId}/`, cursor, limit: 1000 });
    for (const o of page.objects) keys.add(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const list = [...keys];
  for (let i = 0; i < list.length; i += 1000) await bucket.delete(list.slice(i, i + 1000));
  return list.length;
}
