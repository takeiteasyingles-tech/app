// S5 SRS: SrsService over srs_cards (prototipo/js/core/review.js).
// The deck grows from finished steps (4 → Take a Look words, 8 → Take Away expressions) and from words
// the student saves (Extras, Mic, report). Cards dedupe by norm(en) per user through the
// UNIQUE(user_id, norm_key) index, so every insert is INSERT OR IGNORE and replays are harmless.
// Grading uses the fixed GRADES intervals: De novo → due now (back of the queue), Difícil 10 min,
// Bom 2 days, Fácil 5 days; reps++ and `card` points once per card per local day, only when the card
// was due. Manual adds are capped (SRS_DECK_MAX, SRS_MANUAL_ADDS_PER_DAY).
import {
  type AddCardsRes,
  type AwardResult,
  type CardSource,
  type DeckCard,
  type GradeRes,
  gradeCard,
  type NewCard,
  newId,
  nextIn as nextInText,
  norm,
  type PointKind,
  SRS_UNLOCKS,
  type SrsEpisode,
  type SrsQueueRes,
  type UnlockedCard,
} from '@tie/shared';
import {
  type AwardMeta,
  type AwardService,
  batch,
  type Env,
  fail,
  fromJson,
  localDate,
  NotImplementedError,
  one,
  type Query,
  q,
  type Services,
  type SrsService,
} from '@tie/worker-core';

/** Upper bound on cards returned by one queue read (`due` still counts all of them). */
export const SRS_QUEUE_MAX = 500;

/**
 * Deck size cap per user. Episode unlocks are bounded by content (~15 cards per episode) and always
 * go in; manual adds stop once the deck holds this many cards.
 */
export const SRS_DECK_MAX = 3000;

/** Manual cards (extras, mic, report) a user can add in any rolling 24 h. */
export const SRS_MANUAL_ADDS_PER_DAY = 200;

const DAY_MS = 86_400_000;

/** Rejection copy when a manual add hits either cap. */
const DECK_FULL_MSG = 'Sua Revisão já está cheia por hoje. Revise alguns cartões e tente de novo amanhã.';

/** Step → source of the cards it unlocks. */
const UNLOCK_SOURCE: Readonly<Record<number, CardSource>> = { 4: 'ep_visual', 8: 'ep_away' };

interface CardRow {
  id: string;
  en: string;
  pt: string;
  scene: string | null;
  note: string | null;
  due_at: number;
  reps: number;
}

const CARD_COLS = 'id, en, pt, scene, note, due_at, reps';

export function toDeckCard(r: CardRow): DeckCard {
  return { id: r.id, en: r.en, pt: r.pt, scene: r.scene ?? '', note: r.note ?? '', at: r.due_at, reps: r.reps };
}

interface CardInput {
  en: string;
  pt: string;
  scene: string;
  note?: string;
  source: CardSource;
}

/**
 * Award that degrades to null while the game engine (S4) is still the NotImplemented stub, so SRS and
 * Extras keep working before integration. Any other failure propagates.
 */
export async function safeAward(
  award: AwardService,
  userId: string,
  kind: PointKind,
  key: string,
  meta?: AwardMeta,
): Promise<AwardResult | null> {
  try {
    return await award.award(userId, kind, key, meta);
  } catch (err) {
    if (err instanceof NotImplementedError) {
      console.warn(JSON.stringify({ level: 'warn', msg: 'award skipped (service not wired)', kind, key }));
      return null;
    }
    throw err;
  }
}

/** Due cards (oldest first), due count, deck size and the next due time across the deck. */
export async function srsQueue(db: D1Database, userId: string, now: number): Promise<SrsQueueRes> {
  const [cards, stats] = await batch(db, [
    q<CardRow>(
      db,
      `SELECT ${CARD_COLS} FROM srs_cards WHERE user_id = ? AND due_at <= ?
       ORDER BY due_at, created_at, rowid LIMIT ?`,
      userId,
      now,
      SRS_QUEUE_MAX,
    ),
    q<{ due: number; total: number; next_at: number | null }>(
      db,
      `SELECT COALESCE(SUM(due_at <= ?), 0) AS due, COUNT(*) AS total, MIN(due_at) AS next_at
       FROM srs_cards WHERE user_id = ?`,
      now,
      userId,
    ),
  ]);
  const s = stats[0];
  return { cards: cards.map(toDeckCard), due: s?.due ?? 0, total: s?.total ?? 0, nextAt: s?.next_at ?? null };
}

function dueCountQuery(db: D1Database, userId: string, now: number): Query<{ due: number }> {
  return q<{ due: number }>(db, 'SELECT COUNT(*) AS due FROM srs_cards WHERE user_id = ? AND due_at <= ?', userId, now);
}

/** Content arrays are JSON columns; keep only well-formed {en, pt} items. */
function bilingualItems<T extends { en: string; pt: string }>(raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is T => !!x && typeof x === 'object' && typeof (x as T).en === 'string' && typeof (x as T).pt === 'string',
  );
}

export interface SrsServiceImpl extends SrsService {
  queue(userId: string): Promise<SrsQueueRes>;
  /** "em 10 min", "amanhã"… for the next card across the deck ('' for an empty deck). */
  nextIn(userId: string): Promise<string>;
}

export interface SrsServiceOptions {
  /** Clock override (tests). */
  now?: () => number;
}

export function createSrsService(env: Env, services: Services, opts: SrsServiceOptions = {}): SrsServiceImpl {
  const db = env.DB;
  const clock = opts.now ?? Date.now;

  /**
   * Inserts the cards, skipping any whose norm(en) is empty, repeated in the input or already in the
   * deck. One atomic batch; RETURNING tells exactly which rows were created. With `capped`, each
   * insert also checks the deck and daily manual caps in its own WHERE, so concurrent adds cannot
   * overshoot them (statements in a batch run in order inside one transaction).
   */
  async function insertCards(userId: string, cards: readonly CardInput[], now: number, capped = false) {
    const seen = new Set<string>();
    const inserts: Query<CardRow>[] = [];
    for (const c of cards) {
      const key = norm(c.en);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      // ?1 id ?2 user ?3 norm ?4 en ?5 pt ?6 scene ?7 note ?8 source ?9 now ?10 capped ?11 deck max
      // ?12 manual window start ?13 manual max
      inserts.push(
        q<CardRow>(
          db,
          `INSERT OR IGNORE INTO srs_cards(id, user_id, norm_key, en, pt, scene, note, source, due_at, reps, created_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?9
           WHERE NOT ?10 OR (
             (SELECT COUNT(*) FROM srs_cards WHERE user_id = ?2) < ?11 AND
             (SELECT COUNT(*) FROM srs_cards WHERE user_id = ?2 AND created_at > ?12
                AND source NOT IN ('ep_visual', 'ep_away')) < ?13)
           RETURNING ${CARD_COLS}`,
          newId(now),
          userId,
          key,
          c.en.trim(),
          c.pt.trim(),
          c.scene,
          c.note ?? '',
          c.source,
          now,
          capped ? 1 : 0,
          SRS_DECK_MAX,
          now - DAY_MS,
          SRS_MANUAL_ADDS_PER_DAY,
        ),
      );
    }
    const res = await batch(db, [...inserts, dueCountQuery(db, userId, now)] as Query<unknown>[]);
    const dueRows = res[res.length - 1] as { due: number }[];
    const added = (res.slice(0, -1) as CardRow[][]).flatMap((rows) => rows.map(toDeckCard));
    return { added, due: dueRows[0]?.due ?? 0 };
  }

  return {
    async unlock(userId, episode, step) {
      const source = UNLOCK_SOURCE[step];
      const unlock = SRS_UNLOCKS.find(([n]) => n === step);
      if (!source || !unlock) return [];
      const row = await one<{ num: number; visual: string; away_exp: string }>(
        db,
        'SELECT num, visual, away_exp FROM episodes WHERE num = ?',
        episode,
      );
      if (!row) return [];
      const ep: SrsEpisode = {
        num: row.num,
        visual: bilingualItems(fromJson<unknown>(row.visual, [])),
        awayExp: bilingualItems(fromJson<unknown>(row.away_exp, [])),
      };
      const cards = unlock[1](ep).map((c: UnlockedCard) => ({ ...c, source }));
      if (!cards.length) return [];
      return (await insertCards(userId, cards, clock())).added;
    },

    // Manual adds are capped (deck size, adds per rolling day) so the deck cannot be stuffed with
    // junk cards to farm `card` points or storage. Cards over a cap are skipped like duplicates; a
    // request that can add nothing because of a cap answers 429 quota_exceeded.
    async add(userId, cards: readonly NewCard[]): Promise<AddCardsRes> {
      const now = clock();
      const caps = await one<{ total: number; recent: number }>(
        db,
        `SELECT COUNT(*) AS total,
           COALESCE(SUM(created_at > ? AND source NOT IN ('ep_visual', 'ep_away')), 0) AS recent
         FROM srs_cards WHERE user_id = ?`,
        now - DAY_MS,
        userId,
      );
      if ((caps?.total ?? 0) >= SRS_DECK_MAX || (caps?.recent ?? 0) >= SRS_MANUAL_ADDS_PER_DAY) {
        throw fail('quota_exceeded', DECK_FULL_MSG);
      }
      const { added, due } = await insertCards(userId, cards, now, true);
      return { added, skipped: cards.length - added.length, due };
    },

    async grade(userId, cardId, grade): Promise<GradeRes> {
      const now = clock();
      // Owner check: a card id belonging to someone else is indistinguishable from a missing one.
      const card = await one<CardRow & { tz: string }>(
        db,
        `SELECT c.id, c.en, c.pt, c.scene, c.note, c.due_at, c.reps, u.tz
         FROM srs_cards c JOIN users u ON u.id = c.user_id WHERE c.id = ? AND c.user_id = ?`,
        cardId,
        userId,
      );
      if (!card) throw fail('not_found');
      const next = gradeCard(card, grade, now);
      if (!next) throw fail('validation_failed');
      const [updated, dueRows] = await batch(db, [
        q<CardRow>(
          db,
          `UPDATE srs_cards SET due_at = ?, reps = ? WHERE id = ? AND user_id = ? RETURNING ${CARD_COLS}`,
          next.at,
          next.reps,
          cardId,
          userId,
        ),
        dueCountQuery(db, userId, now),
      ]);
      const row = updated[0];
      if (!row) throw fail('not_found');
      // Points only for reviewing a card that was due: grading ahead of schedule still reschedules,
      // but cannot farm `card` points (at most one per card per local day).
      const award =
        card.due_at <= now
          ? await safeAward(services.award, userId, 'card', `card:${cardId}:${localDate(now, card.tz)}`, { now })
          : null;
      return { card: toDeckCard(row), due: dueRows[0]?.due ?? 0, award };
    },

    queue(userId) {
      return srsQueue(db, userId, clock());
    },

    async nextIn(userId) {
      const now = clock();
      const { nextAt } = await srsQueue(db, userId, now);
      return nextAt === null ? '' : nextInText([{ at: nextAt }], now);
    },
  };
}

/** Registry factory: createApp({services: {srs: srsServiceFactory}}). */
export const srsServiceFactory = (env: Env, services: Services): SrsService => createSrsService(env, services);
