import { ApiError, MEDIA_MIME, PHOTO_MIME } from '@tie/shared';
import { describe, expect, it } from 'vitest';
import { allowedMime, assertContentLength, prepareUpload, readLimited, sniffMime } from '../src/r2/upload';

const bytes = (...parts: (number[] | string)[]): Uint8Array => {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const ch of p) out.push(ch.charCodeAt(0));
    else out.push(...p);
  }
  while (out.length < 16) out.push(0);
  return new Uint8Array(out);
};

const SAMPLES: Record<string, Uint8Array> = {
  'image/jpeg': bytes([0xff, 0xd8, 0xff, 0xe0]),
  'image/png': bytes([0x89], 'PNG\r\n\x1a\n'),
  'image/webp': bytes('RIFF', [0x10, 0, 0, 0], 'WEBPVP8 '),
  'audio/wav': bytes('RIFF', [0x10, 0, 0, 0], 'WAVEfmt '),
  'application/pdf': bytes('%PDF-1.7\n'),
  'video/webm': bytes([0x1a, 0x45, 0xdf, 0xa3]),
  'video/mp4': bytes([0, 0, 0, 0x20], 'ftypisom'),
  'audio/mp4': bytes([0, 0, 0, 0x20], 'ftypM4A '),
  'audio/mpeg': bytes('ID3', [4, 0, 0]),
};

async function rejectsWith(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).code).toBe(code);
}

describe('sniffMime', () => {
  it('recognizes every supported signature', () => {
    for (const [mime, sample] of Object.entries(SAMPLES)) expect(sniffMime(sample)).toBe(mime);
  });

  it('recognizes a bare MPEG audio frame (no ID3)', () => {
    expect(sniffMime(bytes([0xff, 0xfb, 0x90, 0x64]))).toBe('audio/mpeg');
    // ADTS AAC (layer 00) is not MP3.
    expect(sniffMime(bytes([0xff, 0xf1, 0x50, 0x80]))).toBeNull();
  });

  it('rejects unknown or disguised content', () => {
    expect(sniffMime(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffMime(bytes('<html><script>'))).toBeNull();
    expect(sniffMime(bytes('GIF89a'))).toBeNull();
    expect(sniffMime(bytes('RIFF', [0, 0, 0, 0], 'AVI '))).toBeNull();
    expect(sniffMime(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe('allowedMime', () => {
  it('maps container families and prefers the declared label', () => {
    const allow = ['audio/webm', 'audio/wav'];
    expect(allowedMime('video/webm', allow, 'audio/webm;codecs=opus')).toBe('audio/webm');
    expect(allowedMime('video/webm', PHOTO_MIME)).toBeNull();
    expect(allowedMime('video/mp4', MEDIA_MIME, 'audio/mp4')).toBe('audio/mp4');
    expect(allowedMime('video/mp4', MEDIA_MIME, 'image/png')).toBe('video/mp4');
  });
});

describe('prepareUpload', () => {
  const photo = { maxBytes: 2 * 1024 * 1024, allow: PHOTO_MIME };

  it('trusts magic bytes over the declared type and hashes the content', async () => {
    const res = await prepareUpload(SAMPLES['image/png'] as Uint8Array, photo, 'image/jpeg');
    expect(res.mime).toBe('image/png');
    expect(res.size).toBe(16);
    expect(res.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts Blobs and streams', async () => {
    const blob = new Blob([SAMPLES['image/webp'] as Uint8Array]);
    expect((await prepareUpload(blob, photo)).mime).toBe('image/webp');
    const stream = new Response(SAMPLES['image/jpeg'] as Uint8Array).body as ReadableStream<Uint8Array>;
    expect((await prepareUpload(stream, photo)).mime).toBe('image/jpeg');
  });

  it('rejects types outside the allowlist', async () => {
    await rejectsWith(prepareUpload(SAMPLES['application/pdf'] as Uint8Array, photo), 'unsupported_media_type');
    await rejectsWith(prepareUpload(bytes('<svg>'), photo, 'image/png'), 'unsupported_media_type');
  });

  it('enforces the size limit', async () => {
    const big = new Uint8Array(32);
    big.set(SAMPLES['image/jpeg'] as Uint8Array);
    await rejectsWith(prepareUpload(big, { maxBytes: 31, allow: PHOTO_MIME }), 'payload_too_large');
    await rejectsWith(prepareUpload(new Blob([big]), { maxBytes: 31, allow: PHOTO_MIME }), 'payload_too_large');
    await rejectsWith(prepareUpload(new Uint8Array(0), photo), 'bad_request');
  });

  it('readLimited stops reading past the limit', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        pulled++;
        ctrl.enqueue(new Uint8Array(10));
        if (pulled > 100) ctrl.close();
      },
    });
    await rejectsWith(readLimited(stream, 25), 'payload_too_large');
    expect(pulled).toBeLessThan(10);
  });

  it('assertContentLength rejects declared oversize bodies', () => {
    expect(() => assertContentLength('100', 50)).toThrow(ApiError);
    expect(() => assertContentLength('50', 50)).not.toThrow();
    expect(() => assertContentLength(null, 50)).not.toThrow();
  });
});
