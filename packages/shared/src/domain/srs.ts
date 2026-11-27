import { STEP } from '../constants';
import type { AwayExp, Bilingual } from '../content/schema';
import type { TieState } from '../state';

// prototipo/js/core/review.js. The deck grows from what the student already did: a finished
// step 4 (Take a Look) adds the scene words, step 8 (Take Away) the key expressions. Fixed
// intervals: De novo goes to the back of the queue, Difícil 10 min, Bom 2 days, Fácil 5 days.

const MIN = 60_000;
const DAY = 86_400_000;

/** [label, hint, interval ms]. */
export const GRADES: readonly (readonly [string, string, number])[] = [
  ['De novo', '< 1 min', 0],
  ['Difícil', '10 min', 10 * MIN],
  ['Bom', '2 dias', 2 * DAY],
  ['Fácil', '5 dias', 5 * DAY],
];

export interface SrsEpisode {
  num: number;
  visual?: readonly Bilingual[];
  awayExp?: readonly AwayExp[];
}

export interface UnlockedCard {
  en: string;
  pt: string;
  scene: string;
  note?: string;
}

/** Step whose completion unlocks cards → the cards it unlocks. */
export const SRS_UNLOCKS: readonly (readonly [number, (e: SrsEpisode) => UnlockedCard[]])[] = [
  [STEP.LOOK, (e) => (e.visual || []).map((x) => ({ en: x.en, pt: x.pt, scene: `Ep. ${e.num} · Take a Look` }))],
  [
    STEP.AWAY,
    (e) =>
      (e.awayExp || []).map((x) => ({ en: x.en, pt: x.pt, note: x.note || '', scene: `Ep. ${e.num} · Take Away` })),
  ],
];

/** Steps already completed count as "reached": prog holds the furthest step, a done episode is past the last. */
export function reached(s: Pick<TieState, 'epsDone' | 'prog'>, num: number): number {
  return s.epsDone[num] ? STEP.LAST + 1 : s.prog[num] || 1;
}

/** Cards unlocked by steps before `upTo` (default: all). */
export function cardsOf(e: SrsEpisode, upTo?: number): UnlockedCard[] {
  return SRS_UNLOCKS.filter(([n]) => n < (upTo || STEP.LAST + 1)).flatMap(([, f]) => f(e));
}

type Due = { at?: number | null };

/** Cards due at `now`, oldest first. */
export function queue<C extends Due>(deck: readonly C[], now: number): C[] {
  return deck.filter((c) => (c.at || 0) <= now).sort((a, b) => (a.at || 0) - (b.at || 0));
}

/**
 * PROD (spec 05 "Cards: Já sei / Não sei"): the Cards screen asks only "Não sei" (NOT_KNOWN: the card
 * leaves today's queue and comes back in notKnownDays(), by how complex it is) or "Já sei" (KNOWN: the
 * card leaves the reviews for good). A known card keeps its row and is due at KNOWN_AT, past any real
 * schedule (year 2286), so no queue, due count or "próxima volta" ever reaches it. Grades 0-3 keep the
 * prototype's GRADES (older clients still send them).
 */
export const KNOWN = 4;
export const NOT_KNOWN = 5;
export const KNOWN_AT = 9_999_999_999_999;

/** A card answered "Já sei". */
export const isKnown = (c: Due): boolean => (c.at || 0) >= KNOWN_AT;

/**
 * Days a "Não sei" card waits, by its complexity (words in the English side): a longer sentence (5+
 * words) is the hardest and comes back soonest, in 2 days; an expression (2-4 words) in 3; a single
 * word in 4.
 */
export function notKnownDays(en: string): number {
  const words = String(en || '')
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  if (words >= 5) return 2;
  if (words >= 2) return 3;
  return 4;
}

/** New schedule after grading with GRADES[i], KNOWN or NOT_KNOWN; null for an unknown grade. */
export function gradeCard(
  card: { reps?: number | null; en?: string | null },
  i: number,
  now: number,
): { at: number; reps: number } | null {
  if (i === KNOWN) return { at: KNOWN_AT, reps: (card.reps || 0) + 1 };
  if (i === NOT_KNOWN) return { at: now + notKnownDays(card.en ?? '') * DAY, reps: (card.reps || 0) + 1 };
  const g = GRADES[i];
  if (!g) return null;
  return { at: now + g[2], reps: (card.reps || 0) + 1 };
}

/**
 * When the next card comes back, as text: "em 10 min", "em 3 h", "amanhã", "em 2 dias"; '' when none
 * will (no cards, or every card is known).
 */
export function nextIn(deck: readonly Due[], now: number): string {
  const at = deck.reduce((m, c) => (isKnown(c) ? m : Math.min(m, c.at || 0)), Number.POSITIVE_INFINITY);
  const d = at - now;
  if (!Number.isFinite(at)) return '';
  if (d < 60 * MIN) return `em ${Math.max(1, Math.ceil(d / MIN))} min`;
  if (d < DAY) return `em ${Math.ceil(d / (60 * MIN))} h`;
  const n = Math.ceil(d / DAY);
  return n === 1 ? 'amanhã' : `em ${n} dias`;
}
