// Feature B (spec 07): season test questions (CRUD, bulk review, AI draft, publish) and certificates
// (list, PDF, revoke/reinstate). Every mutation writes its audit row in the same D1 batch. The test is
// served live from D1 to learners (tie-app learning/seasonTest.ts): only approved questions of a
// published test, so approving, rejecting and publishing take effect at once.
import {
  type AdminCertificateRow,
  ApiError,
  adminCertificatesApi,
  adminSeasonTestApi,
  LIMITS,
  newId,
  norm,
  type SeasonTestAdmin,
  type SeasonTestConfig,
  type SeasonTestQuestionRow,
  seasonTestQuestionIssues,
} from '@tie/shared';
import { type AppEnv, all, batch, batchRun, fromJson, one, type Query, q, toJson } from '@tie/worker-core';
import { certificatePdf, loadCertificate, pdfResponse } from '@tie/worker-core/pdf/certificate';
import { Hono } from 'hono';
import {
  actor,
  auditStmt,
  bodyOf,
  type Ctx,
  invalid,
  likeEscape,
  paramsOf,
  patchOf,
  queryOf,
  route,
} from '../lib/http';
import { studentOrigin } from '../lib/origin';
import { decodeCursor, pageOf } from '../lib/page';
import { draftEpisodes, draftQuestions } from '../lib/seasonDraft';

const routes = new Hono<AppEnv>();
const api = adminSeasonTestApi;
const certApi = adminCertificatesApi;

// ---------- Rows ----------

interface QuestionDb {
  id: string;
  season_n: number;
  sort: number;
  part_title: string;
  q: string;
  opts: string | null;
  answer_idx: number | null;
  accept: string | null;
  show: string | null;
  audio: string | null;
  rev: string | null;
  ep_num: number | null;
  status: SeasonTestQuestionRow['status'];
  source: SeasonTestQuestionRow['source'];
  created_at: number;
  updated_at: number;
  updated_by: string | null;
}

const QUESTION_COLUMNS =
  'id, season_n, sort, part_title, q, opts, answer_idx, accept, show, audio, rev, ep_num, status, source, created_at, updated_at, updated_by';

const list = (s: string | null): string[] | null => {
  const v = fromJson<unknown>(s, null);
  return Array.isArray(v) ? v.map(String) : null;
};

export const questionRow = (r: QuestionDb): SeasonTestQuestionRow => ({
  id: r.id,
  seasonN: r.season_n,
  sort: r.sort,
  partTitle: r.part_title,
  q: r.q,
  opts: list(r.opts),
  answerIdx: r.opts != null ? r.answer_idx : null,
  accept: list(r.accept),
  show: r.show,
  audio: r.audio,
  rev: r.rev,
  epNum: r.ep_num,
  status: r.status,
  source: r.source,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
});

interface SeasonDb {
  n: number;
  title: string;
  test_pass_pct: number;
  test_question_count: number;
  test_published: number;
  test_published_at: number | null;
  test_published_by: string | null;
}

const SEASON_COLUMNS =
  'n, title, test_pass_pct, test_question_count, test_published, test_published_at, test_published_by';

const seasonConfig = (s: SeasonDb): SeasonTestConfig => ({
  n: s.n,
  title: s.title,
  passPct: s.test_pass_pct,
  questionCount: s.test_question_count,
  published: s.test_published === 1,
  publishedAt: s.test_published_at,
  publishedBy: s.test_published_by,
});

async function seasonOr404(db: D1Database, n: number): Promise<SeasonDb> {
  const s = await one<SeasonDb>(db, `SELECT ${SEASON_COLUMNS} FROM seasons WHERE n = ?`, n);
  if (!s) throw new ApiError('not_found', `Temporada ${n} não encontrada.`);
  return s;
}

/** Typed answers are stored normalized with norm(), blanks and repeats dropped (null when none is left). */
const normAccept = (accept: readonly string[] | null | undefined): string[] | null => {
  if (!accept) return null;
  const out = [...new Set(accept.map((a) => norm(a)).filter((a) => a !== ''))];
  return out.length ? out : null;
};

/** Editable fields of a stored row (what audit diffs compare). */
type Editable = Omit<SeasonTestQuestionRow, 'id' | 'seasonN' | 'createdAt' | 'updatedAt' | 'updatedBy'>;
const editable = (r: SeasonTestQuestionRow): Editable => {
  const { id: _i, seasonN: _s, createdAt: _c, updatedAt: _u, updatedBy: _b, ...rest } = r;
  return rest;
};

/** Why publishing would be refused (pt-BR). */
function publishProblems(s: SeasonDb, approved: number, publishedEpisodes: number): string[] {
  const out: string[] = [];
  if (publishedEpisodes === 0) out.push('A temporada ainda não tem nenhum episódio publicado.');
  if (approved < s.test_question_count) {
    out.push(
      `Aprove pelo menos ${s.test_question_count} questões (${approved} aprovada${approved === 1 ? '' : 's'} agora).`,
    );
  }
  return out;
}

async function readAdmin(
  db: D1Database,
  n: number,
  status?: SeasonTestQuestionRow['status'],
): Promise<SeasonTestAdmin> {
  const [seasons, counts, eps, rows] = await batch(db, [
    q<SeasonDb>(db, `SELECT ${SEASON_COLUMNS} FROM seasons WHERE n = ?`, n),
    q<{ status: string; c: number }>(
      db,
      'SELECT status, COUNT(*) AS c FROM season_test_questions WHERE season_n = ? GROUP BY status',
      n,
    ),
    q<{ c: number }>(db, `SELECT COUNT(*) AS c FROM episodes WHERE season_n = ? AND status = 'published'`, n),
    status
      ? q<QuestionDb>(
          db,
          `SELECT ${QUESTION_COLUMNS} FROM season_test_questions WHERE season_n = ? AND status = ? ORDER BY sort, id`,
          n,
          status,
        )
      : q<QuestionDb>(
          db,
          `SELECT ${QUESTION_COLUMNS} FROM season_test_questions WHERE season_n = ? ORDER BY sort, id`,
          n,
        ),
  ] as const);
  const season = seasons[0];
  if (!season) throw new ApiError('not_found', `Temporada ${n} não encontrada.`);
  const by = (k: string) => counts.find((r) => r.status === k)?.c ?? 0;
  const c = { draft: by('draft'), approved: by('approved'), rejected: by('rejected') };
  return {
    season: seasonConfig(season),
    counts: c,
    publishProblems: publishProblems(season, c.approved, eps[0]?.c ?? 0),
    questions: rows.map(questionRow),
  };
}

/** epNum must be an episode of this season (ep_num has no FK, like ebook_test_questions). */
async function checkEpisode(db: D1Database, n: number, epNum: number | null, path = 'epNum'): Promise<void> {
  if (epNum == null) return;
  const ok = await one(db, 'SELECT 1 AS x FROM episodes WHERE num = ? AND season_n = ?', epNum, n);
  if (!ok) throw invalid(path, `O episódio ${epNum} não é desta temporada.`, 'unknown_ref');
}

function throwIssues(issues: { path: string; code: string; message: string }[]): void {
  if (issues.length) throw new ApiError('validation_failed', issues[0]?.message, { issues });
}

/** Draft + approved questions of a season (rejected ones do not count towards the cap). */
async function liveCount(db: D1Database, n: number): Promise<number> {
  const r = await one<{ c: number }>(
    db,
    `SELECT COUNT(*) AS c FROM season_test_questions WHERE season_n = ? AND status IN ('draft', 'approved')`,
    n,
  );
  return r?.c ?? 0;
}

function tooMany(live: number, adding: number): void {
  if (live + adding > LIMITS.seasonTestQuestionsMax) {
    throw new ApiError(
      'conflict',
      `O teste comporta até ${LIMITS.seasonTestQuestionsMax} questões em rascunho ou aprovadas (${live} agora). Rejeite ou apague algumas antes.`,
    );
  }
}

const insertQuestion = (db: D1Database, r: SeasonTestQuestionRow): Query<unknown> =>
  q(
    db,
    `INSERT INTO season_test_questions(${QUESTION_COLUMNS}) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.id,
    r.seasonN,
    r.sort,
    r.partTitle,
    r.q,
    r.opts ? toJson(r.opts) : null,
    r.opts ? r.answerIdx : null,
    r.accept ? toJson(r.accept) : null,
    r.show,
    r.audio,
    r.rev,
    r.epNum,
    r.status,
    r.source,
    r.createdAt,
    r.updatedAt,
    r.updatedBy,
  );

async function nextSort(db: D1Database, n: number): Promise<number> {
  const r = await one<{ m: number | null }>(
    db,
    'SELECT MAX(sort) AS m FROM season_test_questions WHERE season_n = ?',
    n,
  );
  return Math.min(9999, (r?.m ?? -1) + 1);
}

// ---------- Season test ----------

route(routes, api.get, async (c) => {
  const { n } = paramsOf(c, api.get.params);
  const { status } = queryOf(c, api.get.query);
  return c.json(await readAdmin(c.env.DB, n, status));
});

route(routes, api.create, async (c) => {
  const { n } = paramsOf(c, api.create.params);
  const body = await bodyOf(c, api.create.body);
  const db = c.env.DB;
  await seasonOr404(db, n);
  const accept = normAccept(body.accept);
  throwIssues(seasonTestQuestionIssues({ ...body, accept }));
  await checkEpisode(db, n, body.epNum);
  tooMany(await liveCount(db, n), 1);
  const now = Date.now();
  const row: SeasonTestQuestionRow = {
    id: newId(now),
    seasonN: n,
    sort: body.sort ?? (await nextSort(db, n)),
    partTitle: body.partTitle,
    q: body.q,
    opts: body.opts,
    answerIdx: body.opts ? body.answerIdx : null,
    accept,
    show: body.show,
    audio: body.audio,
    rev: body.rev,
    epNum: body.epNum,
    status: 'draft',
    source: 'staff',
    createdAt: now,
    updatedAt: now,
    updatedBy: actor(c).userId,
  };
  await batchRun(db, [
    insertQuestion(db, row),
    await auditStmt(
      c,
      {
        action: 'season_test.question.create',
        targetType: 'season_test_question',
        targetId: row.id,
        after: { seasonN: n, ...editable(row) },
      },
      now,
    ),
  ]);
  return c.json({ item: row });
});

async function questionOr404(db: D1Database, n: number, id: string): Promise<QuestionDb> {
  const row = await one<QuestionDb>(
    db,
    `SELECT ${QUESTION_COLUMNS} FROM season_test_questions WHERE id = ? AND season_n = ?`,
    id,
    n,
  );
  if (!row) throw new ApiError('not_found', 'Questão não encontrada nesta temporada.');
  return row;
}

route(routes, api.update, async (c) => {
  const { n, id } = paramsOf(c, api.update.params);
  const { body, sent } = await patchOf(c, api.update.body);
  const db = c.env.DB;
  const before = questionRow(await questionOr404(db, n, id));
  const merged: SeasonTestQuestionRow = { ...before };
  for (const k of sent) {
    if (k in body) (merged as unknown as Record<string, unknown>)[k] = (body as Record<string, unknown>)[k];
  }
  merged.accept = normAccept(merged.accept);
  if (!merged.opts) merged.answerIdx = null;
  throwIssues(seasonTestQuestionIssues(merged));
  if (sent.has('epNum')) await checkEpisode(db, n, merged.epNum);
  const now = Date.now();
  // Staff edits keep the status (an edit through MCP sends it back to draft, see lib/mcpTools.ts).
  const next: SeasonTestQuestionRow = { ...merged, updatedAt: now, updatedBy: actor(c).userId };
  await batchRun(db, [
    q(
      db,
      `UPDATE season_test_questions SET sort = ?, part_title = ?, q = ?, opts = ?, answer_idx = ?, accept = ?, show = ?,
         audio = ?, rev = ?, ep_num = ?, updated_at = ?, updated_by = ? WHERE id = ? AND season_n = ?`,
      next.sort,
      next.partTitle,
      next.q,
      next.opts ? toJson(next.opts) : null,
      next.opts ? next.answerIdx : null,
      next.accept ? toJson(next.accept) : null,
      next.show,
      next.audio,
      next.rev,
      next.epNum,
      now,
      next.updatedBy,
      id,
      n,
    ),
    await auditStmt(
      c,
      {
        action: 'season_test.question.update',
        targetType: 'season_test_question',
        targetId: id,
        before: editable(before),
        after: editable(next),
      },
      now,
    ),
  ]);
  return c.json({ item: next });
});

route(routes, api.remove, async (c) => {
  const { n, id } = paramsOf(c, api.remove.params);
  const db = c.env.DB;
  const before = questionRow(await questionOr404(db, n, id));
  const used = await one<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM season_test_answers WHERE question_id = ?', id);
  if ((used?.c ?? 0) > 0) {
    throw new ApiError('in_use', 'Alunos já responderam esta questão. Rejeite-a em vez de apagar.', {
      answers: used?.c ?? 0,
    });
  }
  const now = Date.now();
  await batchRun(db, [
    q(db, 'DELETE FROM season_test_questions WHERE id = ? AND season_n = ?', id, n),
    await auditStmt(
      c,
      {
        action: 'season_test.question.delete',
        targetType: 'season_test_question',
        targetId: id,
        before: editable(before),
      },
      now,
    ),
  ]);
  return c.json({ ok: true as const });
});

route(routes, api.review, async (c) => {
  const { n } = paramsOf(c, api.review.params);
  const body = await bodyOf(c, api.review.body);
  const db = c.env.DB;
  const ids = [...new Set(body.ids)];
  const marks = ids.map(() => '?').join(', ');
  const rows = await all<QuestionDb>(
    db,
    `SELECT ${QUESTION_COLUMNS} FROM season_test_questions WHERE season_n = ? AND id IN (${marks})`,
    n,
    ...ids,
  );
  if (rows.length !== ids.length) {
    const found = new Set(rows.map((r) => r.id));
    throw new ApiError('not_found', 'Questão não encontrada nesta temporada.', {
      ids: ids.filter((id) => !found.has(id)),
    });
  }
  // Leaving 'rejected' makes a question live again: keep the cap.
  if (body.status !== 'rejected') {
    const reviving = rows.filter((r) => r.status === 'rejected').length;
    if (reviving) tooMany(await liveCount(db, n), reviving);
  }
  const now = Date.now();
  const changed = rows.filter((r) => r.status !== body.status);
  await batchRun(db, [
    q(
      db,
      `UPDATE season_test_questions SET status = ?, updated_at = ?, updated_by = ? WHERE season_n = ? AND id IN (${marks})`,
      body.status,
      now,
      actor(c).userId,
      n,
      ...ids,
    ),
    await auditStmt(
      c,
      {
        action: 'season_test.question.review',
        targetType: 'season',
        targetId: String(n),
        diff: {
          status: body.status,
          ids,
          from: Object.fromEntries(changed.map((r) => [r.id, r.status])),
        },
      },
      now,
    ),
  ]);
  const after = await all<QuestionDb>(
    db,
    `SELECT ${QUESTION_COLUMNS} FROM season_test_questions WHERE season_n = ? AND id IN (${marks}) ORDER BY sort, id`,
    n,
    ...ids,
  );
  return c.json({ items: after.map(questionRow) });
});

route(routes, api.draft, async (c) => {
  const { n } = paramsOf(c, api.draft.params);
  const body = await bodyOf(c, api.draft.body);
  const db = c.env.DB;
  const season = await seasonOr404(db, n);
  const episodes = await draftEpisodes(db, n, body.episodes);
  if (body.episodes?.length) {
    const have = new Set(episodes.map((e) => e.num));
    const bad = body.episodes.filter((e) => !have.has(e));
    if (bad.length) {
      throw invalid('episodes', `Episódios não publicados nesta temporada: ${bad.join(', ')}.`, 'unknown_ref');
    }
  }
  if (!episodes.length) {
    throw new ApiError('conflict', 'A temporada ainda não tem episódios publicados para gerar questões.');
  }
  const count = body.count ?? Math.min(season.test_question_count, LIMITS.seasonTestDraftMax);
  const live = await liveCount(db, n);
  tooMany(live, count);
  const [existingRows, cefrRow] = await batch(db, [
    q<{ q: string }>(db, 'SELECT q FROM season_test_questions WHERE season_n = ? ORDER BY sort, id', n),
    q<{ cefr: string | null }>(
      db,
      `SELECT json_extract(extra, '$.cefr') AS cefr FROM option_lists
       WHERE list_key = 'levels' AND json_valid(extra) AND json_extract(extra, '$.season') = ? ORDER BY sort LIMIT 1`,
      n,
    ),
  ] as const);
  const outcome = await draftQuestions(c.env as unknown as { DB: D1Database; AI?: unknown }, {
    season: { n, title: season.title, cefr: String(cefrRow[0]?.cefr ?? '') },
    episodes,
    count,
    existing: existingRows.map((r) => r.q),
    instructions: body.instructions,
    partTitle: body.partTitle,
  });
  if (!outcome.questions.length) {
    throw new ApiError('conflict', 'Os episódios publicados não têm material suficiente para gerar questões.');
  }
  const now = Date.now();
  const userId = actor(c).userId;
  let sort = await nextSort(db, n);
  const rows: SeasonTestQuestionRow[] = outcome.questions.map((d) => ({
    id: newId(now),
    seasonN: n,
    sort: Math.min(9999, sort++),
    partTitle: d.partTitle,
    q: d.q,
    opts: d.opts,
    answerIdx: d.opts ? d.answerIdx : null,
    accept: normAccept(d.accept),
    show: d.show,
    audio: d.audio,
    rev: d.rev,
    epNum: d.epNum,
    status: 'draft',
    source: 'ai',
    createdAt: now,
    updatedAt: now,
    updatedBy: userId,
  }));
  await batchRun(db, [
    ...rows.map((r) => insertQuestion(db, r)),
    await auditStmt(
      c,
      {
        action: 'season_test.question.draft',
        targetType: 'season',
        targetId: String(n),
        diff: {
          source: outcome.source,
          detail: outcome.detail.slice(0, 200),
          count: rows.length,
          ids: rows.map((r) => r.id),
          questions: rows.map((r) => r.q),
        },
      },
      now,
    ),
  ]);
  return c.json({ items: rows, source: outcome.source });
});

route(routes, api.publish, async (c) => {
  const { n } = paramsOf(c, api.publish.params);
  const body = await bodyOf(c, api.publish.body);
  const db = c.env.DB;
  const view = await readAdmin(db, n, 'approved');
  if (body.published && view.publishProblems.length) {
    throw new ApiError('conflict', view.publishProblems.join(' '), { publishProblems: view.publishProblems });
  }
  const before = view.season;
  const now = Date.now();
  const userId = actor(c).userId;
  await batchRun(db, [
    body.published
      ? q(
          db,
          'UPDATE seasons SET test_published = 1, test_published_at = ?, test_published_by = ? WHERE n = ?',
          now,
          userId,
          n,
        )
      : q(db, 'UPDATE seasons SET test_published = 0 WHERE n = ?', n),
    await auditStmt(
      c,
      {
        action: 'season_test.publish',
        targetType: 'season',
        targetId: String(n),
        diff: {
          published: { from: before.published, to: body.published },
          approved: view.counts.approved,
          questions: view.questions.map((x) => x.id),
        },
      },
      now,
    ),
  ]);
  return c.json({ season: seasonConfig(await seasonOr404(db, n)) });
});

// ---------- Certificates ----------

interface CertDb {
  id: string;
  code: string;
  user_id: string;
  email: string | null;
  full_name_snapshot: string;
  season_n: number;
  season_title_snapshot: string;
  score_pct: number;
  issued_at: number;
  revoked_at: number | null;
  revoked_by: string | null;
  revoke_reason: string | null;
}

const CERT_SELECT = `SELECT c.id, c.code, c.user_id, u.email, c.full_name_snapshot, c.season_n, c.season_title_snapshot,
  c.score_pct, c.issued_at, c.revoked_at, c.revoked_by, c.revoke_reason
  FROM certificates c LEFT JOIN users u ON u.id = c.user_id`;

const certRow = (r: CertDb): AdminCertificateRow => ({
  id: r.id,
  code: r.code,
  userId: r.user_id,
  userEmail: r.email,
  fullName: r.full_name_snapshot,
  seasonN: r.season_n,
  seasonTitle: r.season_title_snapshot,
  scorePct: r.score_pct,
  issuedAt: r.issued_at,
  revokedAt: r.revoked_at,
  revokedBy: r.revoked_by,
  revokeReason: r.revoke_reason,
});

route(routes, certApi.list, async (c) => {
  const query = queryOf(c, certApi.list.query);
  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (query.season != null) {
    where.push('c.season_n = ?');
    binds.push(query.season);
  }
  if (query.userId) {
    where.push('c.user_id = ?');
    binds.push(query.userId);
  }
  if (query.revoked != null) where.push(query.revoked ? 'c.revoked_at IS NOT NULL' : 'c.revoked_at IS NULL');
  if (query.q) {
    const like = `%${likeEscape(query.q)}%`;
    where.push(`(c.code LIKE ? ESCAPE '\\' OR c.full_name_snapshot LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')`);
    binds.push(like, like, like);
  }
  const cur = decodeCursor(query.cursor, ['n', 's']);
  if (cur) {
    where.push('(c.issued_at < ? OR (c.issued_at = ? AND c.id < ?))');
    binds.push(cur[0] as number, cur[0] as number, cur[1] as string);
  }
  const rows = await all<CertDb>(
    c.env.DB,
    `${CERT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.issued_at DESC, c.id DESC LIMIT ?`,
    ...binds,
    query.limit + 1,
  );
  return c.json(pageOf(rows, query.limit, certRow, (r) => [r.issued_at, r.id]));
});

route(routes, certApi.pdf, async (c: Ctx) => {
  const { id } = paramsOf(c, certApi.pdf.params);
  const row = await loadCertificate(c.env.DB, id);
  if (!row) throw new ApiError('not_found', 'Certificado não encontrado.');
  return pdfResponse(await certificatePdf(c.env, row, await studentOrigin(c)), row.code);
});

route(routes, certApi.revoke, async (c) => {
  const { id } = paramsOf(c, certApi.revoke.params);
  const body = await bodyOf(c, certApi.revoke.body);
  const db = c.env.DB;
  const before = await one<CertDb>(db, `${CERT_SELECT} WHERE c.id = ?`, id);
  if (!before) throw new ApiError('not_found', 'Certificado não encontrado.');
  const now = Date.now();
  const userId = actor(c).userId;
  await batchRun(db, [
    body.revoked
      ? q(
          db,
          `UPDATE certificates SET revoked_at = COALESCE(revoked_at, ?), revoked_by = ?, revoke_reason = ? WHERE id = ?`,
          now,
          userId,
          body.reason,
          id,
        )
      : q(db, 'UPDATE certificates SET revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL WHERE id = ?', id),
    await auditStmt(
      c,
      {
        action: body.revoked ? 'certificate.revoke' : 'certificate.reinstate',
        targetType: 'certificate',
        targetId: id,
        diff: {
          code: before.code,
          userId: before.user_id,
          reason: body.reason,
          revoked: { from: before.revoked_at != null, to: body.revoked },
        },
      },
      now,
    ),
  ]);
  const after = await one<CertDb>(db, `${CERT_SELECT} WHERE c.id = ?`, id);
  return c.json({ item: certRow(after as CertDb) });
});

export default routes;
