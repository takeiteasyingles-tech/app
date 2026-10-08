import { ApiError } from '@tie/shared';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './env';

// Cookie sessions are SameSite=Lax; this adds the Origin/Sec-Fetch-Site/content-type checks from
// spec 04 §5 for every state-changing request. HTML forms cannot send application/json, and any
// cross-site fetch carries a foreign Origin, so either check alone stops classic CSRF.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const JSON_RE = /^application\/json\s*(;|$)/i;
const MULTIPART_RE = /^multipart\/form-data\s*;/i;

export interface CsrfInput {
  method: string;
  url: string;
  origin: string | null;
  secFetchSite: string | null;
  contentType: string | null;
  contentLength: string | null;
  /** Canonical origin from env.APP_ORIGIN. */
  appOrigin: string;
  /** True for routes that accept multipart uploads. */
  multipart?: boolean;
}

export type CsrfDecision = { ok: true } | { ok: false; reason: string };

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function csrfDecision(input: CsrfInput): CsrfDecision {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return { ok: true };

  if (!input.origin || input.origin === 'null') return { ok: false, reason: 'missing-origin' };
  const origin = normalizeOrigin(input.origin);
  const allowed = new Set([normalizeOrigin(input.appOrigin), normalizeOrigin(input.url)]);
  if (!origin || !allowed.has(origin)) return { ok: false, reason: 'bad-origin' };

  if (input.secFetchSite && input.secFetchSite !== 'same-origin') return { ok: false, reason: 'cross-site' };

  const ct = input.contentType?.trim() ?? '';
  if (ct === '') {
    // Body-less requests (logout, DELETE) may omit Content-Type.
    if (input.contentLength === null || input.contentLength === '0') return { ok: true };
    return { ok: false, reason: 'content-type' };
  }
  if (JSON_RE.test(ct)) return { ok: true };
  if (input.multipart && MULTIPART_RE.test(ct)) return { ok: true };
  return { ok: false, reason: 'content-type' };
}

export interface CsrfOptions {
  /** Paths (as seen by Hono, e.g. '/api/me/photo') that accept multipart/form-data. */
  multipart?: (path: string, method: string) => boolean;
}

export function csrf(opts: CsrfOptions = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const h = c.req.raw.headers;
    const decision = csrfDecision({
      method: c.req.method,
      url: c.req.url,
      origin: h.get('Origin'),
      secFetchSite: h.get('Sec-Fetch-Site'),
      contentType: h.get('Content-Type'),
      contentLength: h.get('Content-Length'),
      appOrigin: c.env.APP_ORIGIN,
      multipart: opts.multipart?.(c.req.path, c.req.method) ?? false,
    });
    if (!decision.ok) {
      const reason = decision.reason;
      // The default unsupported_media_type copy talks about files; a bad request format reads better here.
      throw decision.reason === 'content-type'
        ? new ApiError('unsupported_media_type', 'Pedido inválido.', { reason })
        : new ApiError('csrf_failed', undefined, { reason });
    }
    await next();
  };
}
