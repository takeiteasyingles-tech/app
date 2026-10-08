import { type Catalog, type Ebook, type Episode, FLAGS, type GateEpisode, type GateState, stepKey } from '@tie/shared';
import { batch, type ContentService, fromJson, isEnabled, one, q } from '@tie/worker-core';
import type { LearningDeps } from './deps';

// Published content for the learning routes, and the user's state for ONE episode.
//
// Source of truth for "what the episode asks for" (need()) and for the answer keys:
// - the published snapshot (S9 ContentService) when it answers: the same files the client renders,
//   so an editor's unpublished change to a live episode (a new phrase or item, a new answer key)
//   neither gates the user on something they cannot see nor grades them against a key they were
//   not shown. Ids are intersected with the D1 rows that user state references by foreign key.
// - else (stub not replaced yet, nothing published yet, or the snapshot failing) the D1 content
//   tables, published episodes only.
// The user's state always comes from D1, in a single db.batch round trip.

/** Scripted Take the Mic result when mic_phrases.demo_result is NULL (same default as compile.ts). */
export const DEMO_RESULT_DEFAULT = 7;

export interface ItemKey {
  /** Number of options; a choice must be below it. */
  opts: number;
  answer: number;
  fix: string | null;
}

export interface PhraseKey {
  /** Scripted result ('script' source, no microphone). */
  result: number;
}

export interface Reach {
  /** episode_progress.furthest_step, 1 when the episode was never opened. */
  prog: number;
  done: boolean;
}

export interface EpisodeContext extends Reach {
  episode: GateEpisode;
  items: ReadonlyMap<string, ItemKey>;
  phrases: ReadonlyMap<string, PhraseKey>;
  /**
   * The first earlier published episode the user has not finished, when this one is not done yet:
   * the trilha only opens done episodes and the current one (spec 01 §4), so writes are refused.
   */
  lockedBy: number | null;
  /** The user's state for this episode only, in TieState shape (what the shared need() reads). */
  state: GateState & { settings: { free: boolean } };
}

// ---------- content source ----------

export type ContentSource = { kind: 'snapshot'; content: ContentService; catalog: Catalog } | { kind: 'd1' };

const D1_SOURCE: ContentSource = { kind: 'd1' };
const sources = new WeakMap<LearningDeps, Promise<ContentSource>>();

/** Resolved once per request (deps object). Never throws: any snapshot failure means D1. */
export function contentSource(d: LearningDeps): Promise<ContentSource> {
  let src = sources.get(d);
  if (!src) {
    src = (async (): Promise<ContentSource> => {
      const content = d.content;
      if (!content) return D1_SOURCE;
      try {
        if (!(await content.current())) return D1_SOURCE;
        return { kind: 'snapshot', content, catalog: await content.catalog() };
      } catch (err) {
        if (!(err instanceof Error && err.name === 'NotImplementedError')) {
          console.error(
            JSON.stringify({ level: 'warn', msg: 'content snapshot unavailable, using D1', error: String(err) }),
          );
        }
        return D1_SOURCE;
      }
    })();
    sources.set(d, src);
  }
  return src;
}

/** Snapshot file, or null when it is not published (or failed to load: the caller refuses). */
async function snapshotFile<T>(load: () => Promise<T | null>): Promise<T | null> {
  try {
    return await load();
  } catch (err) {
    console.error(JSON.stringify({ level: 'warn', msg: 'content snapshot file failed', error: String(err) }));
    return null;
  }
}

// ---------- episode ----------

interface EpisodeRow {
  num: number;
  status: string;
  ebook_num: number | null;
  scene_media: string | null;
}
interface PhraseRow {
  id: string;
  demo_result: number | null;
}
interface ItemRow {
  id: string;
  exercise_id: string;
  opts: string;
  answer_idx: number;
  fix: string | null;
}
interface ProgressRow {
  furthest_step: number;
  done_at: number | null;
}

const isPublished = (status: string | undefined) => status === 'published';
const clampScore = (n: number) => Math.max(0, Math.min(10, Math.round(n)));

function fromSnapshot(
  e: Episode,
  d1Phrases: ReadonlySet<string>,
  d1Items: ReadonlySet<string>,
): Pick<EpisodeContext, 'episode' | 'items' | 'phrases'> {
  const mic = e.mic.filter((m) => d1Phrases.has(m.id));
  const ex = e.ex
    .map((x) => ({ id: x.id, items: x.items.filter((it) => d1Items.has(it.id)) }))
    .filter((x) => x.items.length);
  const items = new Map<string, ItemKey>();
  for (const x of e.ex) {
    for (const it of x.items) {
      if (d1Items.has(it.id)) items.set(it.id, { opts: it.opts.length, answer: it.a, fix: it.fix ?? null });
    }
  }
  return {
    episode: {
      num: e.num,
      ebook: e.ebook,
      sceneVideo: e.sceneVideo,
      mic: mic.map((m) => ({ id: m.id })),
      ex: ex.map((x) => ({ items: x.items.map((it) => ({ id: it.id })) })),
    },
    phrases: new Map(mic.map((m) => [m.id, { result: clampScore(m.result) }])),
    items,
  };
}

function fromD1(
  row: EpisodeRow,
  phrases: readonly PhraseRow[],
  itemRows: readonly ItemRow[],
): Pick<EpisodeContext, 'episode' | 'items' | 'phrases'> {
  const ex: { id: string; items: { id: string }[] }[] = [];
  const items = new Map<string, ItemKey>();
  for (const it of itemRows) {
    let group = ex[ex.length - 1];
    if (!group || group.id !== it.exercise_id) {
      group = { id: it.exercise_id, items: [] };
      ex.push(group);
    }
    group.items.push({ id: it.id });
    items.set(it.id, { opts: fromJson<unknown[]>(it.opts, []).length, answer: it.answer_idx, fix: it.fix });
  }
  return {
    episode: {
      num: row.num,
      // need() reads ebooks[ep.ebook]; an episode without an e-book can never pass step 3.
      ebook: row.ebook_num ?? 0,
      sceneVideo: row.scene_media,
      mic: phrases.map((m) => ({ id: m.id })),
      ex,
    },
    phrases: new Map(phrases.map((m) => [m.id, { result: clampScore(m.demo_result ?? DEMO_RESULT_DEFAULT) }])),
    items,
  };
}

/**
 * Everything the player use cases look at for one episode: its published content, the user's
 * reach and state, and the episode lock. null when the episode is missing or not published.
 * `settings.free` ("Etapas livres") is on only when the user turned it on AND the dev.free_steps
 * flag is enabled for them; it skips need() but never the episode lock.
 */
export async function loadEpisodeContext(d: LearningDeps, ep: number): Promise<EpisodeContext | null> {
  const { db, userId } = d;
  const src = await contentSource(d);
  const snapshot = src.kind === 'snapshot' ? snapshotFile(() => src.content.episode(ep)) : null;
  const [eps, phraseRows, itemRows, progress, oks, ebooks, scores, answers, settings, earlierD1, doneRows] =
    await batch(db, [
      q<EpisodeRow>(db, 'SELECT num, status, ebook_num, scene_media FROM episodes WHERE num = ?', ep),
      q<PhraseRow>(db, 'SELECT id, demo_result FROM mic_phrases WHERE episode_num = ? ORDER BY sort, id', ep),
      q<ItemRow>(
        db,
        `SELECT i.id, i.exercise_id, i.opts, i.answer_idx, i.fix FROM exercise_items i
         JOIN exercises x ON x.id = i.exercise_id
         WHERE x.episode_num = ? ORDER BY x.sort, x.id, i.sort, i.id`,
        ep,
      ),
      q<ProgressRow>(
        db,
        'SELECT furthest_step, done_at FROM episode_progress WHERE user_id = ? AND episode_num = ?',
        userId,
        ep,
      ),
      q<{ step: number }>(db, 'SELECT step FROM step_completions WHERE user_id = ? AND episode_num = ?', userId, ep),
      q<{ ebook_num: number }>(db, 'SELECT ebook_num FROM user_ebooks WHERE user_id = ?', userId),
      q<{ phrase_id: string; last_score: number }>(
        db,
        `SELECT s.phrase_id, s.last_score FROM mic_scores s JOIN mic_phrases p ON p.id = s.phrase_id
         WHERE s.user_id = ? AND p.episode_num = ?`,
        userId,
        ep,
      ),
      q<{ item_id: string; choice_idx: number }>(
        db,
        `SELECT a.item_id, a.choice_idx FROM exercise_answers a
         JOIN exercise_items i ON i.id = a.item_id JOIN exercises x ON x.id = i.exercise_id
         WHERE a.user_id = ? AND x.episode_num = ?`,
        userId,
        ep,
      ),
      q<{ free: number }>(db, 'SELECT free FROM user_settings WHERE user_id = ?', userId),
      q<{ num: number }>(db, "SELECT num FROM episodes WHERE status = 'published' AND num < ? ORDER BY num", ep),
      q<{ episode_num: number }>(
        db,
        'SELECT episode_num FROM episode_progress WHERE user_id = ? AND done_at IS NOT NULL AND episode_num <= ?',
        userId,
        ep,
      ),
    ] as const);

  let content: Pick<EpisodeContext, 'episode' | 'items' | 'phrases'>;
  let earlier: number[];
  if (src.kind === 'snapshot') {
    const e = await snapshot;
    if (!e || !isPublished(e.status)) return null;
    content = fromSnapshot(e, new Set(phraseRows.map((p) => p.id)), new Set(itemRows.map((i) => i.id)));
    earlier = src.catalog.episodes.filter((x) => isPublished(x.status) && x.num < ep).map((x) => x.num);
  } else {
    const row = eps[0];
    if (!row || !isPublished(row.status)) return null;
    content = fromD1(row, phraseRows, itemRows);
    earlier = earlierD1.map((x) => x.num);
  }

  const p = progress[0];
  const reach: Reach = { prog: p?.furthest_step ?? 1, done: p?.done_at != null };
  const doneSet = new Set(doneRows.map((r) => r.episode_num));
  const lockedBy = reach.done ? null : (earlier.sort((a, b) => a - b).find((n) => !doneSet.has(n)) ?? null);

  const key = String(ep);
  const free = settings[0]?.free === 1 && (await isEnabled(db, FLAGS.freeSteps, d.subject));
  return {
    ...reach,
    ...content,
    lockedBy,
    state: {
      prog: { [key]: reach.prog },
      epsDone: reach.done ? { [key]: true } : {},
      ebooks: Object.fromEntries(ebooks.map((e) => [String(e.ebook_num), true])),
      stepOk: Object.fromEntries(oks.map((o) => [stepKey(ep, o.step), true])),
      scores: Object.fromEntries(scores.map((s) => [s.phrase_id, s.last_score])),
      exAns: Object.fromEntries(answers.map((a) => [a.item_id, a.choice_idx])),
      settings: { free },
    },
  };
}

// ---------- e-book ----------

/**
 * An e-book is open to users when a published episode belongs to it (its download unlocks that
 * episode's step 3). Test endpoints additionally need its published file in snapshot mode.
 */
export async function ebookOpen(
  d: LearningDeps,
  n: number,
): Promise<{ open: boolean; snapshot: Ebook | null; source: ContentSource['kind'] }> {
  const src = await contentSource(d);
  if (src.kind === 'snapshot') {
    const open = src.catalog.episodes.some((e) => isPublished(e.status) && e.ebook === n);
    const file = open ? await snapshotFile(() => src.content.ebook(n)) : null;
    return { open, snapshot: file, source: 'snapshot' };
  }
  const row = await one<{ ok: number }>(
    d.db,
    "SELECT 1 AS ok FROM episodes WHERE ebook_num = ? AND status = 'published' LIMIT 1",
    n,
  );
  return { open: row != null, snapshot: null, source: 'd1' };
}
