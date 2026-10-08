import { ApiError } from '@tie/shared';
import { sha256Hex } from '../bytes';

// Upload checks: byte limit (before and while reading), magic-byte sniffing against an allowlist
// (the declared Content-Type is never trusted), and a sha256 for dedupe and media.sha256.

export type SniffedMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'audio/mpeg'
  | 'audio/mp4'
  | 'audio/wav'
  | 'video/mp4'
  | 'video/webm'
  | 'application/pdf';

const ascii = (b: Uint8Array, at: number, text: string): boolean => {
  if (b.length < at + text.length) return false;
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false;
  return true;
};

/** ftyp major brands accepted as MP4 (ISO base media); heic/heix/mif1/avif/avis/'qt  ' are not. */
const MP4_AUDIO_BRANDS: ReadonlySet<string> = new Set(['M4A ', 'M4B ', 'M4P ', 'F4A ']);
const MP4_VIDEO_BRANDS: ReadonlySet<string> = new Set([
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'mp71',
  'avc1',
  'dash',
  'M4V ',
  'M4VH',
  'M4VP',
  'MSNV',
  'NDAS',
  'f4v ',
]);

/** Detects the real type from the first bytes; null when not one of the supported formats. */
export function sniffMime(b: Uint8Array): SniffedMime | null {
  if (b.length < 4) return null;
  const [b0, b1, b2, b3] = [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0];
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return 'image/jpeg';
  if (b0 === 0x89 && ascii(b, 1, 'PNG\r\n\x1a\n')) return 'image/png';
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return 'image/webp';
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE')) return 'audio/wav';
  if (ascii(b, 0, '%PDF-')) return 'application/pdf';
  if (b0 === 0x1a && b1 === 0x45 && b2 === 0xdf && b3 === 0xa3) return 'video/webm';
  if (ascii(b, 4, 'ftyp')) {
    if (b.length < 12) return null;
    const brand = String.fromCharCode(...b.subarray(8, 12));
    if (MP4_AUDIO_BRANDS.has(brand)) return 'audio/mp4';
    // ISO-BMFF also carries HEIC/AVIF stills and QuickTime (mov): only real MP4 brands pass.
    return MP4_VIDEO_BRANDS.has(brand) ? 'video/mp4' : null;
  }
  if (ascii(b, 0, 'ID3')) return 'audio/mpeg';
  // MPEG audio frame sync: 11 set bits, version != reserved (01), layer != reserved (00).
  if (b0 === 0xff && (b1 & 0xe0) === 0xe0 && (b1 & 0x18) !== 0x08 && (b1 & 0x06) !== 0) return 'audio/mpeg';
  return null;
}

/** Containers that hold either audio or video share one signature; treat both labels as the same family. */
const FAMILY: Record<string, string> = {
  'audio/webm': 'video/webm',
  'audio/mp4': 'video/mp4',
  'audio/x-m4a': 'video/mp4',
  'audio/mp3': 'audio/mpeg',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'image/jpg': 'image/jpeg',
};
const family = (mime: string): string => {
  const m = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  return FAMILY[m] ?? m;
};

/** Picks the allowlisted MIME matching the sniffed bytes, or null. Prefers the declared label inside a family. */
export function allowedMime(sniffed: SniffedMime, allow: readonly string[], declared?: string | null): string | null {
  const fam = family(sniffed);
  const candidates = allow.filter((a) => family(a) === fam);
  if (candidates.length === 0) return null;
  const d = declared?.split(';')[0]?.trim().toLowerCase();
  return candidates.find((c) => c === d) ?? candidates.find((c) => c === sniffed) ?? candidates[0] ?? null;
}

export interface UploadLimits {
  maxBytes: number;
  /** MIME allowlist, e.g. PHOTO_MIME or MEDIA_MIME from @tie/shared. */
  allow: readonly string[];
}

export interface PreparedUpload {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
  size: number;
  sha256: string;
}

/** Reads a stream up to maxBytes; throws payload_too_large as soon as it goes over. */
export async function readLimited(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ApiError('payload_too_large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Rejects early on a declared Content-Length over the limit (the read is still capped). */
export function assertContentLength(header: string | null | undefined, maxBytes: number): void {
  if (!header) return;
  const n = Number(header);
  if (Number.isFinite(n) && n > maxBytes) throw new ApiError('payload_too_large');
}

type UploadInput = Blob | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>;

async function toBytes(input: UploadInput, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (input instanceof Uint8Array) {
    if (input.byteLength > maxBytes) throw new ApiError('payload_too_large');
    return new Uint8Array(input);
  }
  if (input instanceof ArrayBuffer) {
    if (input.byteLength > maxBytes) throw new ApiError('payload_too_large');
    return new Uint8Array(input);
  }
  if (input instanceof Blob) {
    if (input.size > maxBytes) throw new ApiError('payload_too_large');
    return new Uint8Array(await input.arrayBuffer());
  }
  return readLimited(input, maxBytes);
}

/**
 * Validates an upload (multipart File, raw body stream or bytes): non-empty, within maxBytes,
 * magic bytes match an allowlisted type. Returns the bytes with the verified MIME and sha256.
 */
export async function prepareUpload(
  input: UploadInput,
  limits: UploadLimits,
  declaredMime?: string | null,
): Promise<PreparedUpload> {
  const bytes = await toBytes(input, limits.maxBytes);
  if (bytes.byteLength === 0) throw new ApiError('bad_request', 'Arquivo vazio.');
  const sniffed = sniffMime(bytes);
  const mime = sniffed ? allowedMime(sniffed, limits.allow, declaredMime) : null;
  if (!mime) throw new ApiError('unsupported_media_type');
  return { bytes, mime, size: bytes.byteLength, sha256: await sha256Hex(bytes) };
}

/** Stores a prepared upload; R2 verifies the sha256 on its side too. */
export async function putUpload(
  bucket: R2Bucket,
  key: string,
  file: PreparedUpload,
  opts: { cacheControl?: string; customMetadata?: Record<string, string> } = {},
): Promise<R2Object> {
  return bucket.put(key, file.bytes, {
    httpMetadata: { contentType: file.mime, ...(opts.cacheControl ? { cacheControl: opts.cacheControl } : {}) },
    sha256: file.sha256,
    ...(opts.customMetadata ? { customMetadata: opts.customMetadata } : {}),
  });
}
