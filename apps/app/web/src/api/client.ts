// Typed fetch over the @tie/shared endpoint tables: `await call(appApi.me.state)`.
// JSON in/out, same-origin cookies, and every failure surfaces as an ApiError carrying the server's
// {error:{code,message}} envelope (or a synthesized one for network/HTTP errors without a body).
// Narrow subpath imports keep the other endpoint tables (and their schemas) out of the shell chunk.
import { IDEMPOTENCY_HEADER } from '@tie/shared/constants';
import {
  type BodyIn,
  buildPath,
  type EndpointDef,
  type ParamsIn,
  type QueryIn,
  type ResOf,
} from '@tie/shared/contracts/http';
import { ApiError, type ErrorCode, isErrorEnvelope } from '@tie/shared/errors';

export interface CallOptions<E extends EndpointDef> {
  params?: ParamsIn<E>;
  query?: QueryIn<E>;
  body?: BodyIn<E>;
  /** multipart endpoints (photo upload) send FormData instead of JSON. */
  form?: FormData;
  signal?: AbortSignal;
  /** Replayed outbox writes carry the same key so the server applies them once. */
  idempotencyKey?: string;
}

/** Network failure (offline, DNS, aborted): no response reached the client. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Sem conexão. Confira a internet e tente de novo.', { cause });
    this.name = 'NetworkError';
  }
}

type Listener = (err: ApiError) => void;
const authListeners = new Set<Listener>();

/** Called when any request answers unauthorized/session_expired (the store drops the session). */
export function onUnauthorized(fn: Listener): () => void {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

function codeForStatus(status: number): ErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 413) return 'payload_too_large';
  if (status === 415) return 'unsupported_media_type';
  if (status === 429) return 'rate_limited';
  return status >= 500 ? 'internal' : 'bad_request';
}

function queryString(query: unknown): string {
  if (!query || typeof query !== 'object') return '';
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export function urlFor<E extends EndpointDef>(ep: E, opts: Pick<CallOptions<E>, 'params' | 'query'> = {}): string {
  const params = (opts.params ?? {}) as Record<string, string | number>;
  return buildPath(ep.path, params) + queryString(opts.query);
}

async function toApiError(res: Response): Promise<ApiError> {
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON error page (proxy, platform): fall back to the status.
  }
  if (isErrorEnvelope(data)) return new ApiError(data.error.code, data.error.message, data.error.details);
  return new ApiError(codeForStatus(res.status));
}

export async function call<E extends EndpointDef>(ep: E, opts: CallOptions<E> = {}): Promise<ResOf<E>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (opts.idempotencyKey) headers[IDEMPOTENCY_HEADER] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(urlFor(ep, opts), {
      method: ep.method,
      headers,
      body,
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch (err) {
    throw new NetworkError(err);
  }

  if (!res.ok) {
    const err = await toApiError(res);
    if (err.code === 'unauthorized' || err.code === 'session_expired') for (const fn of authListeners) fn(err);
    throw err;
  }
  if (ep.res === 'binary') return (await res.arrayBuffer()) as ResOf<E>;
  if (res.status === 204) return undefined as ResOf<E>;
  return (await res.json()) as ResOf<E>;
}

/** User-facing pt-BR message for any thrown value (ApiError keeps the server's copy). */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message;
  return 'Algo deu errado. Tente de novo.';
}
