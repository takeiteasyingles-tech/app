// speech.record's WAV: byte-for-byte the prototype's toWav16k header and samples, and its base64.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { encodeWav16, toBase64, WAV_RATE, wavSeconds } from '../src/core/wav';

const ascii = (v: DataView, at: number, n: number) =>
  String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(at + i)));

/** prototipo/js/core/speech.js toWav16k with the OfflineAudioContext replaced by fixed PCM. */
async function prototypeWav(pcm: Float32Array): Promise<ArrayBuffer> {
  const src = readFileSync(fileURLToPath(new URL('../../../../prototipo/js/core/speech.js', import.meta.url)), 'utf8');
  // Expose the closure's toWav16k (the IIFE keeps it private).
  const patched = src.replace('TIE.speech = {', 'TIE.__toWav16k = toWav16k; TIE.speech = {');
  class FakeOffline {
    destination = {};
    createBufferSource() {
      return { connect() {}, start() {}, buffer: null };
    }
    async startRendering() {
      return { getChannelData: () => pcm };
    }
  }
  class FakeBlob {
    constructor(readonly parts: ArrayBuffer[]) {}
  }
  // biome-ignore lint/suspicious/noExplicitAny: prototype sandbox
  const sandbox: any = { navigator: {}, OfflineAudioContext: FakeOffline, Blob: FakeBlob, TIE: {} };
  sandbox.window = sandbox;
  vm.runInContext(patched, vm.createContext(sandbox), { filename: 'speech.js' });
  const blob = (await sandbox.TIE.__toWav16k({ duration: pcm.length / WAV_RATE })) as FakeBlob;
  return blob.parts[0] as ArrayBuffer;
}

describe('encodeWav16', () => {
  it('writes a 44-byte RIFF/WAVE PCM16 mono 16 kHz header', () => {
    const v = new DataView(encodeWav16(new Float32Array(3)));
    expect(v.byteLength).toBe(44 + 6);
    expect(ascii(v, 0, 4)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(36 + 6);
    expect(ascii(v, 8, 4)).toBe('WAVE');
    expect(ascii(v, 12, 4)).toBe('fmt ');
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000); // byte rate
    expect(v.getUint16(32, true)).toBe(2); // block align
    expect(v.getUint16(34, true)).toBe(16); // bits
    expect(ascii(v, 36, 4)).toBe('data');
    expect(v.getUint32(40, true)).toBe(6);
  });

  it('clamps to [-1, 1] and scales by 0x7fff, truncating toward zero', () => {
    const v = new DataView(encodeWav16(new Float32Array([0, 1, -1, 2, -3, 0.5, -0.5])));
    const s = (i: number) => v.getInt16(44 + i * 2, true);
    expect([s(0), s(1), s(2), s(3), s(4), s(5), s(6)]).toEqual([0, 32767, -32767, 32767, -32767, 16383, -16383]);
  });

  it('matches the prototype byte for byte', async () => {
    const pcm = new Float32Array(Array.from({ length: 257 }, (_, i) => Math.sin(i / 7) * 1.2 - 0.1));
    const mine = new Uint8Array(encodeWav16(pcm));
    const proto = new Uint8Array(await prototypeWav(pcm));
    expect(mine).toEqual(proto);
  });

  it('honours a custom rate and computes the duration', () => {
    const v = new DataView(encodeWav16(new Float32Array(8000), 8000));
    expect(v.getUint32(24, true)).toBe(8000);
    expect(wavSeconds(44 + 32000)).toBe(1);
  });
});

describe('toBase64', () => {
  it('equals Node base64 (no data: prefix), also across the chunk boundary', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17).map((_, i) => (i * 31) & 0xff);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    const wav = encodeWav16(new Float32Array([0.25, -0.25]));
    expect(toBase64(wav)).toBe(Buffer.from(wav).toString('base64'));
  });
});
