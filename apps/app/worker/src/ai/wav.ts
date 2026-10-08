// RIFF/WAVE check for /api/pronounce (spec 04 §3.1): PCM16, mono, 16 kHz, ≤15 s, ≤700 KB of base64.
// The client writes a hand-made 44-byte header (spec 03 §B "Recording"), but any valid chunk layout
// (LIST before fmt/data, odd-sized chunks) is accepted.
import { LIMITS } from '@tie/shared';

export const WAV_RATE = 16_000;
export const WAV_BYTES_PER_SEC = WAV_RATE * 2;

export interface WavInfo {
  /** PCM payload bytes actually present after the `data` header (what Whisper receives). */
  dataBytes: number;
  seconds: number;
}

export type WavCheck = { ok: true; wav: WavInfo } | { ok: false; reason: string };

const ascii = (b: Uint8Array, at: number): string =>
  String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0);

export function inspectWav(bytes: Uint8Array, maxSeconds: number = LIMITS.pronounceMaxSecs): WavCheck {
  if (bytes.length < 44) return { ok: false, reason: 'too_short' };
  if (ascii(bytes, 0) !== 'RIFF' || ascii(bytes, 8) !== 'WAVE') return { ok: false, reason: 'not_wav' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmtOk = false;
  let sawFmt = false;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = ascii(bytes, at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.length) return { ok: false, reason: 'bad_fmt' };
      sawFmt = true;
      const format = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const rate = view.getUint32(body + 4, true);
      const byteRate = view.getUint32(body + 8, true);
      const blockAlign = view.getUint16(body + 12, true);
      const bits = view.getUint16(body + 14, true);
      if (format !== 1) return { ok: false, reason: 'not_pcm' };
      if (channels !== 1) return { ok: false, reason: 'not_mono' };
      if (rate !== WAV_RATE) return { ok: false, reason: 'not_16k' };
      if (bits !== 16 || blockAlign !== 2 || byteRate !== WAV_BYTES_PER_SEC) return { ok: false, reason: 'not_pcm16' };
      fmtOk = true;
    } else if (id === 'data') {
      if (!sawFmt || !fmtOk) return { ok: false, reason: 'data_before_fmt' };
      // The whole upload goes to Whisper, so length and bill come from the bytes that are actually
      // there, never from the declared size alone. Streaming writers leave 0 or 0xFFFFFFFF (or a
      // too-big size) in the header: that is fine, the present bytes are measured. A declared size
      // SMALLER than what follows (trailing chunks or audio hidden after `data`) is rejected, since
      // it would let a client pass the 15 s limit and be billed a fraction of what is transcribed.
      const present = bytes.length - body;
      if (size !== 0 && present - size > size % 2) {
        return { ok: false, reason: 'trailing_data' };
      }
      const dataBytes = present - (present % 2);
      if (dataBytes <= 0) return { ok: false, reason: 'empty' };
      const seconds = dataBytes / WAV_BYTES_PER_SEC;
      if (seconds > maxSeconds + 0.05) return { ok: false, reason: 'too_long' };
      return { ok: true, wav: { dataBytes, seconds } };
    }
    at = body + size + (size % 2);
  }
  return { ok: false, reason: sawFmt ? 'no_data' : 'no_fmt' };
}

/** Billed seconds for a clip: whole seconds, at least 1. */
export const billedAudioSeconds = (w: WavInfo): number => Math.max(1, Math.ceil(w.seconds));

/** Builds a valid PCM16 mono 16 kHz WAV (tests and fixtures). */
export function makeWav(samples: number, opts: { rate?: number; channels?: number; bits?: number } = {}): Uint8Array {
  const rate = opts.rate ?? WAV_RATE;
  const channels = opts.channels ?? 1;
  const bits = opts.bits ?? 16;
  const blockAlign = (channels * bits) / 8;
  const data = samples * blockAlign;
  const out = new Uint8Array(44 + data);
  const v = new DataView(out.buffer);
  const put = (at: number, s: string) => {
    for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i);
  };
  put(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bits, true);
  put(36, 'data');
  v.setUint32(40, data, true);
  return out;
}
