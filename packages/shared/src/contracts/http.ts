import type { z } from 'zod';
import type { Permission } from '../authz';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * public: no session. user: app session. owner: app session that owns the :id resource.
 * staff: admin session; `perm` names the required permission (authz.ts).
 */
export type Access = 'public' | 'user' | 'owner' | 'staff';

export type RateLimitBinding = 'RL_AUTH' | 'RL_AI' | 'RL_API' | 'RL_UPLOAD';

export interface EndpointDef {
  readonly method: HttpMethod;
  /** Hono path syntax (`:id`, `:file{.+}`). */
  readonly path: string;
  readonly access: Access;
  readonly perm?: Permission;
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  /** JSON body schema. Multipart endpoints set `multipart` instead and validate in the route. */
  readonly body?: z.ZodType;
  readonly multipart?: { readonly field: string; readonly maxBytes: number; readonly mime: readonly string[] };
  /** Response schema, or 'binary' for raw bytes (audio, media). */
  readonly res: z.ZodType | 'binary';
  readonly rateLimit?: RateLimitBinding;
  /** Bills AI seconds against the monthly plan quota. */
  readonly quota?: boolean;
  /** Every read is written to audit_log (mic transcripts). */
  readonly audited?: boolean;
}

/** Identity helper that keeps the literal types of an endpoint definition. */
export function endpoint<const E extends EndpointDef>(def: E): E {
  return def;
}

/** What the client sends (undefined when the endpoint takes no JSON body). */
export type BodyIn<E> = E extends { readonly body: infer S extends z.ZodType } ? z.input<S> : undefined;
/** What the route handler receives after validation. */
export type BodyOut<E> = E extends { readonly body: infer S extends z.ZodType } ? z.output<S> : undefined;
export type QueryIn<E> = E extends { readonly query: infer S extends z.ZodType } ? z.input<S> : undefined;
export type QueryOut<E> = E extends { readonly query: infer S extends z.ZodType } ? z.output<S> : undefined;
export type ParamsIn<E> = E extends { readonly params: infer S extends z.ZodType } ? z.input<S> : undefined;
export type ParamsOut<E> = E extends { readonly params: infer S extends z.ZodType } ? z.output<S> : undefined;
/** Parsed JSON response, or ArrayBuffer for 'binary' endpoints. */
export type ResOf<E> = E extends { readonly res: infer S extends z.ZodType } ? z.output<S> : ArrayBuffer;

/** Fills `:name` / `:name{regex}` segments: buildPath('/api/ebooks/:n/download', {n: 1}). */
export function buildPath(path: string, params: Readonly<Record<string, string | number>> = {}): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)(\{[^}]*\})?/g, (_m, name: string) => {
    const v = params[name];
    if (v === undefined) throw new Error(`missing path param "${name}" for ${path}`);
    return String(v)
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
  });
}
