// S3 Trilha & e-book: /api/ebooks/:n/* (download, test answers, test submit). Mounted at '/' by
// worker/src/index.ts, so paths are absolute (appApi.ebook.*.path). Logic lives in ../learning.
import {
  type DownloadRes,
  EbookParams,
  ebookApi,
  type Ok,
  TestAnswersBody,
  type TestResult,
  TestSubmitBody,
} from '@tie/shared';
import { type AppEnv, rateLimit, requireUser, vJson, vParam } from '@tie/worker-core';
import { Hono } from 'hono';
import { depsFrom } from '../learning/deps';
import { download, saveAnswers, submitTest } from '../learning/ebook';

const routes = new Hono<AppEnv>();

routes.use('/api/ebooks/*', requireUser(), rateLimit('RL_API'));

routes.post(ebookApi.download.path, vParam(EbookParams), async (c) =>
  c.json((await download(depsFrom(c), c.req.valid('param').n)) satisfies DownloadRes),
);

routes.put(ebookApi.testAnswers.path, vParam(EbookParams), vJson(TestAnswersBody), async (c) =>
  c.json((await saveAnswers(depsFrom(c), c.req.valid('param').n, c.req.valid('json'))) satisfies Ok),
);

routes.post(ebookApi.testSubmit.path, vParam(EbookParams), vJson(TestSubmitBody), async (c) =>
  c.json((await submitTest(depsFrom(c), c.req.valid('param').n, c.req.valid('json'))) satisfies TestResult),
);

export default routes;
