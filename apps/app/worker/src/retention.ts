// Retention cron (spec 04 §5, spec 06): the Worker's scheduled handler (triggers.crons in
// wrangler.jsonc) runs it once a day.
// - Mic transcripts (mic_turns) older than app_settings['retention.transcripts_days'] (default 180),
//   except the turns of sessions a moderator still has to review; the excerpts of decided
//   moderation items go after the same period.
// - Expired sessions and one-time tokens.
// - Housekeeping rows that only matter for a short while: Idempotency-Key answers (the outbox keeps
//   writes 7 days) and consumed pronunciation attempt tokens (valid 10 minutes).
import { SETTINGS } from '@tie/shared';
import { type Env, IDEMPOTENCY_KEEP_MS, one, run } from '@tie/worker-core';
import { ATTEMPT_USES_KEEP_MS } from './ai/attempt';
import { MOD_SESSION_ID } from './ai/context';

export const TRANSCRIPT_DAYS_DEFAULT = 180;
const DAY_MS = 86_400_000;
/** Rows per DELETE statement, so one run never holds the database for long. */
export const RETENTION_CHUNK = 5000;
/** Chunks per table per run; whatever is left goes on the next day's run. */
const MAX_CHUNKS = 40;

export interface RetentionReport {
  transcriptDays: number;
  turns: number;
  excerpts: number;
  sessions: number;
  tokens: number;
  idempotencyKeys: number;
  attemptUses: number;
}

/** retention.transcripts_days as a whole number of days ≥ 1 (malformed or missing → default). */
export function transcriptDays(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : TRANSCRIPT_DAYS_DEFAULT;
}

async function chunked(db: D1Database, sql: string, ...params: (string | number)[]): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const { changes } = await run(db, sql, ...params, RETENTION_CHUNK);
    total += changes;
    if (changes < RETENTION_CHUNK) break;
  }
  return total;
}

const PENDING_SESSIONS = `SELECT ${MOD_SESSION_ID} FROM moderation_items m
  WHERE m.status = 'pending' AND m.ref_type IN ('mic_session', 'mic_turn') AND m.ref_id IS NOT NULL`;

export async function runRetention(env: Pick<Env, 'DB'>, now: number = Date.now()): Promise<RetentionReport> {
  const db = env.DB;
  const setting = await one<{ value: string }>(
    db,
    'SELECT value FROM app_settings WHERE key = ?',
    SETTINGS.retentionTranscriptsDays,
  );
  const days = transcriptDays(setting?.value);
  const cutoff = now - days * DAY_MS;

  const turns = await chunked(
    db,
    `DELETE FROM mic_turns WHERE rowid IN (
       SELECT rowid FROM mic_turns WHERE created_at < ? AND session_id NOT IN (${PENDING_SESSIONS}) LIMIT ?)`,
    cutoff,
  );
  const excerpts = await chunked(
    db,
    `UPDATE moderation_items SET excerpt = NULL WHERE rowid IN (
       SELECT rowid FROM moderation_items WHERE excerpt IS NOT NULL AND status <> 'pending' AND created_at < ? LIMIT ?)`,
    cutoff,
  );
  const sessions = await chunked(
    db,
    'DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at < ? LIMIT ?)',
    now,
  );
  const tokens = await chunked(
    db,
    'DELETE FROM one_time_tokens WHERE token_hash IN (SELECT token_hash FROM one_time_tokens WHERE expires_at < ? LIMIT ?)',
    now,
  );
  const idempotencyKeys = await chunked(
    db,
    `DELETE FROM idempotency_keys WHERE rowid IN (
       SELECT rowid FROM idempotency_keys WHERE created_at < ? LIMIT ?)`,
    now - IDEMPOTENCY_KEEP_MS,
  );
  const attemptUses = await chunked(
    db,
    'DELETE FROM attempt_uses WHERE token_sig IN (SELECT token_sig FROM attempt_uses WHERE used_at < ? LIMIT ?)',
    now - ATTEMPT_USES_KEEP_MS,
  );
  const report = { transcriptDays: days, turns, excerpts, sessions, tokens, idempotencyKeys, attemptUses };
  console.log(JSON.stringify({ level: 'info', msg: 'retention', ...report }));
  return report;
}
