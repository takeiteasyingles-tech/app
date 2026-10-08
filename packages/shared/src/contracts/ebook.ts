import { z } from 'zod';
import { TestAnswer } from '../state';
import { NumParams, Ok } from './common';
import { AwardResult } from './game';
import { endpoint } from './http';

export const EbookParams = NumParams;

export const DownloadRes = z.object({
  ebook: z.int().positive(),
  /** Real PDF when the e-book has one in R2; the step unlocks either way. */
  pdf: z.string().nullable(),
});
export type DownloadRes = z.infer<typeof DownloadRes>;

/** Answers keyed by question id; null clears one. `reset` (testRedo) clears answers and the done flag. */
export const TestAnswersBody = z.object({
  answers: z.record(z.string().max(40), TestAnswer.nullable()),
  reset: z.boolean().optional(),
});
export type TestAnswersBody = z.infer<typeof TestAnswersBody>;

/** `answers` here are merged over the saved ones before grading. */
export const TestSubmitBody = z.object({
  answers: z.record(z.string().max(40), TestAnswer.nullable()).optional(),
});
export type TestSubmitBody = z.infer<typeof TestSubmitBody>;

export const TestQuestionResult = z.object({
  questionId: z.string(),
  n: z.int().positive(),
  correct: z.boolean(),
  given: TestAnswer.nullable(),
  /** Right answer as shown on the result card ("CERTO"). */
  show: z.string(),
});
export type TestQuestionResult = z.infer<typeof TestQuestionResult>;

/** Typed answers are graded with acc.includes(norm(v)); passing awards test_pass once. */
export const TestResult = z.object({
  ebook: z.int().positive(),
  score: z.int().min(0),
  total: z.int().positive(),
  passScore: z.int().min(0),
  passed: z.boolean(),
  results: z.array(TestQuestionResult),
  award: AwardResult.nullable(),
});
export type TestResult = z.infer<typeof TestResult>;

export const ebookApi = {
  download: endpoint({
    method: 'POST',
    path: '/api/ebooks/:n/download',
    access: 'user',
    params: EbookParams,
    res: DownloadRes,
    rateLimit: 'RL_API',
  }),
  testAnswers: endpoint({
    method: 'PUT',
    path: '/api/ebooks/:n/test/answers',
    access: 'user',
    params: EbookParams,
    body: TestAnswersBody,
    res: Ok,
    rateLimit: 'RL_API',
  }),
  testSubmit: endpoint({
    method: 'POST',
    path: '/api/ebooks/:n/test/submit',
    access: 'user',
    params: EbookParams,
    body: TestSubmitBody,
    res: TestResult,
    rateLimit: 'RL_API',
  }),
} as const;
