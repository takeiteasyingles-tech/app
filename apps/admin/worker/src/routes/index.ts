// S10 Admin: /admin-api/* route modules (auth, users, plans, content, ai, releases, media, moderation,
// ops) mount here. Paths are absolute (adminApi.*.path), so this router is mounted at '/'.
import type { AppEnv } from '@tie/worker-core';
import { Hono } from 'hono';

const routes = new Hono<AppEnv>();

export default routes;
