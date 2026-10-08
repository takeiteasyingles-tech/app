// Typed fetch over the @tie/shared admin endpoint tables: `await call(adminApi.users.get, {params:{id}})`.
// JSON in/out, same-origin cookies (the __Host-tie_adm session), and every failure surfaces as an
// ApiError carrying the server's {error:{code,message,details}} envelope. Media uploads go through
// XMLHttpRequest so the library can show upload progress (fetch has no upload progress events).
import type { MediaRow } from '@tie/shared/contracts/admin';
import { adminApi } from '@tie/shared/contracts/admin';
import {
  type BodyIn,
  buildPath,
  type EndpointDef,
  type ParamsIn,
  type QueryIn,
  type ResOf,
} from '@tie/shared/contracts/http';
import { ApiError, type ErrorCode, isErrorEnvelope } from '@tie/shared/errors';

export { ApiError };

export interface CallOptions<E extends EndpointDef> {
  params?: ParamsIn<E>;
  query?: QueryIn<E>;
  body?: BodyIn<E>;
  signal?: AbortSignal;
  /** Extra request headers (e.g. the start-up probe of auth/me). */
  headers?: Record<string, string>;
}

/** No response reached the client (offline, DNS, aborted). */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('Sem conexão com o servidor. Confira a internet e tente de novo.', { cause });
    this.name = 'NetworkError';
  }
}

type Listener = (err: ApiError) => void;
const authListeners = new Set<Listener>();

/** Called when a request answers unauthorized/session_expired (the session store signs out). */
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
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export function urlFor<E extends EndpointDef>(ep: E, opts: Pick<CallOptions<E>, 'params' | 'query'> = {}): string {
  return buildPath(ep.path, (opts.params ?? {}) as Record<string, string | number>) + queryString(opts.query);
}

function errorFrom(status: number, data: unknown): ApiError {
  if (isErrorEnvelope(data)) return new ApiError(data.error.code, data.error.message, data.error.details);
  return new ApiError(codeForStatus(status));
}

function notifyAuth(err: ApiError): void {
  if (err.code === 'unauthorized' || err.code === 'session_expired') for (const fn of authListeners) fn(err);
}

export async function call<E extends EndpointDef>(ep: E, opts: CallOptions<E> = {}): Promise<ResOf<E>> {
  const headers: Record<string, string> = { ...opts.headers, Accept: 'application/json' };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
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
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new NetworkError(err);
  }
  if (!res.ok) {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // Non-JSON error page (platform, proxy): the status decides.
    }
    const err = errorFrom(res.status, data);
    notifyAuth(err);
    throw err;
  }
  if (res.status === 204) return undefined as ResOf<E>;
  return (await res.json()) as ResOf<E>;
}

export interface UploadHandle {
  promise: Promise<MediaRow>;
  abort(): void;
}

/** POST /admin-api/media (multipart field "file") with progress in 0..1. */
export function uploadMedia(file: File, onProgress: (fraction: number) => void): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<MediaRow>((resolve, reject) => {
    xhr.open('POST', adminApi.media.upload.path);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0) onProgress(Math.min(1, ev.loaded / ev.total));
    };
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // fall through
      }
      if (xhr.status >= 200 && xhr.status < 300 && data && typeof data === 'object' && 'media' in data) {
        onProgress(1);
        resolve((data as { media: MediaRow }).media);
        return;
      }
      const err = errorFrom(xhr.status, data);
      notifyAuth(err);
      reject(err);
    };
    xhr.onerror = () => reject(new NetworkError());
    xhr.onabort = () => reject(new DOMException('Envio cancelado.', 'AbortError'));
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

/** User-facing pt-BR message for any thrown value (ApiError keeps the server's copy). */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message;
  if (err instanceof DOMException && err.name === 'AbortError') return 'Cancelado.';
  return 'Algo deu errado. Tente de novo.';
}

export interface Issue {
  path: string;
  message: string;
}

/** The field issues of a validation_failed answer ({issues:[{path,message}]}), else []. */
export function issuesOf(err: unknown): Issue[] {
  if (!(err instanceof ApiError)) return [];
  const details = err.details as { issues?: unknown } | undefined;
  if (!details || !Array.isArray(details.issues)) return [];
  return details.issues.flatMap((i: unknown) => {
    if (!i || typeof i !== 'object') return [];
    const o = i as { path?: unknown; message?: unknown };
    return [
      {
        path: typeof o.path === 'string' ? o.path : '',
        message: typeof o.message === 'string' ? o.message : err.message,
      },
    ];
  });
}

export const isCode = (err: unknown, code: ErrorCode): boolean => err instanceof ApiError && err.code === code;
