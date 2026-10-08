// S6 Extras: /api/extras/* (seen, dub, challenge) and /api/karaoke/gap (prototipo/js/screens/extra.js).
// Mounted at '/' by worker/src/index.ts, so paths are absolute (appApi.*.path).
import {
  appApi,
  ChallengeBody,
  type ChallengeRes,
  DubBody,
  type DubRes,
  type ExtraSeenRes,
  IdParams,
  KaraokeGapBody,
  type KaraokeGapRes,
  PLAN_FEATURES,
} from '@tie/shared';
import {
  type AppEnv,
  batch,
  fail,
  fromJson,
  localDate,
  now,
  one,
  q,
  rateLimit,
  requireUser,
  type SessionInfo,
  sessionOf,
  vJson,
  vParam,
} from '@tie/worker-core';
import { Hono } from 'hono';
import { attemptMatches } from '../ai/attempt';
import { safeAward } from '../services/srs.impl';

const api = appApi.extras;
const routes = new Hono<AppEnv>();

routes.use('/api/extras/*', requireUser());
routes.use(api.karaokeGap.path, requireUser());

// ---------- Desafio relâmpago sanity caps ----------
// One 60 s round. A right pick scores 10 × combo, the combo grows by 1 per hit up to ×5 and a miss
// resets it, so with h hits the score is a multiple of 10 between 10h (combo always reset) and
// 10+20+30+40+50+50+… (never missed). Hits are capped at a generous human ceiling.

export const CHALLENGE_MAX_HITS = 90;
export const CHALLENGE_MIN_HITS_AWARD = 5;

/** Highest score reachable with `hits` right picks. */
export function challengeMaxScore(hits: number): number {
  return hits <= 5 ? 5 * hits * (hits + 1) : 150 + 50 * (hits - 5);
}

export function challengePlausible(score: number, hits: number): boolean {
  if (!Number.isInteger(score) || !Number.isInteger(hits) || hits < 0 || hits > CHALLENGE_MAX_HITS) return false;
  if (score % 10 !== 0) return false;
  return score >= 10 * hits && score <= challengeMaxScore(hits);
}

// ---------- helpers ----------

interface ExtraRow {
  id: string;
  lines: string;
  /** Character the student voices in dubbing mode; NULL = the extra has no dubbing mode. */
  dub: string | null;
  premium: number;
}

/**
 * Published extra or 404. Watching and dubbing also need it released (locked extras are the
 * "Estreias sexta" teasers); the Desafio pool takes any extra's lines, so it allows locked ones.
 */
async function playableExtra(db: D1Database, id: string, allowLocked = false): Promise<ExtraRow> {
  const row = await one<ExtraRow>(
    db,
    "SELECT id, lines, dub, premium FROM extras WHERE id = ? AND status = 'published' AND (locked = 0 OR ?)",
    id,
    allowLocked,
  );
  if (!row) throw fail('not_found');
  return row;
}

/**
 * Premium extras (premium=1) only count for plans with the premium_extras feature: the same rule
 * the content route applies to extra/{id}.json (403 plan_required), so points cannot be earned on
 * content the plan does not unlock.
 */
function requirePlanFor(extra: ExtraRow, session: SessionInfo): void {
  if (extra.premium && !session.plan?.features[PLAN_FEATURES.premiumExtras]) throw fail('plan_required');
}

/** Karaoke answers compare like the prototype (case-insensitive, gap punctuation stripped) plus curly quotes. */
const gapWord = (s: string): string =>
  s
    .replace(/[‘’`]/g, "'")
    .replace(/[.,!?]/g, '')
    .trim()
    .toLowerCase();

interface LyricLine {
  en?: unknown;
  gap?: unknown;
}

/**
 * The blanked word of a karaoke line, resolved exactly like the content compiler (compile.ts:
 * `l.gap || first word`) and the prototype's tracksOf: an episode lyric line without a gap blanks
 * its first word; a track's own lines are used as they are. '' when the line does not exist.
 */
export function resolveGap(line: unknown, episodeLyric: boolean): string {
  if (!line || typeof line !== 'object') return '';
  const l = line as LyricLine;
  const gap = typeof l.gap === 'string' ? l.gap : '';
  if (gap || !episodeLyric) return gap;
  return typeof l.en === 'string' ? (l.en.split(' ')[0] ?? '') : '';
}

// ---------- routes ----------

// finishScene(): seen + lastId; `extra` points once per extra.
routes.post(api.seen.path, rateLimit('RL_API'), vParam(IdParams), async (c) => {
  const s = sessionOf(c);
  const { id } = c.req.valid('param');
  const db = c.env.DB;
  requirePlanFor(await playableExtra(db, id), s);
  const t = now();
  await batch(db, [
    q(
      db,
      `INSERT INTO user_extras(user_id, extra_id, seen_at) VALUES(?, ?, ?)
       ON CONFLICT(user_id, extra_id) DO UPDATE SET seen_at = COALESCE(user_extras.seen_at, excluded.seen_at)`,
      s.userId,
      id,
      t,
    ),
    q(db, 'INSERT OR IGNORE INTO user_stats(user_id) VALUES(?)', s.userId),
    q(db, 'UPDATE user_stats SET last_extra_id = ? WHERE user_id = ?', id, s.userId),
  ]);
  const award = await safeAward(c.get('services').award, s.userId, 'extra', `extra:${id}`, { now: t });
  return c.json({ seen: true, lastId: id, award } satisfies ExtraSeenRes);
});

// One dubbed line. Only extras with a dubbing character, and only that character's lines. An 'ia'
// score counts only with the attempt token /api/pronounce signed for phraseId `${id}:${line}` and
// this score; demo/script scores are taken as sent (no AI to verify against).
// Running average exactly like the prototype: first score (or a 0 average) is taken as is, then
// avg = round((avg + score) / 2). `dub` points once per extra (dub:{id}).
routes.post(api.dub.path, rateLimit('RL_API'), vParam(IdParams), vJson(DubBody), async (c) => {
  const s = sessionOf(c);
  const { id } = c.req.valid('param');
  const { score, line, source, attempt } = c.req.valid('json');
  const db = c.env.DB;
  const extra = await playableExtra(db, id);
  if (!extra.dub) throw fail('not_found');
  requirePlanFor(extra, s);
  const lines = fromJson<unknown>(extra.lines, []);
  const target = Array.isArray(lines) ? (lines[line] as { who?: unknown } | undefined) : undefined;
  if (!target || typeof target !== 'object') throw fail('validation_failed', undefined, { reason: 'line' });
  if (target.who !== extra.dub) throw fail('validation_failed', undefined, { reason: 'not_dub_line' });
  if (
    source === 'ia' &&
    !(await attemptMatches(c.env.MEDIA_TOKEN_KEY, attempt, { userId: s.userId, phraseId: `${id}:${line}`, score }))
  ) {
    throw fail('token_invalid', 'Não deu para confirmar essa gravação. Grave de novo.');
  }
  const t = now();
  const [rows] = await batch(db, [
    q<{ dub_avg: number; dub_count: number }>(
      db,
      `INSERT INTO user_extras(user_id, extra_id, dub_avg, dub_count) VALUES(?, ?, ?, 1)
       ON CONFLICT(user_id, extra_id) DO UPDATE SET
         dub_avg = CASE WHEN user_extras.dub_avg IS NULL OR user_extras.dub_avg = 0 THEN excluded.dub_avg
                        ELSE ROUND((user_extras.dub_avg + excluded.dub_avg) / 2.0) END,
         dub_count = user_extras.dub_count + 1
       RETURNING dub_avg, dub_count`,
      s.userId,
      id,
      score,
    ),
  ]);
  const row = rows[0];
  if (!row) throw fail('internal');
  const award = await safeAward(c.get('services').award, s.userId, 'dub', `dub:${id}`, { now: t });
  return c.json({ avg: row.dub_avg, count: row.dub_count, award } satisfies DubRes);
});

// Desafio end: implausible results are rejected; the record keeps the max; ≥5 hits award `ex_right`
// once per local day (challenge:{date}). The pool mixes lines from every extra and the award is not
// tied to one, so `extraId` is only checked to exist (no plan gate).
routes.post(api.challenge.path, rateLimit('RL_API'), vJson(ChallengeBody), async (c) => {
  const s = sessionOf(c);
  const { score, hits, extraId } = c.req.valid('json');
  if (!challengePlausible(score, hits)) throw fail('validation_failed', undefined, { reason: 'implausible' });
  const db = c.env.DB;
  if (extraId) await playableExtra(db, extraId, true);
  const [, prevRows, bestRows] = await batch(db, [
    q(db, 'INSERT OR IGNORE INTO user_stats(user_id) VALUES(?)', s.userId),
    q<{ best: number }>(db, 'SELECT challenge_best AS best FROM user_stats WHERE user_id = ?', s.userId),
    q<{ best: number }>(
      db,
      'UPDATE user_stats SET challenge_best = MAX(challenge_best, ?) WHERE user_id = ? RETURNING challenge_best AS best',
      score,
      s.userId,
    ),
  ]);
  const prev = prevRows[0]?.best ?? 0;
  const best = bestRows[0]?.best ?? Math.max(prev, score);
  const t = now();
  const award =
    hits >= CHALLENGE_MIN_HITS_AWARD
      ? await safeAward(c.get('services').award, s.userId, 'ex_right', `challenge:${localDate(t, s.tz)}`, { now: t })
      : null;
  // Prototype parity: "Novo recorde" shows when the score reaches the (updated) record.
  return c.json({ best, newRecord: score > 0 && score >= prev, award } satisfies ChallengeRes);
});

// Karaoke gap pick, graded here: a right pick awards `ex_right` once per line (kgap:{track}:{line}).
// Tracks that point at an episode sing that episode's lyrics (only while it is published); a track's
// own lines win when present, like compile.ts (`own ?? lyrics`).
routes.post(api.karaokeGap.path, rateLimit('RL_API'), vJson(KaraokeGapBody), async (c) => {
  const { userId } = sessionOf(c);
  const { trackId, line, choice } = c.req.valid('json');
  const db = c.env.DB;
  const track = await one<{ lines: string | null; ep_num: number | null; lyrics: string | null }>(
    db,
    `SELECT t.lines, t.ep_num, e.lyrics FROM album_tracks t
     LEFT JOIN episodes e ON e.num = t.ep_num AND e.status = 'published' WHERE t.id = ?`,
    trackId,
  );
  if (!track) throw fail('not_found');
  const own = fromJson<unknown>(track.lines, null);
  let lines: unknown;
  let episodeLyric = false;
  if (own != null) lines = own;
  else if (track.ep_num != null && track.lyrics != null) {
    lines = fromJson<unknown>(track.lyrics, []);
    episodeLyric = true;
  } else throw fail('not_found'); // unpublished (or missing) episode: nothing to sing yet
  const answer = resolveGap(Array.isArray(lines) ? lines[line] : undefined, episodeLyric).replace(/[.,!?]/g, '');
  if (!answer.trim()) throw fail('not_found');
  const correct = gapWord(choice) === gapWord(answer);
  // TODO(I1): the prototype locks a line after the first pick (K.picks); doing that here needs a
  // per-user marker table (e.g. karaoke_picks(user_id, track_id, line) with INSERT OR IGNORE), which
  // no migration provides yet. Until then a wrong pick can be followed by a right one. The client
  // already holds every gap word in the catalog, so this only costs the once-per-line award.
  const award = correct
    ? await safeAward(c.get('services').award, userId, 'ex_right', `kgap:${trackId}:${line}`)
    : null;
  return c.json({ correct, answer, award } satisfies KaraokeGapRes);
});

export default routes;
