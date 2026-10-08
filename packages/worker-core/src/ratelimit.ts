import { ApiError } from '@tie/shared';
import type { Context, MiddlewareHandler } from 'hono';
import { isLocalOrigin } from './config';
import type { AppEnv, Env, RateLimitBinding } from './env';

// Workers Rate Limiting bindings (limits live in wrangler.jsonc):
//   RL_AUTH 5/60s by ip+email · RL_AI 20/60s by user · RL_API 100/10s by user · RL_UPLOAD 5/60s by user.
// The binding is per-colo and eventually consistent: a brake on abuse, not an exact counter.

/** CF-Connecting-IP is set by Cloudflare's edge (and by wrangler dev); never trust client-sent headers. */
export function clientIp(c: Context): string {
  return c.req.header('CF-Connecting-IP') ?? '0.0.0.0';
}

/** Throws ApiError('rate_limited') when the key is over its limit. */
export async function checkRateLimit(env: Env, binding: RateLimitBinding, key: string): Promise<void> {
  const limiter = env[binding] as RateLimit | undefined;
  if (!limiter) {
    // Fail open only for local dev and tests (APP_ORIGIN on localhost). Anywhere else a missing
    // binding is a wrangler.jsonc mistake that would silently disable the limit, so fail closed.
    if (isLocalOrigin(env.APP_ORIGIN)) {
      console.warn(`rate limit binding ${binding} is missing`);
      return;
    }
    console.error(JSON.stringify({ level: 'error', msg: 'rate limit binding missing', binding }));
    throw new ApiError('internal');
  }
  const { success } = await limiter.limit({ key: `${binding}:${key}` });
  if (!success) throw new ApiError('rate_limited');
}

export type RateKeyFn = (c: Context<AppEnv>) => string | Promise<string>;

/** Default keys: the session user when there is one, else the client IP. */
export const userOrIpKey: RateKeyFn = (c) => {
  const s = c.get('session');
  return s ? `u:${s.userId}` : `ip:${clientIp(c)}`;
};

export function rateLimit(binding: RateLimitBinding, key: RateKeyFn = userOrIpKey): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await checkRateLimit(c.env, binding, await key(c));
    await next();
  };
}

/** RL_AUTH key: ip + lowercased email, called from the auth route after body validation. */
export function authRateKey(c: Context, email: string): string {
  return `${clientIp(c)}|${email.trim().toLowerCase()}`;
}
