// S4 Game: POST /api/game/event, soft (client-attested) awards with daily caps.
// Mounted at '/' by worker/src/index.ts, so paths are absolute (appApi.*.path). The game summary is
// served by GET /api/me/summary (meApi), which uses gameSummaryFor() from ../game.
import { type AwardResult, GameEventBody, gameApi } from '@tie/shared';
import { type AppEnv, rateLimit, requireUser, sessionOf, vJson } from '@tie/worker-core';
import { Hono } from 'hono';
import { softAwardKey } from '../game/keys';

const routes = new Hono<AppEnv>();

routes.post(gameApi.event.path, requireUser(), rateLimit('RL_API'), vJson(GameEventBody), async (c) => {
  const s = sessionOf(c);
  const body = c.req.valid('json');
  const now = Date.now();
  const key = await softAwardKey(c.env.DB, body, s.tz, now);
  const res: AwardResult = await c.get('services').award.award(s.userId, body.kind, key, { now });
  return c.json(res);
});

export default routes;
