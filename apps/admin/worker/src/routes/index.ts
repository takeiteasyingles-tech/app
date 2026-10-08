// S10 Admin: every /admin-api/* route module plus the staff media server (/m/*). Paths are absolute
// (adminApi.*.path), so this router is mounted at '/'.
import type { AppEnv } from '@tie/worker-core';
import { Hono } from 'hono';
import ai from './ai';
import auth from './auth';
import content from './content';
import media from './media';
import moderation from './moderation';
import ops from './ops';
import plans from './plans';
import publish from './publish';
import users from './users';

const routes = new Hono<AppEnv>();

// publish first: its literal /admin-api/content/preview|publish paths are POST-only and never clash
// with the per-entity routes, but registering them early keeps the intent obvious.
for (const r of [auth, users, plans, publish, content, ai, media, moderation, ops]) routes.route('/', r);

export default routes;
