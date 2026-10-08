import type { AddCardsRes, DeckCard, GradeRes, NewCard } from '@tie/shared';
import { NotImplementedError } from '../errors';

/** Spaced repetition (slice S5). Cards dedupe by norm(en) per user (srs_cards UNIQUE(user_id, norm_key)). */
export interface SrsService {
  /** Creates the episode's cards unlocked by finishing `step` (4 → visual, 8 → away words). */
  unlock(userId: string, episode: number, step: number): Promise<DeckCard[]>;
  add(userId: string, cards: readonly NewCard[]): Promise<AddCardsRes>;
  /** grade is an index into catalog.srs.grades (0 De novo … 3 Fácil); awards `card` points. */
  grade(userId: string, cardId: string, grade: number): Promise<GradeRes>;
}

const notImplemented = (what: string) => Promise.reject(new NotImplementedError(`SrsService.${what} (slice S5)`));

export const srsServiceStub: SrsService = {
  unlock: () => notImplemented('unlock'),
  add: () => notImplemented('add'),
  grade: () => notImplemented('grade'),
};
