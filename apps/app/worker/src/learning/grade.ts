import { norm, type TestAnswer } from '@tie/shared';
import { fromJson } from '@tie/worker-core';

// E-book test grading, server side (curso.js testSubmit): a multiple-choice question is right when
// the chosen index equals answer_idx; a typed one when acc.includes(norm(v)).

export interface TestQuestionRow {
  id: string;
  n: number;
  opts: string | null;
  answer_idx: number | null;
  accept: string | null;
  show: string | null;
}

export interface GradableQuestion {
  id: string;
  n: number;
  /** Multiple choice when present (with `answer`), as `q.opts ? … : …` in the prototype. */
  opts: string[] | null;
  answer: number | null;
  /** Accepted typed answers, normalized with the shared norm(). */
  acc: string[];
  show: string;
}

export function toGradable(row: TestQuestionRow): GradableQuestion {
  const opts = fromJson<unknown>(row.opts, null);
  const acc = fromJson<unknown>(row.accept, []);
  const optList = Array.isArray(opts) && row.answer_idx != null ? opts.map(String) : null;
  const accList = Array.isArray(acc) ? acc.map((a) => norm(a)).filter(Boolean) : [];
  const show = row.show ?? (optList ? (optList[row.answer_idx ?? 0] ?? '') : (accList[0] ?? ''));
  return { id: row.id, n: row.n, opts: optList, answer: optList ? row.answer_idx : null, acc: accList, show };
}

export type AnswerCheck = { ok: true; value: TestAnswer } | { ok: false; reason: string };

/**
 * Shape check for a stored answer: an option index in range for multiple choice, text for typed
 * questions. Typed text is trimmed; blank text means "no answer" (value null is handled by callers).
 */
export function checkAnswer(q: GradableQuestion, v: TestAnswer): AnswerCheck {
  if (q.opts) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= q.opts.length) {
      return { ok: false, reason: `expected an option index 0..${q.opts.length - 1}` };
    }
    return { ok: true, value: v };
  }
  if (typeof v !== 'string') return { ok: false, reason: 'expected a typed answer' };
  return { ok: true, value: v.trim() };
}

export function isCorrect(q: GradableQuestion, v: TestAnswer | null | undefined): boolean {
  if (v == null) return false;
  if (q.opts) return v === q.answer;
  if (typeof v !== 'string') return false;
  const k = norm(v);
  return k !== '' && q.acc.includes(k);
}
