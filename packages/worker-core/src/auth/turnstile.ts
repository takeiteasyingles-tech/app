import { isLocalOrigin } from '../config';
import type { Env } from '../env';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Cloudflare's always-pass test secret (local dev). Its siteverify replies carry no real action. */
export const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';
export const TURNSTILE_TEST_SITEKEY = '1x00000000000000000000AA';

export interface TurnstileResult {
  success: boolean;
  action?: string;
  hostname?: string;
  'error-codes'?: string[];
}

export interface VerifyOptions {
  /** Client IP (CF-Connecting-IP), forwarded as remoteip. */
  ip?: string | null;
  /** Expected widget action ('login', 'signup', 'reset'); mismatch fails. */
  action?: string;
  /** Override for tests. */
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export type TurnstileVerdict = { ok: true } | { ok: false; reason: string };

/** Server-side Turnstile check. Never throws: network errors count as failure. */
export async function verifyTurnstile(
  env: Pick<Env, 'TURNSTILE_SECRET' | 'APP_ORIGIN'>,
  token: string | null | undefined,
  opts: VerifyOptions = {},
): Promise<TurnstileVerdict> {
  if (!token || token.length > 2048) return { ok: false, reason: 'missing-input-response' };
  const testSecret = env.TURNSTILE_SECRET === TURNSTILE_TEST_SECRET;
  // Offline local dev: the test secret passes every token anyway, so skip the network call.
  if (testSecret && isLocalOrigin(env.APP_ORIGIN)) return { ok: true };

  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (opts.ip) form.append('remoteip', opts.ip);
  form.append('idempotency_key', crypto.randomUUID());

  let data: TurnstileResult;
  try {
    const res = await (opts.fetcher ?? fetch)(SITEVERIFY, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };
    data = (await res.json()) as TurnstileResult;
  } catch {
    return { ok: false, reason: 'network-error' };
  }

  if (!data.success) return { ok: false, reason: data['error-codes']?.join(',') || 'invalid' };
  if (opts.action && !testSecret && data.action !== opts.action) return { ok: false, reason: 'action-mismatch' };
  return { ok: true };
}
