// Even voice loudness (spec 05): a quiet voice and a loud one end up at the same speech level; silence
// between words does not count, and the gain stays within ×0.25..×4.
import { describe, expect, it } from 'vitest';
import { loudnessGain, SPEECH_RMS_TARGET } from '../src/core/speech';

const RATE = 24_000;
/** amp × sine for `voicedS` seconds, then `silentS` seconds of silence. */
function line(amp: number, voicedS: number, silentS = 0) {
  const data = new Float32Array(Math.round((voicedS + silentS) * RATE));
  for (let i = 0; i < voicedS * RATE; i++) data[i] = amp * Math.sin((2 * Math.PI * 220 * i) / RATE);
  return { sampleRate: RATE, getChannelData: () => data };
}
const rmsOfSine = (amp: number) => amp / Math.SQRT2;

describe('loudnessGain', () => {
  it('brings quiet and loud voices to the same level', () => {
    for (const amp of [0.05, 0.15, 0.5]) {
      expect(rmsOfSine(amp) * loudnessGain(line(amp, 1))).toBeCloseTo(SPEECH_RMS_TARGET, 2);
    }
  });

  it('ignores the pauses', () => {
    expect(loudnessGain(line(0.15, 1, 2))).toBeCloseTo(loudnessGain(line(0.15, 1)), 2);
  });

  it('stays within ×0.25..×4, and leaves silence alone', () => {
    expect(loudnessGain(line(0.02, 1))).toBe(4);
    expect(loudnessGain(line(1, 1))).toBeGreaterThanOrEqual(0.25);
    expect(loudnessGain(line(0, 0, 1))).toBe(1);
  });
});
