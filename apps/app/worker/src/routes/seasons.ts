// Season test (spec 07, feature B): /api/seasons/:n/test (view, answers, submit). Mounted at '/' by
// worker/src/index.ts, so paths are absolute (seasonsApi.*.path). Logic lives in ../learning/seasonTest.
import { type Ok, SeasonParams, SeasonTestAnswersBody, SeasonTestSubmitBody, seasonsApi } from '@tie/shared';
import { type AppEnv, rateLimit, requireUser, vJson, vParam } from '@tie/worker-core';
import { type Context, Hono } from 'hono';
import { depsFrom } from '../learning/deps';
import { saveSeasonAnswers, seasonTestView, submitSeasonTest } from '../learning/seasonTest';

const routes = new Hono<AppEnv>();

/** The student app's public origin (verification URLs): APP_ORIGIN, else the request's own. */
export function appOrigin(c: Context<AppEnv>): string {
  try {
    return new URL(c.env.APP_ORIGIN).origin;
  } catch {
    return new URL(c.req.url).origin;
  }
}

routes.use('/api/seasons/*', requireUser(), rateLimit('RL_API'));

routes.get(seasonsApi.test.path, vParam(SeasonParams), async (c) =>
  c.json(await seasonTestView(depsFrom(c), c.req.valid('param').n, appOrigin(c))),
);

routes.put(seasonsApi.testAnswers.path, vParam(SeasonParams), vJson(SeasonTestAnswersBody), async (c) =>
  c.json((await saveSeasonAnswers(depsFrom(c), c.req.valid('param').n, c.req.valid('json'))) satisfies Ok),
);

routes.post(seasonsApi.testSubmit.path, vParam(SeasonParams), vJson(SeasonTestSubmitBody), async (c) =>
  c.json(await submitSeasonTest(depsFrom(c), c.req.valid('param').n, c.req.valid('json'), appOrigin(c))),
);

export default routes;
