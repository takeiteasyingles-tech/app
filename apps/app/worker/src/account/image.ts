// Pixel dimensions from image headers (JPEG SOFn, PNG IHDR, WebP VP8/VP8L/VP8X), without decoding.
// Used to refuse profile photos larger than PHOTO_MAX_DIM; the client already resizes to 256×256.

export const PHOTO_MAX_DIM = 512;

export interface ImageSize {
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u32be = (b: Uint8Array, i: number) => u16be(b, i) * 65536 + u16be(b, i + 2);
const u24le = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16);
const ascii = (b: Uint8Array, at: number, s: string) => {
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
  return true;
};

function jpegSize(b: Uint8Array): ImageSize | null {
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    let marker = b[i + 1] ?? 0;
    // Fill bytes: any number of 0xFF before the marker code.
    while (marker === 0xff && i + 2 < b.length) {
      i++;
      marker = b[i + 1] ?? 0;
    }
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS before any frame header
    const len = u16be(b, i + 2);
    if (len < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 8 >= b.length) return null;
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

function pngSize(b: Uint8Array): ImageSize | null {
  if (b.length < 24 || !ascii(b, 12, 'IHDR')) return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function webpSize(b: Uint8Array): ImageSize | null {
  if (b.length < 30) return null;
  if (ascii(b, 12, 'VP8 ')) {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: (b[26] ?? 0) | (((b[27] ?? 0) & 0x3f) << 8), height: (b[28] ?? 0) | (((b[29] ?? 0) & 0x3f) << 8) };
  }
  if (ascii(b, 12, 'VP8L')) {
    if (b[20] !== 0x2f) return null;
    const [b1, b2, b3, b4] = [b[21] ?? 0, b[22] ?? 0, b[23] ?? 0, b[24] ?? 0];
    return { width: 1 + (((b2 & 0x3f) << 8) | b1), height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)) };
  }
  if (ascii(b, 12, 'VP8X')) return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  return null;
}

/** Dimensions for a sniffed photo MIME, or null when the header cannot be read. */
export function imageSize(bytes: Uint8Array, mime: string): ImageSize | null {
  const size =
    mime === 'image/jpeg'
      ? jpegSize(bytes)
      : mime === 'image/png'
        ? pngSize(bytes)
        : mime === 'image/webp'
          ? webpSize(bytes)
          : null;
  if (!size || size.width < 1 || size.height < 1) return null;
  return size;
}

export const PHOTO_EXT: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
