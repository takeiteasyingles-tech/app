// Placeholder handlers for v1 endpoints whose routes are not written yet (spec 07 foundation).
// A stub is registered through route(), so it already enforces the staff session, the permission and
// the rate limit of its contract; the handler itself answers 404 not_found. Each feature replaces its
// own stub file (routes/seasonTest.ts, routes/feedback.ts, routes/apiTokens.ts) with real handlers.
import { ApiError, type EndpointDef, listEndpoints } from '@tie/shared';
import type { AppEnv } from '@tie/worker-core';
import { Hono } from 'hono';
import { route } from './http';

export const notYet = (): never => {
  throw new ApiError('not_found', 'Ainda não disponível.');
};

/** A router with every endpoint of `tree` registered to notYet. */
export function stubRoutes(tree: unknown): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  for (const e of listEndpoints(tree) as EndpointDef[]) route(routes, e, notYet);
  return routes;
}
