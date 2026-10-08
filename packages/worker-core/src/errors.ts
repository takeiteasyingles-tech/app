import { ApiError, ERROR_STATUS, type ErrorCode, errorEnvelope } from '@tie/shared';
import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import type { AppEnv } from './env';

export { ApiError };

/** Thrown by service stubs until a slice provides the real implementation. */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet`);
    this.name = 'NotImplementedError';
  }
}

/** Shorthand: `throw fail('not_found')`. */
export function fail(code: ErrorCode, message?: string, details?: unknown): ApiError {
  return new ApiError(code, message, details);
}

export function errorResponse(c: Context, code: ErrorCode, message?: string, details?: unknown): Response {
  return c.json(errorEnvelope(code, message, details), ERROR_STATUS[code] as ContentfulStatusCode);
}

function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 413:
      return 'payload_too_large';
    case 415:
      return 'unsupported_media_type';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'internal' : 'bad_request';
  }
}

export function zodIssues(err: ZodError): { path: string; code: string; message: string }[] {
  return err.issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join('.'), code: i.code, message: i.message }));
}

/** app.onError: every failure becomes the {error:{code,message}} envelope; stacks never leave the Worker. */
export const onError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof ApiError) {
    const res = c.json(err.toEnvelope(), err.status as ContentfulStatusCode);
    if (err.code === 'rate_limited' || err.code === 'quota_exceeded') res.headers.set('Retry-After', '60');
    return res;
  }
  if (err instanceof ZodError) return errorResponse(c, 'validation_failed', undefined, { issues: zodIssues(err) });
  if (err instanceof HTTPException) {
    const code = codeForStatus(err.status);
    // Hono's own 4xx messages (e.g. "Malformed JSON in request body") are safe to surface as details.
    return errorResponse(c, code, undefined, err.status < 500 && err.message ? { reason: err.message } : undefined);
  }
  console.error(
    JSON.stringify({
      level: 'error',
      requestId: c.get('requestId'),
      method: c.req.method,
      path: c.req.path,
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );
  return errorResponse(c, 'internal');
};

export const onNotFound: NotFoundHandler<AppEnv> = (c) => errorResponse(c, 'not_found');
