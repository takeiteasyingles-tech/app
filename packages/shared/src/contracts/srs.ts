import { z } from 'zod';
import { LIMITS } from '../constants';
import { DeckCard } from '../state';
import { IdParams } from './common';
import { AwardResult } from './game';
import { endpoint } from './http';

/** srs_cards.source. Episode cards are created by the server on advance (steps 4 and 8). */
export const CardSource = z.enum(['ep_visual', 'ep_away', 'extra', 'mic', 'report']);
export type CardSource = z.infer<typeof CardSource>;

export const SrsQueueRes = z.object({
  /** Due now, oldest first. */
  cards: z.array(DeckCard),
  due: z.int().min(0),
  total: z.int().min(0),
  /** Next due time across the whole deck (for "próximo volta {nextIn}"). */
  nextAt: z.int().nullable(),
});
export type SrsQueueRes = z.infer<typeof SrsQueueRes>;

export const NewCard = z.object({
  en: z.string().min(1).max(300),
  pt: z.string().max(300),
  scene: z.string().max(120),
  note: z.string().max(300).optional(),
  source: CardSource.exclude(['ep_visual', 'ep_away']),
});
export type NewCard = z.infer<typeof NewCard>;

/** Dedup by norm(en): cards already in the deck are skipped. */
export const AddCardsBody = z.object({ cards: z.array(NewCard).min(1).max(LIMITS.srsCardsBatchMax) });
export type AddCardsBody = z.infer<typeof AddCardsBody>;

export const AddCardsRes = z.object({
  added: z.array(DeckCard),
  skipped: z.int().min(0),
  due: z.int().min(0),
});
export type AddCardsRes = z.infer<typeof AddCardsRes>;

/** Index into catalog.srs.grades: 0 De novo, 1 Difícil, 2 Bom, 3 Fácil. Awards `card`. */
export const GradeBody = z.object({ grade: z.int().min(0).max(3) });
export type GradeBody = z.infer<typeof GradeBody>;

export const GradeRes = z.object({ card: DeckCard, due: z.int().min(0), award: AwardResult.nullable() });
export type GradeRes = z.infer<typeof GradeRes>;

export const srsApi = {
  queue: endpoint({ method: 'GET', path: '/api/srs/queue', access: 'user', res: SrsQueueRes }),
  addCards: endpoint({
    method: 'POST',
    path: '/api/srs/cards',
    access: 'user',
    body: AddCardsBody,
    res: AddCardsRes,
    rateLimit: 'RL_API',
  }),
  grade: endpoint({
    method: 'POST',
    path: '/api/srs/cards/:id/grade',
    access: 'owner',
    params: IdParams,
    body: GradeBody,
    res: GradeRes,
    rateLimit: 'RL_API',
  }),
} as const;
