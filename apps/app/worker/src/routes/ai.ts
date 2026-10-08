// S7 AI backend: /api/tutor, /api/report, /api/pronounce, /api/tts (GET /api/health lives in index.ts until then).
// Empty until the slice lands; mounted at '/' by worker/src/index.ts, so paths are absolute (appApi.*.path).
import type { AppEnv } from '@tie/worker-core';
import { Hono } from 'hono';

const routes = new Hono<AppEnv>();

export default routes;
