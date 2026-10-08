// S5 SRS: /api/srs/* (queue, cards, grade). Mounted at '/' by worker/src/index.ts, so paths are absolute.
import { AddCardsBody, type AddCardsRes, appApi, GradeBody, type GradeRes, IdParams, norm } from '@tie/shared';
import { type AppEnv, now, rateLimit, requireUser, sessionOf, vJson, vParam } from '@tie/worker-core';
import { Hono } from 'hono';
import { safeAward, srsQueue } from '../services/srs.impl';

const api = appApi.srs;
const routes = new Hono<AppEnv>();

routes.use('/api/srs/*', requireUser());

routes.get(api.queue.path, async (c) => {
  const { userId } = sessionOf(c);
  return c.json(await srsQueue(c.env.DB, userId, now()));
});

// Manual add (Extras line, Mic word, report words). Cards already in the deck are skipped; one `word`
// award per request when something new was added.
routes.post(api.addCards.path, rateLimit('RL_API'), vJson(AddCardsBody), async (c) => {
  const { userId } = sessionOf(c);
  const { cards } = c.req.valid('json');
  const services = c.get('services');
  const res = await services.srs.add(userId, cards);
  const first = res.added[0];
  const award = first ? await safeAward(services.award, userId, 'word', `word:${norm(first.en)}`) : null;
  return c.json({ ...res, award } satisfies AddCardsRes);
});

// Owner-only: the service looks the card up by (id, user_id) and answers 404 for anyone else's card.
routes.post(api.grade.path, rateLimit('RL_API'), vParam(IdParams), vJson(GradeBody), async (c) => {
  const { userId } = sessionOf(c);
  const { id } = c.req.valid('param');
  const { grade } = c.req.valid('json');
  const res = await c.get('services').srs.grade(userId, id, grade);
  return c.json(res satisfies GradeRes);
});

export default routes;
