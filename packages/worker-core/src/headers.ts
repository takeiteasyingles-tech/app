import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './env';

/** Content-Security-Policy from spec 04 §5 (also emitted in each app's public/_headers). */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  'frame-src https://challenges.cloudflare.com',
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CSP,
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

/** Copies into a mutable Response when the current one has immutable headers (fetch/R2/ASSETS). */
function mutable(res: Response): Response {
  try {
    res.headers.set('X-Content-Type-Options', 'nosniff');
    return res;
  } catch {
    return new Response(res.body, res);
  }
}

export interface SecurityHeaderOptions {
  /** Cache-Control for responses that set none (API JSON defaults to no-store). */
  defaultCacheControl?: string;
}

export function securityHeaders(opts: SecurityHeaderOptions = {}): MiddlewareHandler<AppEnv> {
  const cacheControl = opts.defaultCacheControl ?? 'no-store';
  return async (c, next) => {
    await next();
    const res = mutable(c.res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
    if (!res.headers.has('Cache-Control')) res.headers.set('Cache-Control', cacheControl);
    if (res !== c.res) c.res = res;
  };
}
