import { zValidator } from '@hono/zod-validator';
import { ApiError } from '@tie/shared';
import type { ValidationTargets } from 'hono';
import type { ZodError, z } from 'zod';
import { zodIssues } from './errors';

// zod-validator wrappers: failures throw ApiError('validation_failed') so onError renders the shared
// envelope with {issues:[{path,code,message}]} in details. Admin schemas are .strict() and app
// schemas strip unknown keys; that choice lives in @tie/shared/contracts, not here.

function hook(result: { success: true } | { success: false; error: unknown }): void {
  if (!result.success) {
    throw new ApiError('validation_failed', undefined, { issues: zodIssues(result.error as ZodError) });
  }
}

function make<Target extends keyof ValidationTargets>(target: Target) {
  return <T extends z.ZodType>(schema: T) => zValidator(target, schema, hook);
}

/** Validates a JSON body: `app.post(path, vJson(LoginBody), (c) => c.req.valid('json'))`. */
export const vJson = make('json');
export const vQuery = make('query');
export const vParam = make('param');
export const vForm = make('form');

/** Parses arbitrary data (e.g. a multipart field or stored JSON) with the same error contract. */
export function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const res = schema.safeParse(value);
  if (!res.success) throw new ApiError('validation_failed', undefined, { issues: zodIssues(res.error) });
  return res.data;
}
