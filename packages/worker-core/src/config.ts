import { ApiError, COOKIES } from '@tie/shared';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv, Env } from './env';

// Deploy-time configuration check. wrangler.jsonc ships production-shaped vars and local dev
// overrides them from .dev.vars; this guard makes a deploy that still carries dev values (test
// Turnstile keys, a localhost APP_ORIGIN, COOKIE_PREFIX "") or lacks a binding fail loudly
// instead of quietly dropping __Host- cookies, breaking login or disabling rate limits.

const TURNSTILE_TEST_SITEKEYS = new Set([
  '1x00000000000000000000AA',
  '2x00000000000000000000AB',
  '1x00000000000000000000BB',
  '2x00000000000000000000BB',
  '3x00000000000000000000FF',
]);
const TURNSTILE_TEST_SECRETS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
]);
const RL_BINDINGS = ['RL_AUTH', 'RL_AI', 'RL_API', 'RL_UPLOAD'] as const;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function isLocalHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host.endsWith('.localhost') ||
    host.endsWith('.test')
  );
}

/** True for http(s)://localhost, 127.0.0.1, [::1], *.localhost and *.test. */
export function isLocalOrigin(origin: string | null | undefined): boolean {
  const host = origin ? hostOf(origin) : null;
  return host !== null && isLocalHost(host);
}

/** Everything wrong with `env` for serving real (non-local) traffic; empty when it is fine. */
export function productionConfigProblems(env: Partial<Env>): string[] {
  const out: string[] = [];
  const origin = env.APP_ORIGIN ?? '';
  let url: URL | null = null;
  try {
    url = new URL(origin);
  } catch {
    out.push('APP_ORIGIN is missing or not a URL');
  }
  if (url) {
    if (url.protocol !== 'https:') out.push('APP_ORIGIN must be https');
    if (isLocalHost(url.hostname)) out.push('APP_ORIGIN points to localhost');
  }
  if (env.COOKIE_PREFIX !== undefined && env.COOKIE_PREFIX !== COOKIES.securePrefix) {
    out.push(`COOKIE_PREFIX must be unset (${COOKIES.securePrefix}) in production`);
  }
  if (!env.TURNSTILE_SITEKEY || TURNSTILE_TEST_SITEKEYS.has(env.TURNSTILE_SITEKEY)) {
    out.push('TURNSTILE_SITEKEY is missing or a test key');
  }
  if (!env.TURNSTILE_SECRET || TURNSTILE_TEST_SECRETS.has(env.TURNSTILE_SECRET)) {
    out.push('TURNSTILE_SECRET is missing or a test secret');
  }
  if (!env.MEDIA_TOKEN_KEY) out.push('MEDIA_TOKEN_KEY is missing');
  if (!env.IP_HASH_SALT) out.push('IP_HASH_SALT is missing');
  for (const b of RL_BINDINGS) if (!env[b]) out.push(`${b} binding is missing`);
  return out;
}

const checked = new WeakMap<object, string[]>();

/**
 * Refuses non-local requests (500 internal, logged once per isolate) while the configuration is
 * not production-safe. Requests to localhost are never checked, so `wrangler dev` and tests run as is.
 */
export function configGuard(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const host = hostOf(c.req.url);
    if (host === null || isLocalHost(host)) return next();
    let problems = checked.get(c.env);
    if (!problems) {
      problems = productionConfigProblems(c.env);
      checked.set(c.env, problems);
      if (problems.length) console.error(JSON.stringify({ level: 'error', msg: 'misconfigured deploy', problems }));
    }
    if (problems.length) throw new ApiError('internal');
    return next();
  };
}
