// WAV encoding for speech.record (prototipo/js/core/speech.js toWav16k + b64), split out so it can
// be unit tested without an AudioContext. The bytes are exactly the prototype's hand-made header:
// RIFF/WAVE, PCM (format 1), mono, 16-bit, then little-endian samples clamped to [-1, 1] × 0x7fff.

/** Sample rate the server expects (/api/pronounce: 16 kHz mono PCM16). */
export const WAV_RATE = 16000;

/** 44-byte header + PCM16 samples. */
export function encodeWav16(pcm: Float32Array, rate: number = WAV_RATE): ArrayBuffer {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (o: number, str: string) => {
    for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, pcm.length * 2, true);
  // setInt16 truncates toward zero, as in the prototype.
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i] ?? 0)) * 0x7fff, true);
  return buf;
}

/** Base64 without the data: prefix (what FileReader.readAsDataURL gave the prototype after the comma). */
export function toBase64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Seconds of audio in a PCM16 mono WAV of `bytes` length at `rate`. */
export const wavSeconds = (bytes: number, rate: number = WAV_RATE): number => Math.max(0, bytes - 44) / 2 / rate;
