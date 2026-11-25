// Voice activity detection (speech.record's onSilence): speech then quiet stops the take; room noise
// alone or short pauses inside a phrase do not.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectSilence, MIN_VOICED_MS, voicedMsOf } from '../src/core/speech';

/** A fake analyser whose frames are a sine of the current amplitude (0..1). */
function analyser() {
  let amp = 0;
  let phase = 0;
  return {
    set: (a: number) => {
      amp = a;
    },
    an: {
      fftSize: 256,
      getByteTimeDomainData(buf: Uint8Array) {
        for (let i = 0; i < buf.length; i++) buf[i] = Math.round(128 + 127 * amp * Math.sin(phase++ / 4));
      },
    },
  };
}

describe('detectSilence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires once after speech and then the silence window', () => {
    const f = analyser();
    const done = vi.fn();
    detectSilence(f.an, 1100, done);
    f.set(0.005); // quiet room while calibrating
    vi.advanceTimersByTime(400);
    f.set(0.4); // speaking
    vi.advanceTimersByTime(1200);
    f.set(0.005); // done speaking
    vi.advanceTimersByTime(1000);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(done).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('never fires without speech (room noise only)', () => {
    const f = analyser();
    const done = vi.fn();
    detectSilence(f.an, 1100, done);
    f.set(0.01);
    vi.advanceTimersByTime(8000);
    expect(done).not.toHaveBeenCalled();
  });

  it('a short pause inside the phrase does not stop it', () => {
    const f = analyser();
    const done = vi.fn();
    detectSilence(f.an, 1100, done);
    f.set(0.005);
    vi.advanceTimersByTime(400);
    f.set(0.4);
    vi.advanceTimersByTime(600);
    f.set(0.005); // a breath between words
    vi.advanceTimersByTime(500);
    f.set(0.4);
    vi.advanceTimersByTime(600);
    expect(done).not.toHaveBeenCalled();
    f.set(0.005);
    vi.advanceTimersByTime(1200);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('stop() cancels it', () => {
    const f = analyser();
    const done = vi.fn();
    const stop = detectSilence(f.an, 1100, done);
    f.set(0.005);
    vi.advanceTimersByTime(400);
    f.set(0.4);
    vi.advanceTimersByTime(600);
    stop();
    f.set(0.005);
    vi.advanceTimersByTime(3000);
    expect(done).not.toHaveBeenCalled();
  });
});

// PROD (spec 05 "Take the Mic: real scores"): a take with no voice gets no score.
describe('voicedMsOf', () => {
  const RATE = 16000;
  /** `parts` of [seconds, amplitude]: a 220 Hz sine at that amplitude. */
  const take = (...parts: [number, number][]) => {
    const out: number[] = [];
    for (const [secs, amp] of parts)
      for (let i = 0; i < secs * RATE; i++) out.push(amp * Math.sin((2 * Math.PI * 220 * out.length) / RATE));
    return Float32Array.from(out);
  };

  it('counts the voiced part of a take, not the room', () => {
    expect(voicedMsOf(take([2, 0]), RATE)).toBe(0);
    expect(voicedMsOf(take([2, 0.004]), RATE)).toBe(0);
    const v = voicedMsOf(take([0.5, 0.004], [1, 0.3], [0.5, 0.004]), RATE);
    expect(v).toBeGreaterThanOrEqual(950);
    expect(v).toBeLessThanOrEqual(1050);
    expect(voicedMsOf(take([0.1, 0.3], [2, 0.002]), RATE)).toBeLessThan(MIN_VOICED_MS);
  });

  it('a take that is voice from end to end still counts', () => {
    expect(voicedMsOf(take([1.5, 0.3]), RATE)).toBeGreaterThanOrEqual(1400);
  });
});
