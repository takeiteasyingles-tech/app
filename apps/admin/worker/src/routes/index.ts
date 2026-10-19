// S10 Admin: every /admin-api/* route module plus the staff media server (/m/*). Paths are absolute
// (adminApi.*.path), so this router is mounted at '/'.
import type { AppEnv } from '@tie/worker-core';
import { Hono } from 'hono';
import ai from './ai';
import apiTokens from './apiTokens';
import auth from './auth';
import content from './content';
import feedback from './feedback';
import media from './media';
import moderation from './moderation';
import ops from './ops';
import plans from './plans';
import publish from './publish';
import seasonTest from './seasonTest';
import users from './users';

const routes = new Hono<AppEnv>();

// publish first: its literal /admin-api/content/preview|publish paths are POST-only and never clash
// with the per-entity routes, but registering them early keeps the intent obvious.
// v1 (spec 07): seasonTest (B), feedback + stats (C), apiTokens (D). Their paths never overlap the
// older ones (/admin-api/users/:id/stats is one segment longer than /admin-api/users/:id).
for (const r of [auth, users, plans, publish, content, ai, media, moderation, ops, seasonTest, feedback, apiTokens]) {
  routes.route('/', r);
}

export default routes;
