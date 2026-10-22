// NPS per episode (spec 07, feature C): PUT /api/feedback/episodes/:n. The learner rates an episode
// 1-5 stars from the Concluído screen, with an optional comment. One rating per learner and episode
// (upsert keeps created_at); an absent `comment` keeps the stored one, null clears it. Queueable
// offline: OUTBOX_PATHS lists the path, so the idempotency middleware replays a retried write once.
import { EpisodeFeedbackBody, type EpisodeFeedbackRes, feedbackApi, NumParams, newId } from '@tie/shared';
import { type AppEnv, batch, fail, one, q, rateLimit, requireUser, vJson, vParam } from '@tie/worker-core';
import { Hono } from 'hono';
import { contentSource } from '../learning/content';
import { depsFrom } from '../learning/deps';

const routes = new Hono<AppEnv>();

/** Ratings open once the episode is done, or its last step (10) has been reached. */
export const FEEDBACK_MIN_STEP = 10;

routes.use('/api/feedback/*', requireUser(), rateLimit('RL_API'));

routes.put(feedbackApi.episode.path, vParam(NumParams), vJson(EpisodeFeedbackBody), async (c) => {
  const n = c.req.valid('param').n;
  const body = c.req.valid('json');
  const d = depsFrom(c);
  const [episodes, progress] = await batch(d.db, [
    q<{ status: string }>(d.db, 'SELECT status FROM episodes WHERE num = ?', n),
    q<{ furthest_step: number; done_at: number | null }>(
      d.db,
      'SELECT furthest_step, done_at FROM episode_progress WHERE user_id = ? AND episode_num = ?',
      d.userId,
      n,
    ),
  ]);
  // Published as the learner sees it: the live snapshot's catalog when there is one, else D1.
  const src = await contentSource(d);
  const status = src.kind === 'snapshot' ? src.catalog.episodes.find((e) => e.num === n)?.status : episodes[0]?.status;
  if (!episodes[0] || status !== 'published') throw fail('content_unavailable');
  const p = progress[0];
  if (!p || (p.done_at == null && p.furthest_step < FEEDBACK_MIN_STEP)) {
    throw fail('gated', 'Conclua o episódio para avaliá-lo.', { episode: n });
  }
  const keepComment = body.comment === undefined;
  const row = await one<{ stars: number; comment: string | null; updated_at: number }>(
    d.db,
    `INSERT INTO lesson_feedback(id, user_id, episode_num, stars, comment, created_at, updated_at)
     VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?6)
     ON CONFLICT(user_id, episode_num) DO UPDATE SET
       stars = excluded.stars,
       comment = CASE WHEN ?7 = 1 THEN lesson_feedback.comment ELSE excluded.comment END,
       updated_at = excluded.updated_at
     RETURNING stars, comment, updated_at`,
    newId(),
    d.userId,
    n,
    body.stars,
    keepComment ? null : (body.comment ?? null),
    d.now,
    keepComment ? 1 : 0,
  );
  if (!row) throw fail('internal');
  return c.json({
    episode: n,
    feedback: { stars: row.stars, comment: row.comment },
    updatedAt: row.updated_at,
  } satisfies EpisodeFeedbackRes);
});

export default routes;
