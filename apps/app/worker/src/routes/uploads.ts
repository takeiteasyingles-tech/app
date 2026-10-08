// S1 Uploads: /api/me/photo (POST multipart, DELETE).
// Empty until the slice lands; mounted at '/' by worker/src/index.ts, so paths are absolute (appApi.*.path).
import type { AppEnv } from '@tie/worker-core';
import { Hono } from 'hono';

const routes = new Hono<AppEnv>();

export default routes;
