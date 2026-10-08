import { ApiError, newId } from '@tie/shared';
import { Hono, type MiddlewareHandler } from 'hono';
import { configGuard } from './config';
import { type CsrfOptions, csrf } from './csrf';
import type { AppEnv } from './env';
import { onError, onNotFound } from './errors';
import { securityHeaders } from './headers';
import { readLimited } from './r2/upload';
import { createServices, type ServiceFactories } from './services/registry';

export interface CreateAppOptions {
  /** Real service implementations; anything missing resolves to a NotImplemented stub. */
  services?: ServiceFactories;
  /** Routes that accept multipart/form-data (photo upload, admin media). */
  multipart?: CsrfOptions['multipart'];
  /** Cache-Control for responses that set none. Default 'no-store'. */
  defaultCacheControl?: string;
  /** Declared JSON bodies above this are rejected before parsing. Default 1 MB (pronounce audio is ≤700 KB). */
  maxJsonBytes?: number;
}

const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = c.req.header('CF-Ray') ?? newId();
  c.set('requestId', id);
  await next();
  try {
    c.res.headers.set('X-Request-Id', id);
  } catch {
    // Immutable passthrough response; the id is still in the logs.
  }
};

/**
 * Caps JSON bodies at maxBytes. A declared Content-Length is checked up front; a chunked body
 * (no Content-Length) is read through readLimited() and handed on as a buffered request, so the
 * validator never buffers more than the cap.
 */
export function jsonLimit(maxBytes: number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const raw = c.req.raw;
    const ct = raw.headers.get('Content-Type') ?? '';
    if (!/^application\/json/i.test(ct) || !raw.body || raw.method === 'GET' || raw.method === 'HEAD') return next();
    const declared = raw.headers.get('Content-Length');
    if (declared !== null) {
      const n = Number(declared);
      if (!Number.isFinite(n)) throw new ApiError('bad_request');
      if (n > maxBytes) throw new ApiError('payload_too_large');
      return next();
    }
    const bytes = await readLimited(raw.body, maxBytes);
    c.req.raw = new Request(raw.url, { method: raw.method, headers: raw.headers, body: bytes });
    return next();
  };
}

/**
 * Hono app with the shared middleware stack: request id → security headers → deploy config guard →
 * CSRF → JSON size guard → per-request services. Errors (thrown ApiError, zod, Hono, unknown) render the shared
 * {error:{code,message}} envelope; unknown errors are logged and answered as 500 `internal`.
 */
export function createApp(opts: CreateAppOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requestId);
  app.use('*', securityHeaders({ defaultCacheControl: opts.defaultCacheControl }));
  app.use('*', configGuard());
  app.use('*', csrf({ multipart: opts.multipart }));
  app.use('*', jsonLimit(opts.maxJsonBytes ?? 1024 * 1024));
  app.use('*', async (c, next) => {
    c.set('services', createServices(c.env, opts.services));
    await next();
  });
  app.onError(onError);
  app.notFound(onNotFound);
  return app;
}
