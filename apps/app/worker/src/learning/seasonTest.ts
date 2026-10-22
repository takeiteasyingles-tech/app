// Season test use cases (spec 07, feature B). One test per season, served live from D1: only APPROVED
// questions of a season whose test is published, and only once every PUBLISHED episode of the season is
// done (domain/season seasonTestUnlocked). The answer key never leaves the server before a pass. Grading
// mirrors the e-book test (grade.ts): a choice is right when the index matches, typed text when the
// normalized accept list includes norm(text). Passing (score_pct ≥ seasons.test_pass_pct) awards
// season_pass:{n} once and issues the learner's certificate once (same D1 batch as the result).
import {
  type CertificateSummary,
  certificateCode,
  newId,
  type Ok,
  type SeasonTestAnswersBody,
  type SeasonTestQuestionPublic,
  type SeasonTestResult,
  type SeasonTestState,
  type SeasonTestSubmitBody,
  type SeasonTestView,
  scorePct,
  seasonEpisodesMissing,
  seasonTestPassed,
  seasonTestUnlocked,
  type TestAnswer,
} from '@tie/shared';
import { all, batch, batchRun, fail, one, type Query, q } from '@tie/worker-core';
import { certificateVerifyUrl } from '@tie/worker-core/pdf/certificate';
import type { LearningDeps } from './deps';
import { checkAnswer, type GradableQuestion, isCorrect, toGradable } from './grade';

/** More answers than a test can have questions is a broken client. */
const MAX_ANSWERS_PER_REQUEST = 200;
/** Fresh codes tried when a new certificate's code clashes with an existing one (UNIQUE). */
const CODE_ATTEMPTS = 4;

interface SeasonRow {
  n: number;
  title: string;
  synopsis: string | null;
  test_pass_pct: number;
  test_published: number;
}

interface QuestionRow {
  id: string;
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
}

interface AnswerRow {
  question_id: string;
  choice_idx: number | null;
  text_value: string | null;
}

interface ResultRow {
  score_pct: number;
  passed: number;
  attempts: number;
  submitted_at: number;
  passed_at: number | null;
}

export interface CertRow {
  id: string;
  code: string;
  season_n: number;
  season_title_snapshot: string;
  full_name_snapshot: string;
  score_pct: number;
  issued_at: number;
  revoked_at: number | null;
}

export const CERT_COLUMNS =
  'id, code, season_n, season_title_snapshot, full_name_snapshot, score_pct, issued_at, revoked_at';

export function certSummary(r: CertRow, origin: string): CertificateSummary {
  return {
    id: r.id,
    code: r.code,
    seasonN: r.season_n,
    seasonTitle: r.season_title_snapshot,
    fullName: r.full_name_snapshot,
    scorePct: Math.min(100, Math.max(0, r.score_pct)),
    issuedAt: r.issued_at,
    revoked: r.revoked_at != null,
    verifyUrl: certificateVerifyUrl(origin, r.code),
  };
}

function resultState(r: ResultRow | undefined): SeasonTestState | null {
  if (!r) return null;
  return {
    scorePct: Math.min(100, Math.max(0, r.score_pct)),
    passed: r.passed === 1,
    attempts: Math.max(0, r.attempts),
    submittedAt: Math.max(0, r.submitted_at),
  };
}

const gradable = (r: QuestionRow): GradableQuestion =>
  toGradable({ id: r.id, n: r.sort, opts: r.opts, answer_idx: r.answer_idx, accept: r.accept, show: r.show });

function publicQuestion(r: QuestionRow): SeasonTestQuestionPublic {
  const g = gradable(r);
  return {
    id: r.id,
    sort: r.sort,
    partTitle: r.part_title,
    q: r.q,
    kind: g.opts ? 'choice' : 'typed',
    opts: g.opts,
    audio: r.audio?.trim() ? r.audio : null,
    epNum: r.ep_num != null && r.ep_num > 0 ? r.ep_num : null,
  };
}

/** Everything the season test needs for one learner, in one D1 batch. */
async function load(d: LearningDeps, n: number) {
  const [seasons, episodes, doneRows, questions, answers, results, certs] = await batch(d.db, [
    q<SeasonRow>(d.db, 'SELECT n, title, synopsis, test_pass_pct, test_published FROM seasons WHERE n = ?', n),
    q<{ num: number }>(d.db, `SELECT num FROM episodes WHERE season_n = ? AND status = 'published' ORDER BY num`, n),
    q<{ episode_num: number }>(
      d.db,
      `SELECT p.episode_num FROM episode_progress p JOIN episodes e ON e.num = p.episode_num
       WHERE p.user_id = ? AND e.season_n = ? AND p.done_at IS NOT NULL`,
      d.userId,
      n,
    ),
    q<QuestionRow>(
      d.db,
      `SELECT id, sort, part_title, q, opts, answer_idx, accept, show, audio, rev, ep_num FROM season_test_questions
       WHERE season_n = ? AND status = 'approved' ORDER BY sort, id`,
      n,
    ),
    q<AnswerRow>(
      d.db,
      `SELECT a.question_id, a.choice_idx, a.text_value FROM season_test_answers a
       JOIN season_test_questions t ON t.id = a.question_id
       WHERE a.user_id = ? AND t.season_n = ? AND t.status = 'approved'`,
      d.userId,
      n,
    ),
    q<ResultRow>(
      d.db,
      'SELECT score_pct, passed, attempts, submitted_at, passed_at FROM season_test_results WHERE user_id = ? AND season_n = ?',
      d.userId,
      n,
    ),
    q<CertRow>(d.db, `SELECT ${CERT_COLUMNS} FROM certificates WHERE user_id = ? AND season_n = ?`, d.userId, n),
  ] as const);
  const season = seasons[0];
  if (!season) throw fail('not_found');
  const published = episodes.map((e) => e.num);
  const epsDone: Record<string, boolean> = {};
  for (const r of doneRows) epsDone[String(r.episode_num)] = true;
  const saved = new Map<string, TestAnswer>();
  for (const a of answers) {
    const v = a.choice_idx ?? a.text_value;
    if (v != null) saved.set(a.question_id, v);
  }
  return {
    season,
    published,
    missing: seasonEpisodesMissing(published, epsDone),
    unlocked: seasonTestUnlocked(published, epsDone),
    open: season.test_published === 1 && questions.length > 0,
    questions,
    saved,
    result: results[0],
    cert: certs[0] ?? null,
  };
}

type Loaded = Awaited<ReturnType<typeof load>>;

/** The gate of the write endpoints: unpublished → 404 content_unavailable, locked → 409 gated. */
function requireOpen(t: Loaded, n: number): void {
  if (!t.open) throw fail('content_unavailable', 'O teste desta temporada ainda não está disponível.');
  if (!t.unlocked) {
    throw fail('gated', `Termine os episódios da temporada ${n} para fazer o teste.`, { episodes: t.missing });
  }
}

/** GET /api/seasons/:n/test. */
export async function seasonTestView(d: LearningDeps, n: number, origin: string): Promise<SeasonTestView> {
  const t = await load(d, n);
  const visible = t.open && t.unlocked;
  return {
    season: { n: t.season.n, title: t.season.title, synopsis: t.season.synopsis },
    published: t.season.test_published === 1,
    unlocked: t.unlocked,
    episodes: { published: t.published, missing: t.missing },
    passPct: t.season.test_pass_pct,
    questions: visible ? t.questions.map(publicQuestion) : [],
    answers: visible ? Object.fromEntries(t.saved) : {},
    result: resultState(t.result),
    certificate: t.cert ? certSummary(t.cert, origin) : null,
  };
}

/** Validates answers against the question list; null (or blank text) clears one. */
function normalizeAnswers(
  questions: readonly GradableQuestion[],
  answers: Readonly<Record<string, TestAnswer | null>>,
): Map<GradableQuestion, TestAnswer | null> {
  const entries = Object.entries(answers);
  if (entries.length > MAX_ANSWERS_PER_REQUEST) throw fail('payload_too_large');
  const byId = new Map(questions.map((x) => [x.id, x]));
  const out = new Map<GradableQuestion, TestAnswer | null>();
  const issues: { path: string; code: string; message: string }[] = [];
  for (const [id, v] of entries) {
    const question = byId.get(id);
    if (!question) {
      issues.push({ path: `answers.${id}`, code: 'unknown_question', message: 'not a question of this test' });
      continue;
    }
    if (v === null) {
      out.set(question, null);
      continue;
    }
    const checked = checkAnswer(question, v);
    if (!checked.ok) issues.push({ path: `answers.${id}`, code: 'invalid_answer', message: checked.reason });
    else out.set(question, checked.value === '' ? null : checked.value);
  }
  if (issues.length) throw fail('validation_failed', undefined, { issues: issues.slice(0, 20) });
  return out;
}

function answerWrites(d: LearningDeps, changes: Map<GradableQuestion, TestAnswer | null>): Query<unknown>[] {
  const out: Query<unknown>[] = [];
  for (const [question, v] of changes) {
    if (v === null) {
      out.push(q(d.db, 'DELETE FROM season_test_answers WHERE user_id = ? AND question_id = ?', d.userId, question.id));
      continue;
    }
    out.push(
      q(
        d.db,
        `INSERT INTO season_test_answers(user_id, question_id, choice_idx, text_value, correct, updated_at)
         VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, question_id) DO UPDATE SET choice_idx = excluded.choice_idx,
           text_value = excluded.text_value, correct = excluded.correct, updated_at = excluded.updated_at`,
        d.userId,
        question.id,
        typeof v === 'number' ? v : null,
        typeof v === 'string' ? v : null,
        isCorrect(question, v),
        d.now,
      ),
    );
  }
  return out;
}

/** PUT /api/seasons/:n/test/answers. `reset` starts a redo: answers cleared, submitted_at = 0. */
export async function saveSeasonAnswers(d: LearningDeps, n: number, body: SeasonTestAnswersBody): Promise<Ok> {
  const t = await load(d, n);
  requireOpen(t, n);
  const changes = normalizeAnswers(t.questions.map(gradable), body.answers);
  const writes: Query<unknown>[] = [];
  if (body.reset) {
    writes.push(
      q(
        d.db,
        `DELETE FROM season_test_answers WHERE user_id = ?
         AND question_id IN (SELECT id FROM season_test_questions WHERE season_n = ?)`,
        d.userId,
        n,
      ),
      q(d.db, 'UPDATE season_test_results SET submitted_at = 0 WHERE user_id = ? AND season_n = ?', d.userId, n),
    );
  }
  writes.push(...answerWrites(d, changes));
  if (writes.length) await batchRun(d.db, writes);
  return { ok: true };
}

/**
 * The certificate insert: the frozen full name (profiles.full_name, else the display name) and season
 * title. ON CONFLICT DO NOTHING covers both UNIQUE keys: (user, season) means it was issued before (a
 * later pass never reissues); a code clash leaves no row, and the caller retries with a fresh code.
 */
function certInsert(d: LearningDeps, n: number, title: string, pct: number): Query<unknown> {
  return q(
    d.db,
    `INSERT INTO certificates(id, code, user_id, season_n, full_name_snapshot, season_title_snapshot, score_pct, issued_at)
     SELECT ?, ?, u.id, ?, COALESCE(NULLIF(trim(p.full_name), ''), NULLIF(trim(p.name), ''), ''), ?, ?, ?
     FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?
     ON CONFLICT DO NOTHING`,
    newId(d.now),
    certificateCode(),
    n,
    title,
    pct,
    d.now,
    d.userId,
  );
}

/**
 * POST /api/seasons/:n/test/submit: merges `answers` over the saved ones, grades every approved
 * question, stores the result (attempts + 1, best_pct, passed_at on the first pass) and, on a pass,
 * the certificate (first pass only) and the season_pass award (once per season, by its ledger key).
 * The right answers (`show`) come back only once the learner has passed: before that the endpoint
 * would be an answer oracle (submit blanks, read the key, redo, pass).
 */
export async function submitSeasonTest(
  d: LearningDeps,
  n: number,
  body: SeasonTestSubmitBody,
  origin: string,
): Promise<SeasonTestResult> {
  const t = await load(d, n);
  requireOpen(t, n);
  const questions = t.questions.map(gradable);
  const changes = normalizeAnswers(questions, body.answers ?? {});
  const merged = new Map(t.saved);
  for (const [question, v] of changes) {
    if (v === null) merged.delete(question.id);
    else merged.set(question.id, v);
  }

  const graded = questions.map((question) => ({ question, given: merged.get(question.id) ?? null }));
  const score = graded.filter((g) => isCorrect(g.question, g.given)).length;
  const total = questions.length;
  const pct = scorePct(score, total);
  const passPct = t.season.test_pass_pct;
  const passed = seasonTestPassed(pct, passPct);

  const writes: Query<unknown>[] = [
    ...answerWrites(d, changes),
    q(
      d.db,
      `INSERT INTO season_test_results(user_id, season_n, score, total, score_pct, passed, best_pct, attempts, submitted_at, passed_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(user_id, season_n) DO UPDATE SET score = excluded.score, total = excluded.total,
         score_pct = excluded.score_pct, passed = excluded.passed,
         best_pct = MAX(season_test_results.best_pct, excluded.score_pct),
         attempts = season_test_results.attempts + 1, submitted_at = excluded.submitted_at,
         passed_at = COALESCE(season_test_results.passed_at, excluded.passed_at)`,
      d.userId,
      n,
      score,
      total,
      pct,
      passed,
      pct,
      d.now,
      passed ? d.now : null,
    ),
  ];
  if (passed && !t.cert) writes.push(certInsert(d, n, t.season.title, pct));
  await batchRun(d.db, writes);

  let cert = t.cert;
  if (passed && !cert) {
    const read = () =>
      one<CertRow>(d.db, `SELECT ${CERT_COLUMNS} FROM certificates WHERE user_id = ? AND season_n = ?`, d.userId, n);
    cert = await read();
    for (let i = 1; !cert && i < CODE_ATTEMPTS; i++) {
      await batchRun(d.db, [certInsert(d, n, t.season.title, pct)]);
      cert = await read();
    }
    if (!cert) throw fail('internal', 'Não deu para emitir o certificado agora. Tente de novo.');
  }

  const after = await one<{ attempts: number; passed_at: number | null }>(
    d.db,
    'SELECT attempts, passed_at FROM season_test_results WHERE user_id = ? AND season_n = ?',
    d.userId,
    n,
  );
  const reveal = after?.passed_at != null;
  const award = passed ? await d.award.award(d.userId, 'season_pass', `season_pass:${n}`, { now: d.now }) : null;
  const byId = new Map(t.questions.map((r) => [r.id, r]));
  return {
    season: n,
    score,
    total,
    scorePct: pct,
    passPct,
    passed,
    attempts: Math.max(1, after?.attempts ?? 1),
    results: graded.map(({ question, given }) => ({
      questionId: question.id,
      correct: isCorrect(question, given),
      given,
      show: reveal ? question.show : '',
      rev: byId.get(question.id)?.rev?.trim() || null,
    })),
    award,
    certificate: cert ? certSummary(cert, origin) : null,
  };
}

/** The learner's certificates, oldest first. */
export async function myCertificates(db: D1Database, userId: string, origin: string): Promise<CertificateSummary[]> {
  const rows = await all<CertRow>(
    db,
    `SELECT ${CERT_COLUMNS} FROM certificates WHERE user_id = ? ORDER BY issued_at, id`,
    userId,
  );
  return rows.map((r) => certSummary(r, origin));
}
