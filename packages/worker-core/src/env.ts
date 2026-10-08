import type { RateLimitBinding } from '@tie/shared/contracts';
import type { SessionInfo } from './auth/sessions';
import type { Services } from './services/registry';

/** Bindings, secrets and vars shared by tie-app and tie-admin (see wrangler.jsonc of each app). */
export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  AI: Ai;
  ASSETS: Fetcher;
  RL_AUTH: RateLimit;
  RL_AI: RateLimit;
  RL_API: RateLimit;
  RL_UPLOAD: RateLimit;
  // Secrets
  TURNSTILE_SECRET: string;
  MEDIA_TOKEN_KEY: string;
  IP_HASH_SALT: string;
  // Vars
  TURNSTILE_SITEKEY: string;
  /** Canonical origin, e.g. https://tie-app.example.workers.dev (no trailing slash). */
  APP_ORIGIN: string;
  /** Cookie name prefix. Unset → `__Host-`; set to '' for plain-HTTP localhost. */
  COOKIE_PREFIX?: string;
}

export type Audience = 'app' | 'admin';

export interface AppVariables {
  requestId: string;
  services: Services;
  /** Set by loadSession / requireUser / requireRole. */
  session?: SessionInfo;
}

/** Hono generic for every route module: `new Hono<AppEnv>()`. */
export interface AppEnv {
  Bindings: Env;
  Variables: AppVariables;
}

export type { RateLimitBinding };
