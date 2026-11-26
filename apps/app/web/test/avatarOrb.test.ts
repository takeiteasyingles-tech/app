// screens/maggie/AvatarOrb.tsx: how loud an HD line is where it is playing (the orb's swell).
import { describe, expect, it } from 'vitest';
import type { SpeechEvent } from '../src/core/speech';
import { lineLevel } from '../src/screens/maggie/AvatarOrb';

type AudioLine = Extract<SpeechEvent, { type: 'audio' }>;

/** A line of `seconds` at 1 kHz: silence, then a loud half. */
function line(seconds: number, startAt: number, rate = 1): { l: AudioLine; samples: Float32Array } {
  const samples = new Float32Array(seconds * 1000);
  samples.fill(0.5, samples.length / 2);
  const l = {
    type: 'audio',
    text: 'Hi',
    startAt,
    rate,
    words: null,
    buffer: { sampleRate: 1000 },
  } as unknown as AudioLine;
  return { l, samples };
}

describe('lineLevel', () => {
  it('is quiet before the line starts and over its silence, loud over its loud half', () => {
    const { l, samples } = line(4, 10);
    expect(lineLevel(l, samples, 9)).toBe(0);
    expect(lineLevel(l, samples, 10.5)).toBe(0);
    expect(lineLevel(l, samples, 3 + 10)).toBe(1);
  });

  it('follows the playback rate and ends with the line', () => {
    const { l, samples } = line(4, 0, 2);
    // At rate 2 the loud half starts after 1 s of playing.
    expect(lineLevel(l, samples, 1.2)).toBe(1);
    expect(lineLevel(l, samples, 2.1)).toBeNull();
  });
});
