// Llama Guard on learner messages (spec 04 §3.1 step 6), run in ctx.waitUntil so it never slows a
// turn. An unsafe verdict files a moderation item (kind 'transcript') and flags the session.
// Every guard call writes an ai_usage_events row (kind 'guard', 0 s: the guard is never billed).
import { newId } from '@tie/shared';
import type { Env } from '@tie/worker-core';
import { guard } from './models';
import type { AiQuotaService } from './quota';

export const GUARD_PRIORITY = 2;
/** Learner text sent to the guard in one call (appended client turns are joined up to this). */
export const GUARD_TEXT_MAX = 2000;

export interface GuardInput {
  userId: string;
  sessionId: string;
  turnIdx: number;
  /** The learner's text; the guard classifies it alone (never the tutor's reply). */
  text: string;
  model: string;
}

/** Returns true when the message was flagged. Errors are logged and swallowed (best effort). */
export async function moderateTurn(
  env: Env,
  input: GuardInput,
  quota?: Pick<AiQuotaService, 'log'>,
  now: () => number = Date.now,
): Promise<boolean> {
  const started = now();
  let ok = false;
  try {
    const verdict = await guard(env, input.model, input.text.slice(0, GUARD_TEXT_MAX));
    ok = true;
    if (verdict.safe) return false;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO moderation_items(id, kind, subject_user_id, reporter_user_id, ref_type, ref_id, reason,
           guard_categories, excerpt, priority, status, created_at)
         VALUES(?, 'transcript', ?, NULL, 'mic_turn', ?, 'llama_guard', ?, ?, ?, 'pending', ?)`,
      ).bind(
        newId(),
        input.userId,
        `${input.sessionId}:${input.turnIdx}`,
        JSON.stringify(verdict.categories),
        input.text.slice(0, 280),
        GUARD_PRIORITY,
        now(),
      ),
      env.DB.prepare('UPDATE mic_sessions SET flagged = 1 WHERE id = ?').bind(input.sessionId),
    ]);
    return true;
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'guard failed', error: String(err) }));
    return false;
  } finally {
    if (quota) {
      await quota
        .log(input.userId, 'guard', { ok, latencyMs: now() - started, model: input.model, sessionId: input.sessionId })
        .catch((err) => console.error(JSON.stringify({ level: 'error', msg: 'guard log failed', error: String(err) })));
    }
  }
}
