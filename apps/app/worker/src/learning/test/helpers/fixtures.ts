import type { AwardResult, Catalog, ContentManifest, DeckCard, Ebook, Episode, PointKind } from '@tie/shared';
import type { AwardMeta, AwardService, ContentService, SrsService } from '@tie/worker-core';
import type { LearningDeps } from '../../deps';
import { SqliteD1 } from './sqliteD1';

export const SECRET = 'test-media-token-key';
export const NOW = Date.UTC(2026, 9, 7, 15, 0, 0);
export const USER = 'u_alice';
export const OTHER = 'u_bob';

/** AwardService fake with the real contract: idempotent per (user, key). */
export class FakeAward implements AwardService {
  readonly calls: { userId: string; kind: PointKind; key: string }[] = [];
  readonly keys = new Set<string>();
  total = 0;

  async award(userId: string, kind: PointKind, key: string, _meta?: AwardMeta): Promise<AwardResult> {
    this.calls.push({ userId, kind, key });
    const fresh = !this.keys.has(`${userId}|${key}`);
    this.keys.add(`${userId}|${key}`);
    const points = fresh ? 10 : 0;
    this.total += points;
    return {
      awarded: fresh,
      kind,
      points,
      total: this.total,
      dayPoints: this.total,
      levelUp: null,
      goalHit: false,
      newBadges: [],
      missionsDone: [],
    };
  }

  awardedKeys(): string[] {
    return [...this.keys].map((k) => k.slice(k.indexOf('|') + 1));
  }
}

/** SrsService fake: unlock hands out two new cards per (episode, step) once, then nothing. */
export class FakeSrs implements SrsService {
  readonly unlocked: string[] = [];
  readonly calls: { episode: number; step: number }[] = [];

  async unlock(_userId: string, episode: number, step: number): Promise<DeckCard[]> {
    this.calls.push({ episode, step });
    const k = `${episode}:${step}`;
    if (this.unlocked.includes(k)) return [];
    this.unlocked.push(k);
    return [0, 1].map((i) => ({
      id: `${k}:${i}`,
      en: `w${i}`,
      pt: `p${i}`,
      scene: `Ep. ${episode}`,
      note: '',
      at: NOW,
      reps: 0,
    }));
  }
  add(): never {
    throw new Error('not used');
  }
  grade(): never {
    throw new Error('not used');
  }
}

export interface World {
  db: SqliteD1;
  award: FakeAward;
  srs: FakeSrs;
  /** S9 ContentService seen by deps(); undefined = not wired (D1 fallback). */
  content: ContentService | undefined;
  deps(userId?: string, now?: number): LearningDeps;
}

/**
 * Simulates an S9 publish: freezes the current D1 content into snapshot files (only the fields the
 * learning code reads) behind a ContentService. Later D1 edits stay unpublished.
 */
export function publish(w: World): ContentService {
  const eps = w.db.rows<{
    num: number;
    title: string;
    status: string;
    ebook_num: number | null;
    scene_media: string | null;
  }>('SELECT num, title, status, ebook_num, scene_media FROM episodes ORDER BY num');
  const episodes = new Map<number, Episode>();
  for (const e of eps.filter((x) => x.status === 'published')) {
    const mic = w.db
      .rows<{ id: string; en: string; demo_result: number | null }>(
        'SELECT id, en, demo_result FROM mic_phrases WHERE episode_num = ? ORDER BY sort, id',
        e.num,
      )
      .map((m) => ({ id: m.id, en: m.en, tip: '', result: m.demo_result ?? 7, fb: '' }));
    const ex = w.db
      .rows<{ id: string }>('SELECT id FROM exercises WHERE episode_num = ? ORDER BY sort, id', e.num)
      .map((x) => ({
        id: x.id,
        kind: 'escrito',
        title: x.id,
        items: w.db
          .rows<{ id: string; opts: string; answer_idx: number; fix: string | null }>(
            'SELECT id, opts, answer_idx, fix FROM exercise_items WHERE exercise_id = ? ORDER BY sort, id',
            x.id,
          )
          .map((it) => ({
            id: it.id,
            q: '',
            opts: JSON.parse(it.opts) as string[],
            a: it.answer_idx,
            ...(it.fix ? { fix: it.fix } : {}),
          })),
      }));
    episodes.set(e.num, {
      num: e.num,
      status: 'published',
      ebook: e.ebook_num ?? 0,
      sceneVideo: e.scene_media ? `/m/${e.scene_media}` : null,
      mic,
      ex,
    } as unknown as Episode);
  }
  const ebooks = new Map<number, Ebook>();
  for (const b of w.db.rows<{ num: number; pass_score: number; pdf: string | null }>(
    'SELECT b.num, b.pass_score, m.r2_key AS pdf FROM ebooks b LEFT JOIN media m ON m.id = b.pdf_media',
  )) {
    const qs = w.db
      .rows<{
        id: string;
        n: number;
        opts: string | null;
        answer_idx: number | null;
        accept: string | null;
        show: string | null;
      }>('SELECT id, n, opts, answer_idx, accept, show FROM ebook_test_questions WHERE ebook_num = ? ORDER BY n', b.num)
      .map((x) => ({
        id: x.id,
        n: x.n,
        q: '',
        rev: '',
        ep: 1,
        step: 7,
        ...(x.opts ? { opts: JSON.parse(x.opts) as string[], a: x.answer_idx ?? 0 } : {}),
        ...(x.accept ? { acc: JSON.parse(x.accept) as string[] } : {}),
        ...(x.show ? { show: x.show } : {}),
      }));
    if (!qs.length) continue; // compile.ts ships available e-books only
    ebooks.set(b.num, {
      num: b.num,
      passScore: b.pass_score,
      pdf: b.pdf ? `/m/${b.pdf}` : null,
      test: [{ title: 'Part', qs }],
    } as unknown as Ebook);
  }
  const catalog = {
    episodes: eps.map((e) => ({ num: e.num, title: e.title, status: e.status, season: 1, ebook: e.ebook_num })),
  } as unknown as Catalog;
  return {
    current: async () => ({ version: 'v1', publishedAt: 1 }) as unknown as ContentManifest,
    catalog: async () => catalog,
    episode: async (n) => episodes.get(n) ?? null,
    ebook: async (n) => ebooks.get(n) ?? null,
    extra: async () => null,
  };
}

/**
 * Content shaped like the prototype's e-book 1:
 * - ep 1 (published, e-book 1, scene video, 2 mic phrases, 2 exercises × 2 items)
 * - ep 2 (published, e-book 1, no video, no mic phrases, no exercises)
 * - ep 3 (title_only)
 * - e-book 1 with a PDF and a 6-question test (pass 4): 2 multiple choice, 4 typed from TEST acc lists.
 */
export function world(): World {
  const db = new SqliteD1();
  const t = 1;
  for (const id of [USER, OTHER])
    db.exec('INSERT INTO users(id, email, created_at) VALUES(?, ?, ?)', id, `${id}@x.test`, t);
  db.exec(
    `INSERT INTO media(id, r2_key, kind, mime, bytes, sha256, created_at) VALUES
     ('m_vid', 'media/aa/ep1.mp4', 'video', 'video/mp4', 1, 'x', 1),
     ('m_pdf', 'media/bb/ebook1.pdf', 'pdf', 'application/pdf', 1, 'y', 1)`,
  );
  db.exec(`INSERT INTO ebooks(num, title, pdf_media, pass_score, updated_at) VALUES(1, 'Hello', 'm_pdf', 4, 1)`);
  db.exec(`INSERT INTO ebooks(num, title, pass_score, updated_at) VALUES(2, 'Next', 14, 1)`);
  db.exec(
    `INSERT INTO episodes(num, title, status, ebook_num, scene_media, updated_at) VALUES
     (1, 'Arrival', 'published', 1, 'm_vid', 1),
     (2, 'Family', 'published', 1, NULL, 1),
     (3, 'Soon', 'title_only', 2, NULL, 1)`,
  );
  db.exec(
    `INSERT INTO mic_phrases(id, episode_num, sort, en, demo_result) VALUES
     ('e1-mic-0', 1, 0, 'Hi, I''m Ana.', 9), ('e1-mic-1', 1, 1, 'Nice to meet you.', 6),
     ('e3-mic-0', 3, 0, 'Draft phrase', 7)`,
  );
  db.exec(
    `INSERT INTO exercises(id, episode_num, sort, kind, title) VALUES
     ('e1-ex0', 1, 0, 'escrito', 'A'), ('e1-ex1', 1, 1, 'escrito', 'B')`,
  );
  const opts = JSON.stringify(['a', 'b', 'c']);
  db.exec(
    `INSERT INTO exercise_items(id, exercise_id, sort, q, opts, answer_idx, fix) VALUES
     ('e1-ex0-i0', 'e1-ex0', 0, 'q0', ?, 1, 'Use b.'), ('e1-ex0-i1', 'e1-ex0', 1, 'q1', ?, 0, NULL),
     ('e1-ex1-i0', 'e1-ex1', 0, 'q2', ?, 2, NULL), ('e1-ex1-i1', 'e1-ex1', 1, 'q3', ?, 2, NULL)`,
    opts,
    opts,
    opts,
    opts,
  );
  const mc = JSON.stringify(['Hi', 'Bye', 'Thanks']);
  const tq = (id: string, n: number, cols: { opts?: string; a?: number; acc?: string[]; show?: string }) =>
    db.exec(
      `INSERT INTO ebook_test_questions(id, ebook_num, part_idx, part_title, n, q, ep_num, step, opts, answer_idx, accept, show)
       VALUES(?, 1, 0, 'Part', ?, 'q', 1, 7, ?, ?, ?, ?)`,
      id,
      n,
      cols.opts ?? null,
      cols.a ?? null,
      cols.acc ? JSON.stringify(cols.acc) : null,
      cols.show ?? null,
    );
  tq('eb1-t1', 1, { opts: mc, a: 0 });
  tq('eb1-t2', 2, { opts: mc, a: 2 });
  tq('eb1-t9', 9, { acc: ['name'], show: 'name' });
  tq('eb1-t13', 13, { acc: ["she's"], show: 'She’s' });
  tq('eb1-t14', 14, { acc: ["good morning i'm ana"], show: 'Good morning. I’m Ana.' });
  tq('eb1-t16', 16, {
    acc: ['this is my father his name is paulo', 'this is my dad his name is paulo'],
    show: 'This is my father. His name is Paulo.',
  });

  const award = new FakeAward();
  const srs = new FakeSrs();
  const w: World = {
    db,
    award,
    srs,
    content: undefined,
    deps: (userId = USER, now = NOW) => ({
      db: db.asD1(),
      award,
      srs,
      content: w.content,
      attemptSecret: SECRET,
      userId,
      subject: { userId, planSlug: null, roles: [] },
      now,
    }),
  };
  return w;
}

/** Puts USER at `step` of an episode (as if they had advanced there). */
export function setProg(w: World, ep: number, step: number, done = false, userId = USER): void {
  w.db.exec(
    `INSERT INTO episode_progress(user_id, episode_num, furthest_step, done_at, updated_at) VALUES(?, ?, ?, ?, 1)
     ON CONFLICT(user_id, episode_num) DO UPDATE SET furthest_step = excluded.furthest_step, done_at = excluded.done_at`,
    userId,
    ep,
    step,
    done ? 1 : null,
  );
}
