// Feature C (spec 07): NPS ratings of the episodes (list, per-episode summary) and the learning
// statistics (one learner, the course funnel). Every endpoint is a read answered by one D1 round trip
// (a single statement or one batch) over indexed lookups.
//
// - Ratings (feedback.read: editors and moderators too) carry the learner's id and display name only,
//   never the e-mail. The list and the summary show every rating, staff accounts included.
// - Learning statistics (users.read) count learners: accounts holding a staff role are left out of
//   the funnel, the test pass rates and the active learners, as on the dashboard (/admin-api/stats).
import {
  type AdminFeedbackRow,
  ApiError,
  adminFeedbackApi,
  adminStatsApi,
  DEFAULT_TZ,
  emptyStarDist,
  type FeedbackStatsSchema,
  type FeedbackSummary,
  feedbackStats,
  type LearningStats,
  type UserLearningStats,
} from '@tie/shared';
import { type AppEnv, addDays, all, type Bind, batch, DAY, localDate, q, safeTimeZone } from '@tie/worker-core';
import { Hono } from 'hono';
import { likeEscape, paramsOf, queryOf, route } from '../lib/http';
import { decodeCursor, pageOf } from '../lib/page';

const routes = new Hono<AppEnv>();

/** SQL: the account `col` holds no staff role (a learner). The alias never clashes with the caller's. */
const learnerOnly = (col: string) => `NOT EXISTS (SELECT 1 FROM user_roles ur_ WHERE ur_.user_id = ${col})`;

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((100 * part) / whole) : 0);

type Dist = ReturnType<typeof emptyStarDist>;

/** Adds `n` ratings of `stars` (1..5) to a distribution; other star values are ignored. */
function addStars(dist: Dist, stars: number, n: number): void {
  const i = stars - 1;
  if (Number.isInteger(stars) && i >= 0 && i < 5) dist[i] = (dist[i] ?? 0) + Math.max(0, n);
}

/** Oldest-first list of the `days` calendar dates ending on `today` (YYYY-MM-DD). */
export function lastDates(today: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(today, i - days + 1));
}

// ---------- Ratings ----------

interface FeedbackDb {
  id: string;
  user_id: string;
  user_name: string | null;
  episode_num: number;
  episode_title: string | null;
  stars: number;
  comment: string | null;
  created_at: number;
  updated_at: number;
}

route(routes, adminFeedbackApi.list, async (c) => {
  const query = queryOf(c, adminFeedbackApi.list.query);
  const binds: Bind[] = [];
  const p = (v: Bind) => {
    binds.push(v);
    return `?${binds.length}`;
  };
  const where: string[] = [];
  if (query.episode !== undefined) where.push(`f.episode_num = ${p(query.episode)}`);
  if (query.stars !== undefined) where.push(`f.stars = ${p(query.stars)}`);
  if (query.minStars !== undefined) where.push(`f.stars >= ${p(query.minStars)}`);
  if (query.maxStars !== undefined) where.push(`f.stars <= ${p(query.maxStars)}`);
  if (query.hasComment !== undefined) where.push(query.hasComment ? 'f.comment IS NOT NULL' : 'f.comment IS NULL');
  if (query.q) where.push(`f.comment LIKE ${p(`%${likeEscape(query.q)}%`)} ESCAPE '\\'`);
  if (query.from !== undefined) where.push(`f.updated_at >= ${p(query.from)}`);
  if (query.to !== undefined) where.push(`f.updated_at <= ${p(query.to)}`);
  const cur = decodeCursor(query.cursor, ['n', 's']);
  if (cur) {
    const [at, id] = cur;
    where.push(`(f.updated_at < ${p(at)} OR (f.updated_at = ${p(at)} AND f.id < ${p(id)}))`);
  }
  const rows = await all<FeedbackDb>(
    c.env.DB,
    `SELECT f.id, f.user_id, pr.name AS user_name, f.episode_num, e.title AS episode_title, f.stars, f.comment,
       f.created_at, f.updated_at
     FROM lesson_feedback f
     LEFT JOIN profiles pr ON pr.user_id = f.user_id
     LEFT JOIN episodes e ON e.num = f.episode_num
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY f.updated_at DESC, f.id DESC LIMIT ${p(query.limit + 1)}`,
    ...binds,
  );
  return c.json(
    pageOf(
      rows,
      query.limit,
      (r): AdminFeedbackRow => ({
        id: r.id,
        userId: r.user_id,
        userName: r.user_name,
        episodeNum: r.episode_num,
        episodeTitle: r.episode_title,
        stars: r.stars,
        comment: r.comment,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }),
      (r) => [r.updated_at, r.id],
    ),
  );
});

/** Per-star counts (+ comments) → the contract's stats object. */
function statsOf(dist: [number, number, number, number, number], comments: number): FeedbackStatsSchema {
  const s = feedbackStats(dist);
  return { count: s.count, avg: s.avg, dist: [...s.dist], nps: s.nps, comments };
}

route(routes, adminFeedbackApi.summary, async (c) => {
  const query = queryOf(c, adminFeedbackApi.summary.query);
  const binds: Bind[] = [];
  const where: string[] = [];
  if (query.from !== undefined) {
    binds.push(query.from);
    where.push(`f.updated_at >= ?${binds.length}`);
  }
  if (query.to !== undefined) {
    binds.push(query.to);
    where.push(`f.updated_at <= ?${binds.length}`);
  }
  const rows = await all<{ episode_num: number; title: string | null; stars: number; n: number; c: number }>(
    c.env.DB,
    `SELECT f.episode_num, e.title, f.stars, COUNT(*) AS n,
       SUM(CASE WHEN f.comment IS NOT NULL THEN 1 ELSE 0 END) AS c
     FROM lesson_feedback f LEFT JOIN episodes e ON e.num = f.episode_num
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     GROUP BY f.episode_num, f.stars ORDER BY f.episode_num`,
    ...binds,
  );
  const overall = emptyStarDist();
  let overallComments = 0;
  const byEp = new Map<number, { title: string | null; dist: Dist; comments: number }>();
  for (const r of rows) {
    if (r.stars < 1 || r.stars > 5) continue;
    let ep = byEp.get(r.episode_num);
    if (!ep) {
      ep = { title: r.title, dist: emptyStarDist(), comments: 0 };
      byEp.set(r.episode_num, ep);
    }
    addStars(ep.dist, r.stars, r.n);
    addStars(overall, r.stars, r.n);
    ep.comments += r.c ?? 0;
    overallComments += r.c ?? 0;
  }
  const out: FeedbackSummary = {
    overall: statsOf(overall, overallComments),
    episodes: [...byEp].map(([episodeNum, e]) => ({ ...statsOf(e.dist, e.comments), episodeNum, title: e.title })),
  };
  return c.json(out);
});

// ---------- One learner ----------

interface UserDb {
  id: string;
  status: string;
  tz: string;
}

route(routes, adminStatsApi.user, async (c) => {
  const { id } = paramsOf(c, adminStatsApi.user.params);
  const db = c.env.DB;
  const now = Date.now();
  // The learner's timezone is only known once the batch answers: fetch from a bound safely before
  // "30 days ago" in any timezone, then cut the window in the learner's own calendar.
  const since = localDate(now - 32 * DAY, 'UTC');
  const [users, episodes, ebooks, seasons, certs, stats, totals, days, cards, ratings] = await batch(db, [
    q<UserDb>(db, 'SELECT id, status, tz FROM users WHERE id = ?', id),
    q<{
      episode_num: number;
      title: string | null;
      season_n: number | null;
      furthest_step: number;
      done_at: number | null;
      updated_at: number;
    }>(
      db,
      `SELECT p.episode_num, e.title, e.season_n, p.furthest_step, p.done_at, p.updated_at
       FROM episode_progress p LEFT JOIN episodes e ON e.num = p.episode_num
       WHERE p.user_id = ? ORDER BY p.episode_num`,
      id,
    ),
    q<{ ebook_num: number; score: number; passed: number; submitted_at: number; pass_score: number | null }>(
      db,
      `SELECT r.ebook_num, r.score, r.passed, r.submitted_at, b.pass_score
       FROM ebook_test_results r LEFT JOIN ebooks b ON b.num = r.ebook_num
       WHERE r.user_id = ? ORDER BY r.ebook_num`,
      id,
    ),
    q<{
      season_n: number;
      score: number;
      total: number;
      score_pct: number;
      best_pct: number;
      passed: number;
      attempts: number;
      submitted_at: number;
      passed_at: number | null;
    }>(
      db,
      `SELECT season_n, score, total, score_pct, best_pct, passed, attempts, submitted_at, passed_at
       FROM season_test_results WHERE user_id = ? ORDER BY season_n`,
      id,
    ),
    q<{ id: string; code: string; season_n: number; score_pct: number; issued_at: number; revoked_at: number | null }>(
      db,
      `SELECT id, code, season_n, score_pct, issued_at, revoked_at FROM certificates
       WHERE user_id = ? ORDER BY season_n`,
      id,
    ),
    q<{ points: number; streak: number; last_day: string | null }>(
      db,
      'SELECT points, streak, last_day FROM user_stats WHERE user_id = ?',
      id,
    ),
    q<{ maggie: number | null; goals: number | null }>(
      db,
      'SELECT SUM(maggie_sec) AS maggie, SUM(goal_hit) AS goals FROM daily_stats WHERE user_id = ?',
      id,
    ),
    q<{
      local_date: string;
      points: number;
      steps: number;
      cards: number;
      mic: number;
      extras: number;
      maggie_sec: number;
      goal_hit: number;
    }>(
      db,
      `SELECT local_date, points, steps, cards, mic, extras, maggie_sec, goal_hit FROM daily_stats
       WHERE user_id = ? AND local_date >= ?`,
      id,
      since,
    ),
    q<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM srs_cards WHERE user_id = ?', id),
    q<{ episode_num: number; stars: number; comment: string | null; updated_at: number }>(
      db,
      'SELECT episode_num, stars, comment, updated_at FROM lesson_feedback WHERE user_id = ? ORDER BY episode_num',
      id,
    ),
  ]);
  const user = users[0];
  if (!user || user.status === 'deleted') throw new ApiError('not_found');
  const tz = safeTimeZone(user.tz || DEFAULT_TZ);
  const byDate = new Map(days.map((d) => [d.local_date, d]));
  const last30 = lastDates(localDate(now, tz), 30).map((date) => {
    const d = byDate.get(date);
    return {
      date,
      points: d?.points ?? 0,
      steps: d?.steps ?? 0,
      cards: d?.cards ?? 0,
      mic: d?.mic ?? 0,
      extras: d?.extras ?? 0,
      maggieSec: Math.max(0, d?.maggie_sec ?? 0),
      goal: (d?.goal_hit ?? 0) > 0,
    };
  });
  const st = stats[0];
  const out: UserLearningStats = {
    userId: user.id,
    episodes: episodes.map((e) => ({
      num: e.episode_num,
      title: e.title,
      seasonN: e.season_n,
      furthestStep: Math.min(10, Math.max(1, e.furthest_step)),
      done: e.done_at != null,
      doneAt: e.done_at,
      updatedAt: e.updated_at,
    })),
    ebookTests: ebooks.map((r) => ({
      ebookNum: r.ebook_num,
      score: Math.max(0, r.score),
      passScore: r.pass_score,
      passed: r.passed === 1,
      submittedAt: r.submitted_at,
    })),
    seasonTests: seasons.map((r) => ({
      seasonN: r.season_n,
      score: Math.max(0, r.score),
      total: Math.max(0, r.total),
      scorePct: r.score_pct,
      bestPct: r.best_pct,
      passed: r.passed === 1,
      attempts: Math.max(0, r.attempts),
      submittedAt: r.submitted_at,
      passedAt: r.passed_at,
    })),
    certificates: certs.map((r) => ({
      id: r.id,
      code: r.code,
      seasonN: r.season_n,
      scorePct: r.score_pct,
      issuedAt: r.issued_at,
      revokedAt: r.revoked_at,
    })),
    study: {
      points: Math.max(0, st?.points ?? 0),
      streak: Math.max(0, st?.streak ?? 0),
      lastDay: st?.last_day ?? null,
      maggieSecTotal: Math.max(0, totals[0]?.maggie ?? 0),
      maggieSec30d: last30.reduce((a, d) => a + d.maggieSec, 0),
      activeDays30d: last30.filter((d) => byDate.has(d.date)).length,
      goalDays: Math.max(0, totals[0]?.goals ?? 0),
      srsCards: cards[0]?.n ?? 0,
    },
    last30,
    feedback: ratings
      .filter((r) => r.stars >= 1 && r.stars <= 5)
      .map((r) => ({ episodeNum: r.episode_num, stars: r.stars, comment: r.comment, updatedAt: r.updated_at })),
  };
  return c.json(out);
});

// ---------- Course funnel ----------

route(routes, adminStatsApi.learning, async (c) => {
  const { days } = queryOf(c, adminStatsApi.learning.query);
  const db = c.env.DB;
  const now = Date.now();
  const dates = lastDates(localDate(now, DEFAULT_TZ), days);
  const first = dates[0] ?? localDate(now, DEFAULT_TZ);
  const last = dates[dates.length - 1] ?? first;
  const [episodes, ratings, ebooks, ebookResults, seasons, active] = await batch(db, [
    // Correlated counts per published episode walk ix_progress_ep (episode_num, done_at).
    q<{ num: number; title: string; season_n: number | null; started: number; completed: number }>(
      db,
      `SELECT e.num, e.title, e.season_n,
         (SELECT COUNT(*) FROM episode_progress p WHERE p.episode_num = e.num AND ${learnerOnly('p.user_id')}) AS started,
         (SELECT COUNT(*) FROM episode_progress p WHERE p.episode_num = e.num AND p.done_at IS NOT NULL
            AND ${learnerOnly('p.user_id')}) AS completed
       FROM episodes e WHERE e.status = 'published' ORDER BY e.num`,
    ),
    q<{ episode_num: number; stars: number; n: number }>(
      db,
      `SELECT f.episode_num, f.stars, COUNT(*) AS n FROM lesson_feedback f
       WHERE ${learnerOnly('f.user_id')} GROUP BY f.episode_num, f.stars`,
    ),
    // E-books open to learners: a published episode belongs to them.
    q<{ num: number }>(
      db,
      `SELECT b.num FROM ebooks b
       WHERE EXISTS (SELECT 1 FROM episodes e WHERE e.ebook_num = b.num AND e.status = 'published') ORDER BY b.num`,
    ),
    q<{ ebook_num: number; takers: number; passed: number | null }>(
      db,
      `SELECT r.ebook_num, COUNT(*) AS takers, SUM(CASE WHEN r.passed = 1 THEN 1 ELSE 0 END) AS passed
       FROM ebook_test_results r WHERE r.submitted_at > 0 AND ${learnerOnly('r.user_id')} GROUP BY r.ebook_num`,
    ),
    q<{
      n: number;
      test_published: number;
      takers: number;
      passed: number;
      avg_attempts: number | null;
      certs: number;
    }>(
      db,
      `SELECT s.n, s.test_published,
         (SELECT COUNT(*) FROM season_test_results r WHERE r.season_n = s.n AND r.attempts > 0
            AND ${learnerOnly('r.user_id')}) AS takers,
         (SELECT COUNT(*) FROM season_test_results r WHERE r.season_n = s.n AND r.attempts > 0
            AND r.passed_at IS NOT NULL AND ${learnerOnly('r.user_id')}) AS passed,
         (SELECT AVG(r.attempts) FROM season_test_results r WHERE r.season_n = s.n AND r.attempts > 0
            AND ${learnerOnly('r.user_id')}) AS avg_attempts,
         (SELECT COUNT(*) FROM certificates ce WHERE ce.season_n = s.n AND ce.revoked_at IS NULL) AS certs
       FROM seasons s ORDER BY s.n`,
    ),
    // daily_stats rows are keyed (user_id, local_date): one row per learner and day, so COUNT(*) is the
    // number of distinct learners. Dates are each learner's own calendar day (daily_stats.local_date);
    // the window is São Paulo's (DEFAULT_TZ), where nearly every learner is.
    q<{ local_date: string; n: number }>(
      db,
      `SELECT d.local_date, COUNT(*) AS n FROM daily_stats d
       WHERE d.local_date >= ?1 AND d.local_date <= ?2 AND ${learnerOnly('d.user_id')}
       GROUP BY d.local_date`,
      first,
      last,
    ),
  ]);
  const dists = new Map<number, Dist>();
  for (const r of ratings) {
    const d = dists.get(r.episode_num) ?? emptyStarDist();
    addStars(d, r.stars, r.n);
    dists.set(r.episode_num, d);
  }
  const results = new Map(ebookResults.map((r) => [r.ebook_num, r]));
  const ebookNums = [...new Set([...ebooks.map((b) => b.num), ...ebookResults.map((r) => r.ebook_num)])].sort(
    (a, b) => a - b,
  );
  const activeBy = new Map(active.map((r) => [r.local_date, r.n]));
  const out: LearningStats = {
    generatedAt: now,
    days,
    episodes: episodes.map((e) => {
      const s = feedbackStats(dists.get(e.num) ?? emptyStarDist());
      return {
        num: e.num,
        title: e.title,
        seasonN: e.season_n,
        started: e.started,
        completed: e.completed,
        completionPct: pct(e.completed, e.started),
        ratings: s.count,
        avgStars: s.avg,
        nps: s.nps,
      };
    }),
    ebookTests: ebookNums.map((n) => {
      const r = results.get(n);
      const takers = r?.takers ?? 0;
      const passed = r?.passed ?? 0;
      return { ebookNum: n, takers, passed, passPct: pct(passed, takers) };
    }),
    seasonTests: seasons.map((s) => ({
      seasonN: s.n,
      published: s.test_published === 1,
      takers: s.takers,
      passed: s.passed,
      passPct: pct(s.passed, s.takers),
      avgAttempts: s.avg_attempts == null ? null : Math.round(s.avg_attempts * 10) / 10,
      certificates: s.certs,
    })),
    activeByDay: dates.map((date) => ({ date, learners: activeBy.get(date) ?? 0 })),
  };
  return c.json(out);
});

export default routes;
