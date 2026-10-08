// Serves a private R2 object with HTTP caching semantics: single byte ranges (audio/video seeking),
// strong ETags, If-None-Match → 304 and If-Range. Multi-range requests get the full body (allowed by
// RFC 9110 §14.2, and media players never send them).

export type ByteRange = { offset: number; length: number };
export type RangeResult = ByteRange | 'unsatisfiable' | null;

/**
 * Parses a Range header against the object size.
 * null → ignore (absent, malformed, multi-range, non-bytes unit); 'unsatisfiable' → 416.
 */
export function parseRange(header: string | null | undefined, size: number): RangeResult {
  if (!header) return null;
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m) return null;
  const [, startText = '', endText = ''] = m;
  if (startText === '' && endText === '') return null;

  if (startText === '') {
    // Suffix range: last N bytes.
    const n = Number(endText);
    if (!Number.isSafeInteger(n)) return null;
    if (n === 0 || size === 0) return 'unsatisfiable';
    const length = Math.min(n, size);
    return { offset: size - length, length };
  }

  const start = Number(startText);
  if (!Number.isSafeInteger(start)) return null;
  if (start >= size) return 'unsatisfiable';
  let end = endText === '' ? size - 1 : Number(endText);
  if (!Number.isSafeInteger(end)) return null;
  if (end < start) return null;
  end = Math.min(end, size - 1);
  return { offset: start, length: end - start + 1 };
}

/** True when any entity tag in an If-None-Match / If-Match list matches (weak comparison). */
export function etagMatches(header: string | null | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  const bare = (t: string) => t.trim().replace(/^W\//, '');
  const target = bare(etag);
  return header.split(',').some((t) => bare(t) === target);
}

export interface ServeOptions {
  /** e.g. 'private, max-age=31536000, immutable' for content media. */
  cacheControl: string;
  /** Used when the object has no stored content type. */
  contentType?: string;
  /** Extra headers (Content-Disposition, Vary...). */
  headers?: Record<string, string>;
}

function baseHeaders(obj: R2Object, opts: ServeOptions): Headers {
  const h = new Headers();
  obj.writeHttpMetadata(h);
  if (!h.has('Content-Type')) h.set('Content-Type', opts.contentType ?? 'application/octet-stream');
  // R2 metadata may carry its own Cache-Control; the route decides.
  h.set('Cache-Control', opts.cacheControl);
  h.set('ETag', obj.httpEtag);
  h.set('Last-Modified', obj.uploaded.toUTCString());
  h.set('Accept-Ranges', 'bytes');
  for (const [k, v] of Object.entries(opts.headers ?? {})) h.set(k, v);
  return h;
}

/** GET/HEAD for one R2 key. Returns 404 (empty body) when missing; callers wrap it in the envelope if needed. */
export async function serveObject(bucket: R2Bucket, key: string, req: Request, opts: ServeOptions): Promise<Response> {
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const rangeHeader = req.headers.get('Range');
  const ifNoneMatch = req.headers.get('If-None-Match');

  // Plain GET: one R2 read. Conditional, ranged or HEAD: read metadata first.
  if (method === 'GET' && !rangeHeader && !ifNoneMatch) {
    const body = await bucket.get(key);
    if (!body) return new Response(null, { status: 404 });
    const h = baseHeaders(body, opts);
    h.set('Content-Length', String(body.size));
    return new Response(body.body, { status: 200, headers: h });
  }

  const head = await bucket.head(key);
  if (!head) return new Response(null, { status: 404 });
  const h = baseHeaders(head, opts);

  if (etagMatches(ifNoneMatch, head.httpEtag)) return new Response(null, { status: 304, headers: h });

  let range = parseRange(rangeHeader, head.size);
  const ifRange = req.headers.get('If-Range');
  // If-Range with a stale validator (or a date, which we don't track precisely) → full body.
  if (range && ifRange && ifRange.trim() !== head.httpEtag) range = null;

  if (range === 'unsatisfiable') {
    h.set('Content-Range', `bytes */${head.size}`);
    h.delete('Content-Type');
    return new Response(null, { status: 416, headers: h });
  }

  if (method === 'HEAD') {
    h.set('Content-Length', String(range ? range.length : head.size));
    if (range) h.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`);
    return new Response(null, { status: range ? 206 : 200, headers: h });
  }

  // Media keys are content-addressed (media/{sha8}/...), so the object can't change between reads.
  const body = await bucket.get(key, range ? { range } : undefined);
  if (!body) return new Response(null, { status: 404 });

  if (!range) {
    h.set('Content-Length', String(head.size));
    return new Response(body.body, { status: 200, headers: h });
  }
  h.set('Content-Length', String(range.length));
  h.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`);
  return new Response(body.body, { status: 206, headers: h });
}
