import { z } from 'zod';
import { IdParams, IdString } from './common';
import { AwardResult } from './game';
import { endpoint } from './http';
import { MIC_ATTEMPT_MAX, MicScoreSource } from './progress';

/** finishScene: seen + lastId; awards `extra` once per id. */
export const ExtraSeenRes = z.object({ seen: z.literal(true), lastId: z.string(), award: AwardResult.nullable() });
export type ExtraSeenRes = z.infer<typeof ExtraSeenRes>;

/**
 * One dubbed line: updates the running average and awards `dub`. The spec's award key is dub:{id};
 * the copy says "+10 por fala", so `line` is sent in case the key becomes per line.
 * source 'ia' must carry `attempt`, the server-signed token /api/pronounce returned for
 * phraseId `${extraId}:${line}` (PronounceResult.attempt) with this exact score.
 */
export const DubBody = z.object({
  score: z.int().min(0).max(10),
  source: MicScoreSource,
  line: z.int().min(0).max(500),
  attempt: z.string().min(1).max(MIC_ATTEMPT_MAX).optional(),
});
export type DubBody = z.infer<typeof DubBody>;

export const DubRes = z.object({ avg: z.number(), count: z.int().min(1), award: AwardResult.nullable() });
export type DubRes = z.infer<typeof DubRes>;

/** Desafio end: updates the record; awards ex_right once when hits ≥ 5. */
export const ChallengeBody = z.object({
  score: z.int().min(0).max(100_000),
  hits: z.int().min(0).max(1000),
  extraId: IdString.optional(),
});
export type ChallengeBody = z.infer<typeof ChallengeBody>;

export const ChallengeRes = z.object({ best: z.int().min(0), newRecord: z.boolean(), award: AwardResult.nullable() });
export type ChallengeRes = z.infer<typeof ChallengeRes>;

/** Karaoke gap pick, graded on the server; a right pick awards ex_right (kgap:{track}:{line}). */
export const KaraokeGapBody = z.object({
  trackId: IdString,
  line: z.int().min(0).max(500),
  choice: z.string().min(1).max(80),
});
export type KaraokeGapBody = z.infer<typeof KaraokeGapBody>;

export const KaraokeGapRes = z.object({ correct: z.boolean(), answer: z.string(), award: AwardResult.nullable() });
export type KaraokeGapRes = z.infer<typeof KaraokeGapRes>;

export const extrasApi = {
  seen: endpoint({
    method: 'POST',
    path: '/api/extras/:id/seen',
    access: 'user',
    params: IdParams,
    res: ExtraSeenRes,
    rateLimit: 'RL_API',
  }),
  dub: endpoint({
    method: 'POST',
    path: '/api/extras/:id/dub',
    access: 'user',
    params: IdParams,
    body: DubBody,
    res: DubRes,
    rateLimit: 'RL_API',
  }),
  challenge: endpoint({
    method: 'POST',
    path: '/api/extras/challenge',
    access: 'user',
    body: ChallengeBody,
    res: ChallengeRes,
    rateLimit: 'RL_API',
  }),
  karaokeGap: endpoint({
    method: 'POST',
    path: '/api/karaoke/gap',
    access: 'user',
    body: KaraokeGapBody,
    res: KaraokeGapRes,
    rateLimit: 'RL_API',
  }),
} as const;
