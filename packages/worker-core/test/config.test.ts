import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { isLocalOrigin, productionConfigProblems } from '../src/config';
import type { Env } from '../src/env';
import { checkRateLimit } from '../src/ratelimit';

const limiter = { limit: async () => ({ success: true }) } as unknown as RateLimit;

function prodEnv(over: Partial<Env> = {}): Env {
  return {
    APP_ORIGIN: 'https://tie-app.acme.workers.dev',
    TURNSTILE_SITEKEY: '0x4AAAAAAAreal',
    TURNSTILE_SECRET: '0x4AAAAAAAsecret',
    MEDIA_TOKEN_KEY: 'k',
    IP_HASH_SALT: 's',
    RL_AUTH: limiter,
    RL_AI: limiter,
    RL_API: limiter,
    RL_UPLOAD: limiter,
    ...over,
  } as Env;
}

describe('isLocalOrigin', () => {
  it('recognizes local dev hosts only', () => {
    expect(isLocalOrigin('http://localhost:8787')).toBe(true);
    expect(isLocalOrigin('http://127.0.0.1:8787')).toBe(true);
    expect(isLocalOrigin('http://[::1]:8787')).toBe(true);
    expect(isLocalOrigin('http://tie.localhost')).toBe(true);
    expect(isLocalOrigin('https://tie-app.acme.workers.dev')).toBe(false);
    expect(isLocalOrigin('')).toBe(false);
    expect(isLocalOrigin(undefined)).toBe(false);
  });
});

describe('productionConfigProblems', () => {
  it('accepts a production-shaped env', () => {
    expect(productionConfigProblems(prodEnv())).toEqual([]);
    expect(productionConfigProblems(prodEnv({ COOKIE_PREFIX: '__Host-' }))).toEqual([]);
  });

  it('flags the old dev vars shipped by a plain deploy', () => {
    const problems = productionConfigProblems(
      prodEnv({
        APP_ORIGIN: 'http://localhost:8787',
        TURNSTILE_SITEKEY: '1x00000000000000000000AA',
        COOKIE_PREFIX: '',
      }),
    );
    expect(problems).toEqual([
      'APP_ORIGIN must be https',
      'APP_ORIGIN points to localhost',
      'COOKIE_PREFIX must be unset (__Host-) in production',
      'TURNSTILE_SITEKEY is missing or a test key',
    ]);
  });

  it('flags empty vars, test secrets and missing bindings', () => {
    const problems = productionConfigProblems(
      prodEnv({
        APP_ORIGIN: '',
        TURNSTILE_SITEKEY: '',
        TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
        RL_AI: undefined as unknown as RateLimit,
      }),
    );
    expect(problems).toContain('APP_ORIGIN is missing or not a URL');
    expect(problems).toContain('TURNSTILE_SITEKEY is missing or a test key');
    expect(problems).toContain('TURNSTILE_SECRET is missing or a test secret');
    expect(problems).toContain('RL_AI binding is missing');
  });
});

describe('configGuard', () => {
  const app = createApp();
  app.get('/api/ok', (c) => c.json({ ok: true }));

  it('refuses non-local traffic while misconfigured', async () => {
    const bad = prodEnv({ APP_ORIGIN: 'http://localhost:8787', COOKIE_PREFIX: '' });
    const res = await app.request('https://tie-app.acme.workers.dev/api/ok', {}, bad);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('internal');
  });

  it('serves non-local traffic when configured, and local traffic always', async () => {
    expect((await app.request('https://tie-app.acme.workers.dev/api/ok', {}, prodEnv())).status).toBe(200);
    const dev = prodEnv({ APP_ORIGIN: 'http://localhost:8787', COOKIE_PREFIX: '' });
    expect((await app.request('http://localhost:8787/api/ok', {}, dev)).status).toBe(200);
  });
});

describe('checkRateLimit without a binding', () => {
  it('fails open on localhost', async () => {
    const env = prodEnv({ APP_ORIGIN: 'http://localhost:8787', RL_AUTH: undefined as unknown as RateLimit });
    await expect(checkRateLimit(env, 'RL_AUTH', 'k')).resolves.toBeUndefined();
  });

  it('fails closed anywhere else', async () => {
    const env = prodEnv({ RL_AUTH: undefined as unknown as RateLimit });
    await expect(checkRateLimit(env, 'RL_AUTH', 'k')).rejects.toMatchObject({ code: 'internal' });
  });

  it('rejects over the limit', async () => {
    const env = prodEnv({ RL_API: { limit: async () => ({ success: false }) } as unknown as RateLimit });
    await expect(checkRateLimit(env, 'RL_API', 'k')).rejects.toMatchObject({ code: 'rate_limited' });
  });
});
