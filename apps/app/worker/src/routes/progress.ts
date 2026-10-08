// S2 Player: /api/progress/* (step-ok, advance, episode-done, exercise, mic). Mounted at '/' by
// worker/src/index.ts, so paths are absolute (appApi.progress.*.path). Logic lives in ../learning.
import {
  AdvanceBody,
  type AdvanceRes,
  EpisodeDoneBody,
  type EpisodeDoneRes,
  ExerciseBody,
  type ExerciseRes,
  MicScoreBody,
  type MicScoreRes,
  progressApi,
  StepOkBody,
  type StepOkRes,
} from '@tie/shared';
import { type AppEnv, rateLimit, requireUser, vJson } from '@tie/worker-core';
import { Hono } from 'hono';
import { depsFrom } from '../learning/deps';
import { advance, episodeDone, exercise, micScore, stepOk } from '../learning/progress';

const routes = new Hono<AppEnv>();

routes.use('/api/progress/*', requireUser(), rateLimit('RL_API'));

routes.post(progressApi.stepOk.path, vJson(StepOkBody), async (c) =>
  c.json((await stepOk(depsFrom(c), c.req.valid('json'))) satisfies StepOkRes),
);

routes.post(progressApi.advance.path, vJson(AdvanceBody), async (c) =>
  c.json((await advance(depsFrom(c), c.req.valid('json'))) satisfies AdvanceRes),
);

routes.post(progressApi.episodeDone.path, vJson(EpisodeDoneBody), async (c) =>
  c.json((await episodeDone(depsFrom(c), c.req.valid('json'))) satisfies EpisodeDoneRes),
);

routes.post(progressApi.exercise.path, vJson(ExerciseBody), async (c) =>
  c.json((await exercise(depsFrom(c), c.req.valid('json'))) satisfies ExerciseRes),
);

routes.post(progressApi.mic.path, vJson(MicScoreBody), async (c) =>
  c.json((await micScore(depsFrom(c), c.req.valid('json'))) satisfies MicScoreRes),
);

export default routes;
