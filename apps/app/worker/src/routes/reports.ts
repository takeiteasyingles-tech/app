// S7: POST /api/reports — a learner flags something; it lands in moderation_items (kind 'report').
// Mounted at '/' by worker/src/index.ts. Mic references must be the reporter's own session (the
// only transcripts they can see); reporting one also flags it so retention keeps it for review.
import { newId, reportsApi, type UserReportRes } from '@tie/shared';
import { type AppEnv, fail, one, rateLimit, requireUser, sessionOf, vJson } from '@tie/worker-core';
import { Hono } from 'hono';
import { ownedSession } from '../ai/context';
import { cleanText } from '../ai/prompt';

const routes = new Hono<AppEnv>();

/** User reports on AI output rank above plain reports in the queue (Llama Guard hits use 2 as well). */
const PRIORITY: Record<string, number> = { mic_session: 2, mic_turn: 2 };

routes.post(reportsApi.create.path, requireUser(), rateLimit('RL_UPLOAD'), vJson(reportsApi.create.body), async (c) => {
  const s = sessionOf(c);
  const body = c.req.valid('json');
  const db = c.env.DB;
  const reason = cleanText(body.reason, 500);
  if (!reason) throw fail('validation_failed', undefined, { field: 'reason' });

  let subject: string | null = null;
  let excerpt: string | null = null;
  let sessionId: string | null = null;
  const refId = body.refId ?? null;

  if (body.refType === 'mic_session' || body.refType === 'mic_turn') {
    if (!refId) throw fail('validation_failed', undefined, { field: 'refId' });
    let idx: number | null = null;
    if (body.refType === 'mic_turn') {
      const m = /^(.+):(\d{1,4})$/.exec(refId);
      if (!m?.[1] || !m[2]) throw fail('validation_failed', undefined, { field: 'refId' });
      sessionId = m[1];
      idx = Number(m[2]);
    } else {
      sessionId = refId;
    }
    await ownedSession(db, sessionId, s.userId);
    subject = s.userId;
    if (idx !== null) {
      const t = await one<{ en: string }>(
        db,
        'SELECT en FROM mic_turns WHERE session_id = ? AND idx = ?',
        sessionId,
        idx,
      );
      if (!t) throw fail('not_found');
      excerpt = t.en.slice(0, 280);
    }
  }

  const id = newId();
  const stmts = [
    db
      .prepare(
        `INSERT INTO moderation_items(id, kind, subject_user_id, reporter_user_id, ref_type, ref_id, reason,
           excerpt, priority, status, created_at)
         VALUES(?, 'report', ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .bind(id, subject, s.userId, body.refType, refId, reason, excerpt, PRIORITY[body.refType] ?? 1, Date.now()),
  ];
  if (sessionId)
    stmts.push(
      db.prepare('UPDATE mic_sessions SET flagged = 1 WHERE id = ? AND user_id = ?').bind(sessionId, s.userId),
    );
  await db.batch(stmts);
  return c.json({ id } satisfies UserReportRes, 201);
});

export default routes;
