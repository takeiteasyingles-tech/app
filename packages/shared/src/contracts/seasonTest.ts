import { z } from 'zod';
import { LIMITS } from '../constants';
import { SeasonTestState, TestAnswer } from '../state';
import { CertificateSummary } from './certificates';
import { IdString, NumParams, Timestamp } from './common';
import { TestAnswersBody, TestSubmitBody } from './ebook';
import { AwardResult } from './game';
import { endpoint } from './http';

// Season test (spec 07, feature B). One test per season, open once every PUBLISHED episode of the
// season is done. Questions are drafted by AI (or by an agent over MCP, or typed by staff) and only
// APPROVED ones reach learners. The test is served live from D1 (not part of a content release), and
// the answer key never leaves the server: learners get questions without answers, the grade comes
// from POST submit. Grading mirrors the e-book test: a choice question is right when the index
// matches; a typed one when accept (stored normalized) includes norm(given).

export const SeasonParams = NumParams;

export const SeasonTestQuestionStatus = z.enum(['draft', 'approved', 'rejected']);
export type SeasonTestQuestionStatus = z.infer<typeof SeasonTestQuestionStatus>;

/** ai: Workers AI draft endpoint. agent: MCP API token. staff: typed in the admin. */
export const SeasonTestQuestionSource = z.enum(['ai', 'agent', 'staff']);
export type SeasonTestQuestionSource = z.infer<typeof SeasonTestQuestionSource>;

// ---------- Student (tie-app) ----------

/** A question as learners see it: no answer index, no accepted answers, no `show`, no `rev`. */
export const SeasonTestQuestionPublic = z.object({
  id: z.string(),
  sort: z.int(),
  partTitle: z.string(),
  q: z.string(),
  kind: z.enum(['choice', 'typed']),
  /** Options of a choice question; null for a typed one. */
  opts: z.array(z.string()).nullable(),
  /** Text spoken by the audio button (TTS), if any. */
  audio: z.string().nullable(),
  /** Episode the question reviews, if any. */
  epNum: z.int().positive().nullable(),
});
export type SeasonTestQuestionPublic = z.infer<typeof SeasonTestQuestionPublic>;

/**
 * GET /api/seasons/:n/test. 404 not_found for an unknown season. While the test is unpublished or
 * locked, `questions` is empty and the screen shows why (published / episodes.missing).
 */
export const SeasonTestView = z.object({
  season: z.object({ n: z.int().positive(), title: z.string(), synopsis: z.string().nullable() }),
  published: z.boolean(),
  /** Every published episode of the season is done (domain/season seasonTestUnlocked). */
  unlocked: z.boolean(),
  episodes: z.object({
    /** Published episode numbers of the season, ascending. */
    published: z.array(z.int().positive()),
    /** Those not done yet. */
    missing: z.array(z.int().positive()),
  }),
  passPct: z.int().min(0).max(100),
  questions: z.array(SeasonTestQuestionPublic),
  /** Saved answers by question id. */
  answers: z.record(z.string(), TestAnswer),
  result: SeasonTestState.nullable(),
  certificate: CertificateSummary.nullable(),
});
export type SeasonTestView = z.infer<typeof SeasonTestView>;

/** Answers keyed by question id; null clears one. `reset` starts a redo (clears answers, submitted_at = 0). */
export const SeasonTestAnswersBody = TestAnswersBody;
export type SeasonTestAnswersBody = z.infer<typeof SeasonTestAnswersBody>;

/** `answers` are merged over the saved ones before grading. */
export const SeasonTestSubmitBody = TestSubmitBody;
export type SeasonTestSubmitBody = z.infer<typeof SeasonTestSubmitBody>;

export const SeasonTestQuestionResult = z.object({
  questionId: z.string(),
  correct: z.boolean(),
  given: TestAnswer.nullable(),
  /** Right answer as shown on the review card (`show`, else the right option / first accepted answer). */
  show: z.string(),
  /** Where to review it, e.g. "Ep. 3 · Lição". */
  rev: z.string().nullable(),
});
export type SeasonTestQuestionResult = z.infer<typeof SeasonTestQuestionResult>;

/**
 * POST /api/seasons/:n/test/submit. 404 content_unavailable while unpublished, 409 gated while
 * locked. Passing (scorePct ≥ passPct) awards season_pass:{n} once and issues the certificate once
 * (same D1 batch); `certificate` is the learner's certificate for the season whenever one exists.
 */
export const SeasonTestResult = z.object({
  season: z.int().positive(),
  score: z.int().min(0),
  total: z.int().min(0),
  scorePct: z.int().min(0).max(100),
  passPct: z.int().min(0).max(100),
  passed: z.boolean(),
  attempts: z.int().min(1),
  results: z.array(SeasonTestQuestionResult),
  award: AwardResult.nullable(),
  certificate: CertificateSummary.nullable(),
});
export type SeasonTestResult = z.infer<typeof SeasonTestResult>;

export const seasonsApi = {
  test: endpoint({
    method: 'GET',
    path: '/api/seasons/:n/test',
    access: 'user',
    params: SeasonParams,
    res: SeasonTestView,
  }),
  testAnswers: endpoint({
    method: 'PUT',
    path: '/api/seasons/:n/test/answers',
    access: 'user',
    params: SeasonParams,
    body: SeasonTestAnswersBody,
    res: z.object({ ok: z.literal(true) }),
    rateLimit: 'RL_API',
  }),
  testSubmit: endpoint({
    method: 'POST',
    path: '/api/seasons/:n/test/submit',
    access: 'user',
    params: SeasonParams,
    body: SeasonTestSubmitBody,
    res: SeasonTestResult,
    rateLimit: 'RL_API',
  }),
} as const;

// ---------- Admin (tie-admin) ----------

export const SeasonTestQuestionRow = z.object({
  id: z.string(),
  seasonN: z.int().positive(),
  sort: z.int(),
  partTitle: z.string(),
  q: z.string(),
  opts: z.array(z.string()).nullable(),
  answerIdx: z.int().min(0).nullable(),
  /** Accepted typed answers, stored normalized with norm(). */
  accept: z.array(z.string()).nullable(),
  show: z.string().nullable(),
  audio: z.string().nullable(),
  rev: z.string().nullable(),
  epNum: z.int().positive().nullable(),
  status: SeasonTestQuestionStatus,
  source: SeasonTestQuestionSource,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  updatedBy: z.string().nullable(),
});
export type SeasonTestQuestionRow = z.infer<typeof SeasonTestQuestionRow>;

const Line = (max: number) => z.string().trim().min(1).max(max);
const OptText = (max: number) => z.string().trim().max(max).nullable();

/** Editable fields without defaults (a zod default would survive .partial() and overwrite on patch). */
const questionShape = {
  sort: z.int().min(0).max(9999),
  partTitle: z.string().trim().max(120),
  q: Line(LIMITS.seasonTestQuestionMax),
  opts: z.array(Line(LIMITS.seasonTestOptionMax)).min(2).max(6).nullable(),
  answerIdx: z.int().min(0).max(5).nullable(),
  /** Normalized with norm() by the server before storing; blanks dropped. */
  accept: z.array(Line(200)).min(1).max(20).nullable(),
  show: OptText(300),
  audio: OptText(LIMITS.ttsTextMax),
  rev: OptText(300),
  epNum: z.int().positive().nullable(),
};

/**
 * Editable fields of a question (strict), as a create body: only `q` (and an answer) is required;
 * `sort` absent appends it at the end. Status and source are not editable here: the server sets the
 * source, and status changes go through `review`.
 */
export const SeasonTestQuestionFields = z.strictObject({
  ...questionShape,
  sort: questionShape.sort.optional(),
  partTitle: questionShape.partTitle.default(''),
  opts: questionShape.opts.default(null),
  answerIdx: questionShape.answerIdx.default(null),
  accept: questionShape.accept.default(null),
  show: questionShape.show.default(null),
  audio: questionShape.audio.default(null),
  rev: questionShape.rev.default(null),
  epNum: questionShape.epNum.default(null),
});
export type SeasonTestQuestionFields = z.infer<typeof SeasonTestQuestionFields>;

export interface QuestionIssue {
  path: string;
  code: string;
  message: string;
}

/**
 * Cross-field rules (pt-BR messages), for a create body and for a patch merged over the stored row:
 * a choice question (opts + answerIdx, answerIdx inside opts) or a typed one (accept), or both.
 */
export function seasonTestQuestionIssues(q: {
  opts?: readonly string[] | null;
  answerIdx?: number | null;
  accept?: readonly string[] | null;
}): QuestionIssue[] {
  const out: QuestionIssue[] = [];
  const opts = q.opts ?? null;
  const idx = q.answerIdx ?? null;
  if ((opts === null) !== (idx === null)) {
    out.push({ path: 'answerIdx', code: 'pair', message: 'Opções e resposta certa andam juntas.' });
  }
  if (opts === null && !(q.accept && q.accept.length > 0)) {
    out.push({
      path: 'opts',
      code: 'required',
      message: 'A questão precisa de opções com resposta, ou de respostas aceitas.',
    });
  }
  if (opts !== null && idx !== null && idx >= opts.length) {
    out.push({
      path: 'answerIdx',
      code: 'out_of_range',
      message: `A resposta certa precisa ser uma das ${opts.length} opções.`,
    });
  }
  return out;
}

const withQuestionRules = <
  T extends z.ZodType<{ opts: string[] | null; answerIdx: number | null; accept: string[] | null }>,
>(
  schema: T,
) =>
  schema.superRefine((v, ctx) => {
    for (const i of seasonTestQuestionIssues(v)) ctx.addIssue({ code: 'custom', path: [i.path], message: i.message });
  });

/** Create body (strict, with the cross-field rules). */
export const SeasonTestQuestionInput = withQuestionRules(SeasonTestQuestionFields);
export type SeasonTestQuestionInput = z.infer<typeof SeasonTestQuestionInput>;

/**
 * Update body: any subset of the fields, no defaults (absent keys keep the stored value). Merge over
 * the stored row, then check seasonTestQuestionIssues().
 */
export const SeasonTestQuestionPatch = z.strictObject(questionShape).partial();
export type SeasonTestQuestionPatch = z.infer<typeof SeasonTestQuestionPatch>;

export const SeasonQuestionParams = z.object({ n: z.coerce.number().int().positive(), id: IdString });

export const SeasonTestConfig = z.object({
  n: z.int().positive(),
  title: z.string(),
  passPct: z.int().min(0).max(100),
  questionCount: z.int().min(1).max(100),
  published: z.boolean(),
  publishedAt: Timestamp.nullable(),
  publishedBy: z.string().nullable(),
});
export type SeasonTestConfig = z.infer<typeof SeasonTestConfig>;

export const SeasonTestAdminQuery = z.object({ status: SeasonTestQuestionStatus.optional() });

export const SeasonTestAdmin = z.object({
  season: SeasonTestConfig,
  counts: z.object({ draft: z.int().min(0), approved: z.int().min(0), rejected: z.int().min(0) }),
  /**
   * Why publishing would be refused right now (pt-BR, empty when it can be published): fewer approved
   * questions than questionCount, or no published episode in the season.
   */
  publishProblems: z.array(z.string()),
  /** By sort, then id. */
  questions: z.array(SeasonTestQuestionRow),
});
export type SeasonTestAdmin = z.infer<typeof SeasonTestAdmin>;

/** Bulk status change (approve / reject / back to draft). Unknown ids or ids of another season → 404. */
export const SeasonTestReviewBody = z.strictObject({
  ids: z.array(IdString).min(1).max(LIMITS.seasonTestQuestionsMax),
  status: SeasonTestQuestionStatus,
});
export type SeasonTestReviewBody = z.infer<typeof SeasonTestReviewBody>;

/**
 * AI draft: writes `count` new questions with status 'draft', source 'ai', built from the season's
 * PUBLISHED episodes (or the listed ones). Without the AI binding, or when the call fails, the
 * demo generator drafts from the episodes' vocabulary instead and `source` says 'demo'.
 */
export const SeasonTestDraftBody = z.strictObject({
  /** Default: min(seasons.test_question_count, LIMITS.seasonTestDraftMax). */
  count: z.int().min(1).max(LIMITS.seasonTestDraftMax).optional(),
  /** Limit to these episodes of the season (default: every published one). */
  episodes: z.array(z.int().positive()).min(1).max(40).optional(),
  /** Extra guidance for the AI, pt-BR. */
  instructions: z.string().trim().max(LIMITS.seasonTestInstructionsMax).optional(),
  partTitle: z.string().trim().max(120).optional(),
});
export type SeasonTestDraftBody = z.infer<typeof SeasonTestDraftBody>;

export const SeasonTestDraftRes = z.object({
  items: z.array(SeasonTestQuestionRow),
  source: z.enum(['ia', 'demo']),
});
export type SeasonTestDraftRes = z.infer<typeof SeasonTestDraftRes>;

/** published: true → 409 conflict with publishProblems in details while it cannot be published. */
export const SeasonTestPublishBody = z.strictObject({ published: z.boolean() });

const base = '/admin-api/seasons/:n/test' as const;

export const adminSeasonTestApi = {
  get: endpoint({
    method: 'GET',
    path: base,
    access: 'staff',
    perm: 'content.edit',
    params: SeasonParams,
    query: SeasonTestAdminQuery,
    res: SeasonTestAdmin,
  }),
  create: endpoint({
    method: 'POST',
    path: `${base}/questions`,
    access: 'staff',
    perm: 'content.edit',
    params: SeasonParams,
    body: SeasonTestQuestionInput,
    res: z.object({ item: SeasonTestQuestionRow }),
  }),
  /** Staff edits keep the status; an edit through MCP sends the question back to 'draft'. */
  update: endpoint({
    method: 'PUT',
    path: `${base}/questions/:id`,
    access: 'staff',
    perm: 'content.edit',
    params: SeasonQuestionParams,
    body: SeasonTestQuestionPatch,
    res: z.object({ item: SeasonTestQuestionRow }),
  }),
  /** 409 in_use when learners have answered it: reject it instead. */
  remove: endpoint({
    method: 'DELETE',
    path: `${base}/questions/:id`,
    access: 'staff',
    perm: 'content.edit',
    params: SeasonQuestionParams,
    res: z.object({ ok: z.literal(true) }),
  }),
  review: endpoint({
    method: 'POST',
    path: `${base}/review`,
    access: 'staff',
    perm: 'content.edit',
    params: SeasonParams,
    body: SeasonTestReviewBody,
    res: z.object({ items: z.array(SeasonTestQuestionRow) }),
  }),
  draft: endpoint({
    method: 'POST',
    path: `${base}/draft`,
    access: 'staff',
    perm: 'content.edit',
    params: SeasonParams,
    body: SeasonTestDraftBody,
    res: SeasonTestDraftRes,
    rateLimit: 'RL_AI',
  }),
  publish: endpoint({
    method: 'POST',
    path: `${base}/publish`,
    access: 'staff',
    perm: 'content.publish',
    params: SeasonParams,
    body: SeasonTestPublishBody,
    res: z.object({ season: SeasonTestConfig }),
  }),
} as const;
