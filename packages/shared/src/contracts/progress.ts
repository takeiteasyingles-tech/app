import { z } from 'zod';
import { AiSource } from './ai';
import { IdString } from './common';
import { AwardResult } from './game';
import { endpoint } from './http';

const EpNum = z.int().positive().max(1000);
const StepN = z.int().min(1).max(10);

/**
 * Client-attested step events (audio/video ended, dialogue finished): mark(n) in the prototype.
 * step 10 also awards `song` (song:{ep}).
 */
export const StepOkBody = z.object({ ep: EpNum, step: StepN });
export type StepOkBody = z.infer<typeof StepOkBody>;

export const StepOkRes = z.object({ stepOk: z.string(), award: AwardResult.nullable() });
export type StepOkRes = z.infer<typeof StepOkRes>;

/**
 * setStep(n): move to `step`. The server runs the shared need() for the step being left and answers
 * 409 `gated` with the need() message when it is not satisfied. Moving past `prog` awards `step`;
 * leaving step 4 / 8 unlocks the visual / awayExp cards.
 */
export const AdvanceBody = z.object({ ep: EpNum, step: StepN });
export type AdvanceBody = z.infer<typeof AdvanceBody>;

export const AdvanceRes = z.object({
  prog: StepN,
  cardsAdded: z.int().min(0),
  award: AwardResult.nullable(),
});
export type AdvanceRes = z.infer<typeof AdvanceRes>;

/** plNext on step 10: prog = 10, epsDone, award `episode`. */
export const EpisodeDoneBody = z.object({ ep: EpNum });
export type EpisodeDoneBody = z.infer<typeof EpisodeDoneBody>;

export const EpisodeDoneRes = z.object({
  epsDone: z.literal(true),
  cardsAdded: z.int().min(0),
  award: AwardResult.nullable(),
});
export type EpisodeDoneRes = z.infer<typeof EpisodeDoneRes>;

/** First answer per item is final (options lock); a replay returns the stored answer. */
export const ExerciseBody = z.object({ itemId: IdString, choice: z.int().min(0).max(3) });
export type ExerciseBody = z.infer<typeof ExerciseBody>;

export const ExerciseRes = z.object({
  itemId: z.string(),
  choice: z.int().min(0),
  correct: z.boolean(),
  answer: z.int().min(0),
  fix: z.string().nullable(),
  award: AwardResult.nullable(),
});
export type ExerciseRes = z.infer<typeof ExerciseRes>;

/** 'script' = no microphone, the phrase's scripted demo result was used. */
export const MicScoreSource = z.enum([...AiSource.options, 'script']);
export type MicScoreSource = z.infer<typeof MicScoreSource>;

/** Upper bound for the signed attempt token issued by /api/pronounce (PronounceResult.attempt). */
export const MIC_ATTEMPT_MAX = 600;

/**
 * Take the Mic score: awards mic_good (score ≥ 8) or mic_try, once per phrase each.
 * source 'ia' must carry `attempt`, the server-signed token from /api/pronounce (its score wins over
 * `score`); 'demo' and 'script' scores are recorded but only ever award mic_try.
 */
export const MicScoreBody = z.object({
  phraseId: IdString,
  score: z.int().min(0).max(10),
  source: MicScoreSource,
  attempt: z.string().min(1).max(MIC_ATTEMPT_MAX).optional(),
});
export type MicScoreBody = z.infer<typeof MicScoreBody>;

export const MicScoreRes = z.object({
  phraseId: z.string(),
  last: z.int().min(0).max(10),
  best: z.int().min(0).max(10),
  attempts: z.int().min(1),
  award: AwardResult.nullable(),
});
export type MicScoreRes = z.infer<typeof MicScoreRes>;

export const progressApi = {
  stepOk: endpoint({
    method: 'POST',
    path: '/api/progress/step-ok',
    access: 'user',
    body: StepOkBody,
    res: StepOkRes,
    rateLimit: 'RL_API',
  }),
  advance: endpoint({
    method: 'POST',
    path: '/api/progress/advance',
    access: 'user',
    body: AdvanceBody,
    res: AdvanceRes,
    rateLimit: 'RL_API',
  }),
  episodeDone: endpoint({
    method: 'POST',
    path: '/api/progress/episode-done',
    access: 'user',
    body: EpisodeDoneBody,
    res: EpisodeDoneRes,
    rateLimit: 'RL_API',
  }),
  exercise: endpoint({
    method: 'POST',
    path: '/api/progress/exercise',
    access: 'user',
    body: ExerciseBody,
    res: ExerciseRes,
    rateLimit: 'RL_API',
  }),
  mic: endpoint({
    method: 'POST',
    path: '/api/progress/mic',
    access: 'user',
    body: MicScoreBody,
    res: MicScoreRes,
    rateLimit: 'RL_API',
  }),
} as const;
