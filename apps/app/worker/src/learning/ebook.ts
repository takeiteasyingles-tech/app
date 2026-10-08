import {
  type DownloadRes,
  mediaUrl,
  type Ok,
  type TestAnswer,
  type TestAnswersBody,
  type TestQuestion,
  type TestResult,
  type TestSubmitBody,
} from '@tie/shared';
import { batch, batchRun, fail, one, type Query, q, run } from '@tie/worker-core';
import { ebookOpen } from './content';
import type { LearningDeps } from './deps';
import { checkAnswer, type GradableQuestion, isCorrect, type TestQuestionRow, toGradable } from './grade';

// E-book use cases (spec 01 §5 "teste", step 3 download). The test is graded on the server only;
// passing (score ≥ ebooks.pass_score) awards test_pass:{n} once.

/** More answers than any test has questions is a broken client. */
export const MAX_ANSWERS_PER_REQUEST = 200;

interface EbookRow {
  num: number;
  pass_score: number;
  pdf_key: string | null;
}

interface AnswerRow {
  question_id: string;
  choice_idx: number | null;
  text_value: string | null;
}

/**
 * POST /api/ebooks/:n/download: marks it downloaded (unlocks player step 3); returns the PDF when
 * there is one. Only e-books of a published episode (ebookOpen); nothing is written otherwise.
 */
export async function download(d: LearningDeps, n: number): Promise<DownloadRes> {
  const [availability, book] = await Promise.all([
    ebookOpen(d, n),
    one<EbookRow>(
      d.db,
      `SELECT b.num, b.pass_score, m.r2_key AS pdf_key FROM ebooks b LEFT JOIN media m ON m.id = b.pdf_media
       WHERE b.num = ?`,
      n,
    ),
  ]);
  if (!book) throw fail('not_found');
  if (!availability.open) throw fail('content_unavailable');
  // Keeps the first download time.
  await run(
    d.db,
    'INSERT OR IGNORE INTO user_ebooks(user_id, ebook_num, downloaded_at) VALUES(?, ?, ?)',
    d.userId,
    n,
    d.now,
  );
  // Snapshot mode: only the published file's PDF (none when compile.ts did not ship this e-book, so an
  // unpublished PDF edit never leaks through the live row). D1 mode: the live row's.
  const pdf =
    availability.source === 'snapshot'
      ? (availability.snapshot?.pdf ?? null)
      : book.pdf_key
        ? mediaUrl(book.pdf_key)
        : null;
  return { ebook: book.num, pdf };
}

/** A snapshot test question in the D1 row shape toGradable() reads. */
function snapshotRow(x: TestQuestion): TestQuestionRow {
  return {
    id: x.id,
    n: x.n,
    opts: x.opts && x.a != null ? JSON.stringify(x.opts) : null,
    answer_idx: x.opts && x.a != null ? x.a : null,
    accept: x.acc ? JSON.stringify(x.acc) : null,
    show: x.show ?? null,
  };
}

/**
 * The e-book, its questions and the user's saved answers. Questions and the pass score come from the
 * published file in snapshot mode (restricted to the questions D1 still has, which answers reference
 * by foreign key), else from D1. An e-book no published episode belongs to is content_unavailable.
 */
async function loadTest(d: LearningDeps, n: number) {
  const [availability, [ebooks, questions, answers]] = await Promise.all([
    ebookOpen(d, n),
    batch(d.db, [
      q<EbookRow>(d.db, 'SELECT num, pass_score, NULL AS pdf_key FROM ebooks WHERE num = ?', n),
      q<TestQuestionRow>(
        d.db,
        'SELECT id, n, opts, answer_idx, accept, show FROM ebook_test_questions WHERE ebook_num = ? ORDER BY n',
        n,
      ),
      q<AnswerRow>(
        d.db,
        `SELECT a.question_id, a.choice_idx, a.text_value FROM ebook_test_answers a
         JOIN ebook_test_questions t ON t.id = a.question_id WHERE a.user_id = ? AND t.ebook_num = ?`,
        d.userId,
        n,
      ),
    ] as const),
  ]);
  const row = ebooks[0];
  if (!row) throw fail('not_found');
  if (!availability.open) throw fail('content_unavailable');

  let passScore = row.pass_score;
  let rows: TestQuestionRow[] = questions;
  if (availability.source === 'snapshot') {
    const file = availability.snapshot;
    if (!file) throw fail('content_unavailable');
    const inD1 = new Set(questions.map((x) => x.id));
    passScore = file.passScore;
    rows = file.test
      .flatMap((part) => part.qs)
      .filter((x) => inD1.has(x.id))
      .map(snapshotRow)
      .sort((a, b) => a.n - b.n);
  }
  if (!rows.length) throw fail('content_unavailable');

  const saved = new Map<string, TestAnswer>();
  for (const a of answers) {
    const v = a.choice_idx ?? a.text_value;
    if (v != null) saved.set(a.question_id, v);
  }
  return { book: { num: row.num, pass_score: passScore }, questions: rows.map(toGradable), saved };
}

/** Validates the submitted answers against the question list; null (or blank text) clears one. */
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
      out.push(q(d.db, 'DELETE FROM ebook_test_answers WHERE user_id = ? AND question_id = ?', d.userId, question.id));
      continue;
    }
    out.push(
      q(
        d.db,
        `INSERT INTO ebook_test_answers(user_id, question_id, choice_idx, text_value, correct, updated_at)
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

/**
 * PUT /api/ebooks/:n/test/answers. `reset` (testRedo) clears answers and the submitted result first.
 * KNOWN GAP (I1): the prototype's testRedo keeps testScore; here the result row goes, because S1's
 * /api/me/state derives testDone from the row's presence. Keeping the score needs both sides: reset
 * sets submitted_at = 0 (score/passed kept) and state.ts sets testDone only when submitted_at > 0.
 */
export async function saveAnswers(d: LearningDeps, n: number, body: TestAnswersBody): Promise<Ok> {
  const { questions } = await loadTest(d, n);
  const changes = normalizeAnswers(questions, body.answers);
  const writes: Query<unknown>[] = [];
  if (body.reset) {
    writes.push(
      q(
        d.db,
        `DELETE FROM ebook_test_answers WHERE user_id = ?
         AND question_id IN (SELECT id FROM ebook_test_questions WHERE ebook_num = ?)`,
        d.userId,
        n,
      ),
      q(d.db, 'DELETE FROM ebook_test_results WHERE user_id = ? AND ebook_num = ?', d.userId, n),
    );
  }
  writes.push(...answerWrites(d, changes));
  await batchRun(d.db, writes);
  return { ok: true };
}

/** POST /api/ebooks/:n/test/submit: merges `answers` over the saved ones, grades, stores the result. */
export async function submitTest(d: LearningDeps, n: number, body: TestSubmitBody): Promise<TestResult> {
  const { book, questions, saved } = await loadTest(d, n);
  const changes = normalizeAnswers(questions, body.answers ?? {});
  const merged = new Map(saved);
  for (const [question, v] of changes) {
    if (v === null) merged.delete(question.id);
    else merged.set(question.id, v);
  }

  const results = questions.map((question) => {
    const given = merged.get(question.id) ?? null;
    return { questionId: question.id, n: question.n, correct: isCorrect(question, given), given, show: question.show };
  });
  const score = results.filter((r) => r.correct).length;
  const passed = score >= book.pass_score;

  await batchRun(d.db, [
    ...answerWrites(d, changes),
    q(
      d.db,
      `INSERT INTO ebook_test_results(user_id, ebook_num, score, passed, submitted_at) VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(user_id, ebook_num) DO UPDATE SET score = excluded.score, passed = excluded.passed,
         submitted_at = excluded.submitted_at`,
      d.userId,
      n,
      score,
      passed,
      d.now,
    ),
  ]);

  const award = passed ? await d.award.award(d.userId, 'test_pass', `test_pass:${n}`, { now: d.now }) : null;
  return { ebook: book.num, score, total: questions.length, passScore: book.pass_score, passed, results, award };
}
