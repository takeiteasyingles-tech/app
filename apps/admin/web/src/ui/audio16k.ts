// The song as the transcription wants it: any recording the browser can decode (WAV, MP3, M4A…) mixed to
// mono and resampled to 16 kHz 16-bit PCM WAV (32 KB per second, ~6 MB for a 3-minute song instead of
// ~30 MB of CD-quality WAV). Runs in the browser with Web Audio; the Worker has no decoder.

export const ASR_RATE = 16000;

/** A mono 16-bit PCM WAV of these samples (-1..1, clipped). */
export function encodeWav16(samples: Float32Array, rate: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(44 + samples.length * 2);
  const dv = new DataView(out.buffer);
  const put = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i);
  };
  put(0, 'RIFF');
  dv.setUint32(4, 36 + samples.length * 2, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  put(36, 'data');
  dv.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] as number));
    dv.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return out;
}

/** Decodes `bytes` and returns 16 kHz mono WAV plus the song length in seconds. */
export async function toAsrWav(bytes: ArrayBuffer): Promise<{ wav: Blob; duration: number }> {
  const Ctx =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx || typeof OfflineAudioContext === 'undefined') {
    throw new Error('Este navegador não consegue preparar o áudio. Use o Chrome, o Edge ou o Firefox atualizados.');
  }
  const ctx = new Ctx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(bytes);
  } catch {
    throw new Error('Não deu para ler este áudio. Envie um WAV ou MP3.');
  } finally {
    void ctx.close();
  }
  const frames = Math.max(1, Math.ceil(decoded.duration * ASR_RATE));
  const off = new OfflineAudioContext(1, frames, ASR_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  // A mono destination downmixes the channels ("speakers" interpretation): vocals sit in the centre.
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  const wav = encodeWav16(out.getChannelData(0), ASR_RATE);
  return { wav: new Blob([wav], { type: 'audio/wav' }), duration: decoded.duration };
}
