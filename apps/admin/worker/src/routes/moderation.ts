// Moderation queue (/admin-api/moderation, moderator). Items come from profile photo uploads, Llama
// Guard hits on Mic turns and learner reports. A decision is final (only pending items can be
// decided) and "removed" acts on the content:
// - photo / recording (ref upload): the upload is marked removed (staff still see it as evidence)
//   and, for a photo, the profile stops pointing at it;
// - transcript or report on a Mic turn ("<session>:<idx>"): that turn's text is replaced;
// - report on a Mic session: every turn is replaced and the session report is cleared.
// The claim and its effects run in one D1 batch, so a lost race changes nothing. A queue page that
// carries transcript excerpts is audited (moderation.excerpts_read), like a transcript read.
import { ApiError, adminApi, type ModerationItem, mediaUrl } from '@tie/shared';
import { type AppEnv, all, type Bind, batchRun, fromJson, one, type Query, q } from '@tie/worker-core';
import { Hono } from 'hono';
import { actor, auditIf, auditStmt, bodyOf, paramsOf, queryOf, route } from '../lib/http';
import { decodeCursor, pageOf } from '../lib/page';

const routes = new Hono<AppEnv>();
const api = adminApi.moderation;

/** Replacement text for a removed Mic turn (mic_turns.en is NOT NULL). */
export const REMOVED_TEXT = '[mensagem removida pela moderação]';

interface ItemDb {
  id: string;
  kind: ModerationItem['kind'];
  subject_user_id: string | null;
  reporter_user_id: string | null;
  ref_type: string | null;
  ref_id: string | null;
  reason: string | null;
  guard_categories: string | null;
  excerpt: string | null;
  priority: number;
  status: ModerationItem['status'];
  created_at: number;
  reviewed_by: string | null;
  reviewed_at: number | null;
  notes: string | null;
  upload_key: string | null;
}

const ITEM_SELECT = `SELECT m.*, CASE WHEN m.ref_type = 'upload' THEN
  (SELECT u.r2_key FROM uploads u WHERE u.id = m.ref_id) END AS upload_key FROM moderation_items m`;

function itemOf(r: ItemDb): ModerationItem {
  const cats = fromJson<unknown>(r.guard_categories, null);
  return {
    id: r.id,
    kind: r.kind,
    subjectUserId: r.subject_user_id,
    reporterUserId: r.reporter_user_id,
    refType: r.ref_type,
    refId: r.ref_id,
    reason: r.reason,
    guardCategories: Array.isArray(cats) ? cats.map(String) : null,
    excerpt: r.excerpt,
    priority: r.priority,
    status: r.status,
    createdAt: r.created_at,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    notes: r.notes,
    mediaUrl: r.upload_key && (r.kind === 'photo' || r.kind === 'recording') ? mediaUrl(r.upload_key) : null,
  };
}

route(routes, api.list, async (c) => {
  const query = queryOf(c, api.list.query);
  const status = query.status ?? 'pending';
  const where: string[] = ['m.status = ?'];
  const binds: Bind[] = [status];
  if (query.kind) {
    where.push('m.kind = ?');
    binds.push(query.kind);
  }
  // The open queue is worked by priority, oldest first; decided items list newest first.
  const pending = status === 'pending';
  const cur = decodeCursor(query.cursor, pending ? ['n', 'n', 's'] : ['n', 's']);
  if (cur && pending) {
    const [prio, at, id] = cur;
    where.push('(m.priority < ? OR (m.priority = ? AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?))))');
    binds.push(prio, prio, at, at, id);
  } else if (cur) {
    where.push('(m.created_at < ? OR (m.created_at = ? AND m.id < ?))');
    binds.push(cur[0], cur[0], cur[1]);
  }
  const order = pending ? 'm.priority DESC, m.created_at ASC, m.id ASC' : 'm.created_at DESC, m.id DESC';
  const rows = await all<ItemDb>(
    c.env.DB,
    `${ITEM_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`,
    ...binds,
    query.limit + 1,
  );
  const page = pageOf(rows, query.limit, itemOf, (r) =>
    pending ? [r.priority, r.created_at, r.id] : [r.created_at, r.id],
  );
  // Excerpts are pieces of learners' Mic transcripts: like a transcript read, the page that carries
  // them is recorded before it leaves the Worker.
  const withExcerpt = page.items.filter((i) => i.excerpt);
  if (withExcerpt.length) {
    await (
      await auditStmt(
        c,
        {
          action: 'moderation.excerpts_read',
          targetType: null,
          targetId: null,
          diff: {
            status,
            kind: query.kind ?? null,
            cursor: query.cursor ?? null,
            items: withExcerpt.map((i) => ({ id: i.id, subjectUserId: i.subjectUserId, ref: i.refId })),
          },
        },
        Date.now(),
      )
    ).stmt.run();
  }
  return c.json(page);
});

/** "<sessionId>:<idx>" → parts; null when malformed. */
function turnRef(refId: string | null): { sessionId: string; idx: number } | null {
  const m = /^(.+):(\d{1,4})$/.exec(refId ?? '');
  return m?.[1] && m[2] ? { sessionId: m[1], idx: Number(m[2]) } : null;
}

route(routes, api.decide, async (c) => {
  const { id } = paramsOf(c, api.decide.params);
  const body = await bodyOf(c, api.decide.body);
  const db = c.env.DB;
  const now = Date.now();
  const s = actor(c);
  const item = await one<ItemDb>(db, `${ITEM_SELECT} WHERE m.id = ?`, id);
  if (!item) throw new ApiError('not_found');
  if (item.status !== 'pending') throw new ApiError('conflict', 'Este item já foi decidido.');

  // Effects run only when this request's claim (status pending → decision, reviewed now by me) won.
  const won =
    'EXISTS (SELECT 1 FROM moderation_items WHERE id = ? AND status = ? AND reviewed_by = ? AND reviewed_at = ?)';
  const wonBinds: Bind[] = [id, body.decision, s.userId, now];
  const effects: Query<unknown>[] = [];
  const effectNames: string[] = [];
  if (body.decision === 'removed') {
    if (item.ref_type === 'upload' && item.ref_id) {
      effects.push(q(db, `UPDATE uploads SET status = 'removed' WHERE id = ? AND ${won}`, item.ref_id, ...wonBinds));
      effectNames.push('upload_removed');
      if (item.kind === 'photo') {
        effects.push(
          q(
            db,
            `UPDATE profiles SET photo_upload = NULL, updated_at = ? WHERE photo_upload = ? AND ${won}`,
            now,
            item.ref_id,
            ...wonBinds,
          ),
        );
        effectNames.push('profile_photo_cleared');
      }
    } else if (item.ref_type === 'mic_turn') {
      const ref = turnRef(item.ref_id);
      if (ref) {
        effects.push(
          q(
            db,
            `UPDATE mic_turns SET en = ?, pt = NULL, feedback = NULL, pron = NULL, words = NULL
             WHERE session_id = ? AND idx = ? AND ${won}`,
            REMOVED_TEXT,
            ref.sessionId,
            ref.idx,
            ...wonBinds,
          ),
        );
        effectNames.push('turn_redacted');
      }
    } else if (item.ref_type === 'mic_session' && item.ref_id) {
      effects.push(
        q(
          db,
          `UPDATE mic_turns SET en = ?, pt = NULL, feedback = NULL, pron = NULL, words = NULL WHERE session_id = ? AND ${won}`,
          REMOVED_TEXT,
          item.ref_id,
          ...wonBinds,
        ),
        q(
          db,
          `UPDATE mic_sessions SET report = NULL, report_source = NULL WHERE id = ? AND ${won}`,
          item.ref_id,
          ...wonBinds,
        ),
      );
      effectNames.push('session_redacted');
    }
  }
  const [claim] = await batchRun(db, [
    q(
      db,
      `UPDATE moderation_items SET status = ?, reviewed_by = ?, reviewed_at = ?, notes = ? WHERE id = ? AND status = 'pending'`,
      body.decision,
      s.userId,
      now,
      body.notes ?? null,
      id,
    ),
    ...effects,
    await auditIf(
      c,
      {
        action: 'moderation.decide',
        targetType: 'moderation_item',
        targetId: id,
        diff: {
          status: { from: 'pending', to: body.decision },
          kind: item.kind,
          ref: item.ref_type ? `${item.ref_type}:${item.ref_id ?? ''}` : null,
          subjectUserId: item.subject_user_id,
          effects: effectNames,
          notes: body.notes ?? null,
        },
      },
      now,
      won,
      wonBinds,
    ),
  ]);
  if (!claim?.changes) throw new ApiError('conflict', 'Este item já foi decidido.');
  const row = await one<ItemDb>(db, `${ITEM_SELECT} WHERE m.id = ?`, id);
  return c.json({ item: itemOf(row as ItemDb) });
});

export default routes;
