import { describe, expect, it } from 'vitest';
import { etagMatches, parseRange, serveObject } from '../src/r2/serveObject';

describe('parseRange', () => {
  const size = 1000;

  it('ignores absent, malformed, multi-range and non-byte units', () => {
    for (const h of [
      null,
      undefined,
      '',
      'bytes=',
      'bytes=-',
      'items=0-1',
      'bytes=0-1,5-6',
      'bytes=a-b',
      'bytes=5-2',
    ]) {
      expect(parseRange(h, size)).toBeNull();
    }
  });

  it('parses closed, open-ended and suffix ranges', () => {
    expect(parseRange('bytes=0-99', size)).toEqual({ offset: 0, length: 100 });
    expect(parseRange('bytes=500-', size)).toEqual({ offset: 500, length: 500 });
    expect(parseRange('bytes=-200', size)).toEqual({ offset: 800, length: 200 });
    expect(parseRange('Bytes = 10 - 10', size)).toEqual({ offset: 10, length: 1 });
  });

  it('clamps the end and the suffix to the object size', () => {
    expect(parseRange('bytes=900-5000', size)).toEqual({ offset: 900, length: 100 });
    expect(parseRange('bytes=-5000', size)).toEqual({ offset: 0, length: 1000 });
  });

  it('flags unsatisfiable ranges', () => {
    expect(parseRange('bytes=1000-', size)).toBe('unsatisfiable');
    expect(parseRange('bytes=1000-1001', size)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', size)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable');
  });
});

describe('etagMatches', () => {
  it('handles lists, weak tags and *', () => {
    expect(etagMatches('"abc"', '"abc"')).toBe(true);
    expect(etagMatches('W/"abc"', '"abc"')).toBe(true);
    expect(etagMatches('"x", "abc"', '"abc"')).toBe(true);
    expect(etagMatches('*', '"abc"')).toBe(true);
    expect(etagMatches('"abd"', '"abc"')).toBe(false);
    expect(etagMatches(null, '"abc"')).toBe(false);
  });
});

// Just enough of R2Bucket for serveObject.
function fakeBucket(data: Uint8Array, contentType = 'audio/mpeg') {
  const calls: string[] = [];
  const meta = {
    key: 'k',
    size: data.length,
    etag: 'abc',
    httpEtag: '"abc"',
    uploaded: new Date(0),
    writeHttpMetadata(h: Headers) {
      h.set('Content-Type', contentType);
    },
  };
  const bucket = {
    calls,
    async head(key: string) {
      calls.push(`head:${key}`);
      return key === 'k' ? meta : null;
    },
    async get(key: string, opts?: { range?: { offset: number; length: number } }) {
      calls.push(`get:${key}${opts?.range ? `:${opts.range.offset}+${opts.range.length}` : ''}`);
      if (key !== 'k') return null;
      const slice = opts?.range ? data.subarray(opts.range.offset, opts.range.offset + opts.range.length) : data;
      return { ...meta, body: new Response(slice).body };
    },
  };
  return bucket as typeof bucket & R2Bucket;
}

const data = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));
const opts = { cacheControl: 'private, max-age=3600' };
const req = (headers: Record<string, string> = {}, method = 'GET') => new Request('https://x/m/k', { method, headers });

describe('serveObject', () => {
  it('serves the full object with one R2 read', async () => {
    const b = fakeBucket(data);
    const res = await serveObject(b, 'k', req(), opts);
    expect(res.status).toBe(200);
    expect(b.calls).toEqual(['get:k']);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(res.headers.get('Content-Length')).toBe('100');
    expect(res.headers.get('ETag')).toBe('"abc"');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Cache-Control')).toBe(opts.cacheControl);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(data);
  });

  it('serves a 206 slice', async () => {
    const res = await serveObject(fakeBucket(data), 'k', req({ Range: 'bytes=10-19' }), opts);
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 10-19/100');
    expect(res.headers.get('Content-Length')).toBe('10');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it('answers 416 for unsatisfiable ranges', async () => {
    const res = await serveObject(fakeBucket(data), 'k', req({ Range: 'bytes=500-' }), opts);
    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe('bytes */100');
  });

  it('answers 304 on a matching If-None-Match', async () => {
    const b = fakeBucket(data);
    const res = await serveObject(b, 'k', req({ 'If-None-Match': '"abc"' }), opts);
    expect(res.status).toBe(304);
    expect(b.calls).toEqual(['head:k']);
  });

  it('ignores Range when If-Range is stale', async () => {
    const res = await serveObject(fakeBucket(data), 'k', req({ Range: 'bytes=0-9', 'If-Range': '"old"' }), opts);
    expect(res.status).toBe(200);
  });

  it('HEAD returns headers only', async () => {
    const res = await serveObject(fakeBucket(data), 'k', req({ Range: 'bytes=0-9' }, 'HEAD'), opts);
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Length')).toBe('10');
    expect(await res.text()).toBe('');
  });

  it('404s for a missing key and 405s other methods', async () => {
    expect((await serveObject(fakeBucket(data), 'zz', req(), opts)).status).toBe(404);
    expect((await serveObject(fakeBucket(data), 'k', req({}, 'POST'), opts)).status).toBe(405);
  });
});
