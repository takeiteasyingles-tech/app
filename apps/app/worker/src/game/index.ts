// S4 game engine: AwardService implementation, summary and soft-event keys.
//
// Wiring (worker/src/index.ts, integration step): pass the factories to createApp so every route's
// c.get('services').award is the real engine instead of the NotImplemented stub:
//   createApp({ services: { ...gameServices }, multipart: ... })
// GET /api/me/summary (slice S1) builds its game part with `gameSummaryFor(c.env.DB, userId, {tz})`.
import type { ServiceFactories, ServiceFactory } from '@tie/worker-core';
import { createGameEngine } from './engine';

export {
  createGameEngine,
  type GameEngine,
  MAX_AWARD_KEY,
  type SummaryOptions,
  summary as gameSummaryFor,
  summaryLevel,
} from './engine';
export { softAwardKey } from './keys';
export { DEFAULT_DAILY_CAPS, MAGGIE_TURNS_PER_SESSION, SERVER_DAILY_CAPS } from './rules';

export const awardFactory: ServiceFactory<'award'> = (env) => createGameEngine(env.DB);

/** Service factories this slice provides to the worker-core registry. */
export const gameServices: ServiceFactories = { award: awardFactory };
