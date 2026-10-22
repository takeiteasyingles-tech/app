// The MCP tools of tie-admin (spec 07, feature D; definitions in @tie/shared contracts/mcp.ts).
// Each handler gets arguments already validated by the tool's input schema and reuses the admin's own
// logic: entity reads/updates go through lib/entityCrud (same strict schemas, server checks and audit
// actions as PUT /admin-api/content/*), preview_release runs the publish compile without publishing.
// Season test questions are written straight to the 0007 tables with the rules of
// seasonTestQuestionIssues() (agent B's staff routes apply the same rules); an agent's question is
// always a draft (source 'agent') until staff approve it. Errors are thrown as ApiError and become
// tool results with isError: true in routes/mcp.ts.
import {
  ApiError,
  LIMITS,
  type McpToolInput,
  type McpToolName,
  type McpToolOutput,
  newId,
  norm,
  type SeasonTestQuestionRow,
  seasonTestQuestionIssues,
} from '@tie/shared';
import { all, batch, batchRun, fromJson, one, type Query, q, toJson } from '@tie/worker-core';
import { previewContent } from '../routes/publish';
import type { AgentToken } from './agent';
import type { Issue, Item } from './entities';
import { entityNamed, failIssues, loadOne, loadRows, updateEntity, type Writer } from './entityCrud';
import type { Ctx } from './http';

export interface ToolCtx {
  c: Ctx;
  db: D1Database;
  token: AgentToken;
  writer: Writer;
}

type Handler<N extends McpToolName> = (args: McpToolInput<N>, t: ToolCtx) => Promise<McpToolOutput<N>>;

const SEASONS = entityNamed('seasons');
const EPISODES = entityNamed('episodes');
const EBOOKS = entityNamed('ebooks');

const notFound = (what: string): ApiError => new ApiError('not_found', `${what} not found.`);

function nonEmpty(patch: Record<string, unknown>): Item {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (!keys.length) failIssues([{ path: 'patch', code: 'empty', message: 'Nothing to change: the patch is empty.' }]);
  return patch as Item;
}

// ---------- Episodes ----------

interface EpisodeSummaryDb {
  num: number;
  title: string;
  season_n: number | null;
  status: 'title_only' | 'draft' | 'published';
  ebook_num: number | null;
  updated_at: number;
}

const EP_SUMMARY = 'SELECT num, title, season_n, status, ebook_num, updated_at FROM episodes';

const episodeSummary = (r: EpisodeSummaryDb) => ({
  num: r.num,
  title: r.title,
  seasonN: r.season_n,
  status: r.status,
  ebookNum: r.ebook_num,
  updatedAt: r.updated_at,
});

// ---------- Season test questions ----------

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

const questionRow = (r: QuestionDb): SeasonTestQuestionRow => ({
  id: r.id,
  seasonN: r.season_n,
  sort: r.sort,
  partTitle: r.part_title,
  q: r.q,
  opts: fromJson<string[] | null>(r.opts, null),
  answerIdx: r.answer_idx,
  accept: fromJson<string[] | null>(r.accept, null),
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

/** Typed answers are stored normalized with norm(), blanks and repeats dropped (null when none is left). */
function normAccept(accept: readonly string[] | null | undefined): string[] | null {
  if (!accept) return null;
  const out = [...new Set(accept.map((a) => norm(a)).filter((a) => a !== ''))];
  return out.length ? out : null;
}

async function requireSeason(db: D1Database, n: number): Promise<void> {
  if (!(await one(db, 'SELECT 1 AS x FROM seasons WHERE n = ?', n))) throw notFound(`Season ${n}`);
}

/** Issues for episode numbers that do not exist (ep_num has no FK, like ebook_test_questions). */
async function epNumIssues(db: D1Database, refs: readonly { path: string; epNum: number | null }[]): Promise<Issue[]> {
  const nums = [...new Set(refs.flatMap((r) => (r.epNum == null ? [] : [r.epNum])))];
  if (!nums.length) return [];
  const found = await all<{ num: number }>(
    db,
    `SELECT num FROM episodes WHERE num IN (${nums.map(() => '?').join(', ')})`,
    ...nums,
  );
  const have = new Set(found.map((r) => r.num));
  return refs
    .filter((r) => r.epNum != null && !have.has(r.epNum))
    .map((r) => ({ path: r.path, code: 'unknown_ref', message: `Não encontrei episódio "${r.epNum}".` }));
}

const QUESTION_SELECT = 'SELECT * FROM season_test_questions';

// ---------- Handlers ----------

export const TOOL_HANDLERS: { [N in McpToolName]: Handler<N> } = {
  async list_seasons(_args, { db }) {
    const [items, counts, pub] = await Promise.all([
      loadRows(db, SEASONS, ''),
      all<{ n: number; c: number }>(
        db,
        'SELECT season_n AS n, COUNT(*) AS c FROM episodes WHERE season_n IS NOT NULL GROUP BY season_n',
      ),
      all<{ n: number; p: number }>(db, 'SELECT n, test_published AS p FROM seasons'),
    ]);
    const epCount = new Map(counts.map((r) => [r.n, r.c]));
    const published = new Map(pub.map((r) => [r.n, r.p === 1]));
    return {
      items: items.map((s) => ({
        ...(s as McpToolOutput<'get_season'>['item']),
        episodes: epCount.get(s.n as number) ?? 0,
        testPublished: published.get(s.n as number) ?? false,
      })),
    };
  },

  async get_season({ n }, { db }) {
    const item = await loadOne(db, SEASONS, n);
    if (!item) throw notFound(`Season ${n}`);
    const [pub, eps] = await batch(db, [
      q<{ p: number }>(db, 'SELECT test_published AS p FROM seasons WHERE n = ?', n),
      q<EpisodeSummaryDb>(db, `${EP_SUMMARY} WHERE season_n = ? ORDER BY num`, n),
    ]);
    return {
      item: { ...(item as McpToolOutput<'update_season'>['item']), testPublished: pub[0]?.p === 1 },
      episodes: eps.map(episodeSummary),
    };
  },

  async update_season({ n, patch, expectedUpdatedAt }, { db, writer }) {
    const item = await updateEntity(db, SEASONS, n, nonEmpty(patch), writer, { expectedUpdatedAt });
    return { item: item as McpToolOutput<'update_season'>['item'] };
  },

  async list_episodes({ seasonN, status }, { db }) {
    const where: string[] = [];
    const binds: (string | number)[] = [];
    if (seasonN !== undefined) {
      where.push('season_n = ?');
      binds.push(seasonN);
    }
    if (status !== undefined) {
      where.push('status = ?');
      binds.push(status);
    }
    const rows = await all<EpisodeSummaryDb>(
      db,
      `${EP_SUMMARY}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY num`,
      ...binds,
    );
    return { items: rows.map(episodeSummary) };
  },

  async get_episode({ num, sections, include }, { db }) {
    const full = await loadOne(db, EPISODES, num);
    if (!full) throw notFound(`Episode ${num}`);
    let item: Item = full;
    if (sections) {
      item = { num: full.num, title: full.title, updatedAt: full.updatedAt };
      for (const k of sections) item[k] = full[k];
    }
    const out: McpToolOutput<'get_episode'> = { item: item as McpToolOutput<'get_episode'>['item'] };
    if (include?.includes('micPhrases')) {
      out.micPhrases = (await loadRows(db, entityNamed('mic-phrases'), 'episode_num = ?', num)) as NonNullable<
        McpToolOutput<'get_episode'>['micPhrases']
      >;
    }
    if (include?.includes('exercises')) {
      const [exercises, items] = await Promise.all([
        loadRows(db, entityNamed('exercises'), 'episode_num = ?', num),
        loadRows(db, entityNamed('items'), 'exercise_id IN (SELECT id FROM exercises WHERE episode_num = ?)', num),
      ]);
      out.exercises = exercises.map((ex) => ({
        ...ex,
        items: items.filter((it) => it.exerciseId === ex.id),
      })) as NonNullable<McpToolOutput<'get_episode'>['exercises']>;
    }
    return out;
  },

  async update_episode({ num, patch, expectedUpdatedAt }, { db, writer }) {
    const item = await updateEntity(db, EPISODES, num, nonEmpty(patch), writer, { expectedUpdatedAt });
    return { item: item as McpToolOutput<'update_episode'>['item'] };
  },

  async list_ebooks(_args, { db }) {
    const rows = await loadRows(db, EBOOKS, '');
    return {
      items: rows.map((e) => ({
        num: e.num as number,
        title: e.title as string,
        epsLabel: (e.epsLabel ?? null) as string | null,
        scope: (e.scope ?? null) as string | null,
        passScore: e.passScore as number,
        updatedAt: e.updatedAt as number,
      })),
    };
  },

  async get_ebook({ num, includeTest }, { db }) {
    const item = await loadOne(db, EBOOKS, num);
    if (!item) throw notFound(`E-book ${num}`);
    const out: McpToolOutput<'get_ebook'> = { item: item as McpToolOutput<'get_ebook'>['item'] };
    if (includeTest) {
      out.test = (await loadRows(db, entityNamed('test-questions'), 'ebook_num = ?', num)) as NonNullable<
        McpToolOutput<'get_ebook'>['test']
      >;
    }
    return out;
  },

  async update_ebook({ num, patch, expectedUpdatedAt }, { db, writer }) {
    const item = await updateEntity(db, EBOOKS, num, nonEmpty(patch), writer, { expectedUpdatedAt });
    return { item: item as McpToolOutput<'update_ebook'>['item'] };
  },

  async list_season_test_questions({ seasonN, status }, { db }) {
    await requireSeason(db, seasonN);
    const rows = status
      ? await all<QuestionDb>(
          db,
          `${QUESTION_SELECT} WHERE season_n = ? AND status = ? ORDER BY sort, id`,
          seasonN,
          status,
        )
      : await all<QuestionDb>(db, `${QUESTION_SELECT} WHERE season_n = ? ORDER BY sort, id`, seasonN);
    return { items: rows.map(questionRow) };
  },

  async draft_season_test_questions({ seasonN, questions }, { db, writer }) {
    await requireSeason(db, seasonN);
    const [live, maxSort] = await batch(db, [
      q<{ n: number }>(
        db,
        "SELECT COUNT(*) AS n FROM season_test_questions WHERE season_n = ? AND status IN ('draft', 'approved')",
        seasonN,
      ),
      q<{ m: number | null }>(db, 'SELECT MAX(sort) AS m FROM season_test_questions WHERE season_n = ?', seasonN),
    ]);
    const liveCount = live[0]?.n ?? 0;
    if (liveCount + questions.length > LIMITS.seasonTestQuestionsMax) {
      failIssues([
        {
          path: 'questions',
          code: 'too_many',
          message: `A season test holds at most ${LIMITS.seasonTestQuestionsMax} draft + approved questions (${liveCount} now). Reject or improve existing drafts instead.`,
        },
      ]);
    }
    const issues: Issue[] = [];
    const normalized = questions.map((qn, i) => {
      const accept = normAccept(qn.accept);
      for (const it of seasonTestQuestionIssues({ ...qn, accept })) {
        issues.push({ ...it, path: `questions.${i}.${it.path}` });
      }
      return { ...qn, accept };
    });
    issues.push(
      ...(await epNumIssues(
        db,
        normalized.map((qn, i) => ({ path: `questions.${i}.epNum`, epNum: qn.epNum })),
      )),
    );
    if (issues.length) failIssues(issues);

    const now = Date.now();
    let nextSort = (maxSort[0]?.m ?? -1) + 1;
    const rows: SeasonTestQuestionRow[] = normalized.map((qn) => ({
      id: newId(),
      seasonN,
      sort: qn.sort ?? nextSort++,
      partTitle: qn.partTitle,
      q: qn.q,
      opts: qn.opts,
      answerIdx: qn.opts ? qn.answerIdx : null,
      accept: qn.accept,
      show: qn.show,
      audio: qn.audio,
      rev: qn.rev,
      epNum: qn.epNum,
      status: 'draft',
      source: 'agent',
      createdAt: now,
      updatedAt: now,
      updatedBy: writer.userId,
    }));
    const stmts: Query<unknown>[] = rows.map((r) =>
      q(
        db,
        `INSERT INTO season_test_questions(id, season_n, sort, part_title, q, opts, answer_idx, accept, show, audio, rev,
           ep_num, status, source, created_at, updated_at, updated_by)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        r.id,
        r.seasonN,
        r.sort,
        r.partTitle,
        r.q,
        r.opts ? toJson(r.opts) : null,
        r.answerIdx,
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
      ),
    );
    // One audit row for the batch, like the AI draft endpoint (season_test.question.draft).
    stmts.push(
      await writer.audit(
        {
          action: 'season_test.question.draft',
          targetType: 'season',
          targetId: String(seasonN),
          diff: { source: 'agent', count: rows.length, ids: rows.map((r) => r.id), questions: rows.map((r) => r.q) },
        },
        now,
      ),
    );
    await batchRun(db, stmts);
    return { items: rows };
  },

  async update_season_test_question({ seasonN, id, patch }, { db, writer }) {
    nonEmpty(patch);
    const row = await one<QuestionDb>(db, `${QUESTION_SELECT} WHERE id = ? AND season_n = ?`, id, seasonN);
    if (!row) throw notFound(`Question ${id} of season ${seasonN}`);
    const before = questionRow(row);
    const merged = { ...before };
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
    merged.accept = normAccept(merged.accept);
    const issues: Issue[] = [
      ...seasonTestQuestionIssues(merged),
      ...(await epNumIssues(db, [{ path: 'epNum', epNum: merged.epNum }])),
    ];
    if (issues.length) failIssues(issues);
    const now = Date.now();
    // Any agent edit sends the question back to staff review.
    const next: SeasonTestQuestionRow = { ...merged, status: 'draft', updatedAt: now, updatedBy: writer.userId };
    const editableOf = (r: SeasonTestQuestionRow) => {
      const { createdAt: _c, updatedAt: _u, updatedBy: _b, ...rest } = r;
      return rest;
    };
    await batchRun(db, [
      q(
        db,
        `UPDATE season_test_questions SET sort = ?, part_title = ?, q = ?, opts = ?, answer_idx = ?, accept = ?, show = ?,
           audio = ?, rev = ?, ep_num = ?, status = ?, updated_at = ?, updated_by = ?
         WHERE id = ? AND season_n = ?`,
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
        next.status,
        now,
        next.updatedBy,
        id,
        seasonN,
      ),
      await writer.audit(
        {
          action: 'season_test.question.update',
          targetType: 'season_test_question',
          targetId: id,
          before: editableOf(before),
          after: editableOf(next),
        },
        now,
      ),
    ]);
    return { item: { ...next, answerIdx: next.opts ? next.answerIdx : null } };
  },

  async preview_release(_args, { c }) {
    return previewContent(c);
  },
};
