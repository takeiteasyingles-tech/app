import { describe, expect, it } from 'vitest';
import { spring } from '../src/screens/maggie/avatar3d/engine';
import {
  envelope,
  MORPHS,
  ROUND_LEAD,
  SHAPES,
  sample,
  timeline,
  wordVisemes,
} from '../src/screens/maggie/avatar3d/lipsync';

/** A fake decoded buffer: 100 Hz frames of sound or silence, as `[seconds, loud]` segments. */
function buffer(segments: [number, boolean][]) {
  const sampleRate = 8000;
  const parts = segments.flatMap(([s, loud]) =>
    Array.from({ length: Math.round(s * sampleRate) }, (_, i) =>
      loud ? 0.5 * Math.sin((2 * Math.PI * 220 * i) / sampleRate) : 0,
    ),
  );
  const data = Float32Array.from(parts);
  return { sampleRate, getChannelData: () => data };
}

describe('lip sync', () => {
  it('spells English words into mouth shapes', () => {
    expect(wordVisemes('morning')).toEqual(['PP', 'O', 'RR', 'DD', 'I', 'kk']);
    expect(wordVisemes('flight')).toEqual(['FF', 'DD', 'aa', 'I', 'DD']);
    expect(wordVisemes('like')).toEqual(['DD', 'I', 'kk']); // silent final e
    expect(wordVisemes('12')).toEqual([]);
  });

  it('puts each phrase on its own voiced stretch and closes the mouth in the pause', () => {
    const env = envelope(
      buffer([
        [0.2, false],
        [0.8, true],
        [0.5, false],
        [1.2, true],
        [0.3, false],
      ]),
    );
    const keys = timeline('Good morning! Where are you flying today?', env);
    const sil = keys.filter((k) => k.v === 'sil').map((k) => k.t);
    expect(sil.length).toBe(4); // two phrases, a rest key on each side
    const firstPhrase = keys.filter((k) => k.t > (sil[0] as number) && k.t < (sil[1] as number)).map((k) => k.v);
    expect(firstPhrase).toEqual([...wordVisemes('Good'), ...wordVisemes('morning!')]);
    expect(sample(keys, 1.25).jaw).toBe(0); // in the pause
    expect(sample(keys, 0.6).jaw).toBeGreaterThan(0);
  });

  it('keeps the calibrated mouth shapes physically sensible', () => {
    for (const [v, s] of Object.entries(SHAPES)) {
      for (const [k, x] of Object.entries(s)) expect(x, `${v}.${k}`).toBeGreaterThanOrEqual(0);
      for (const [k, x] of Object.entries(s)) expect(x, `${v}.${k}`).toBeLessThanOrEqual(1);
    }
    expect(SHAPES.sil.jaw).toBe(0);
    expect(SHAPES.PP.jaw).toBe(0); // M/B/P shut the mouth
    expect(SHAPES.PP.mouthPress).toBeGreaterThan(0.5);
    expect(SHAPES.FF.lowerLipF).toBeGreaterThan(0.5); // F/V: lower lip on the teeth
    expect(SHAPES.U.mouthRound).toBeGreaterThan(SHAPES.E.mouthRound ?? 0);
    expect(SHAPES.I.mouthWide).toBeGreaterThan(SHAPES.U.mouthWide ?? 0);
    // the open vowel opens the jaw most; no consonant opens wider than it
    for (const v of ['E', 'I', 'O', 'U', 'RR', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'HH'] as const) {
      expect(SHAPES[v].jaw, v).toBeLessThan(SHAPES.aa.jaw);
    }
    // only M/B/P press the lips
    for (const [v, s] of Object.entries(SHAPES)) if (v !== 'PP') expect(s.mouthPress ?? 0, v).toBe(0);
  });

  it('always returns every morph, also before and after the line', () => {
    const keys = timeline('Hi there.', envelope(buffer([[0.5, true]])));
    for (const t of [-1, 0.2, 99]) {
      const s = sample(keys, t);
      for (const m of MORPHS) expect(Number.isFinite(s[m])).toBe(true);
    }
  });

  it('follows the voice’s own word timing exactly when the TTS reports it', () => {
    const env = envelope(buffer([[3, true]])); // one long voiced stretch: no pause to go by
    const text = 'Good morning, Maria.';
    const spans = [
      { s: 0.2, e: 0.45 },
      { s: 0.5, e: 1.0 },
      { s: 1.6, e: 2.2 }, // a real pause before "Maria"
    ];
    const keys = timeline(text, env, spans);
    for (let i = 1; i < keys.length; i++)
      expect((keys[i] as { t: number }).t).toBeGreaterThan((keys[i - 1] as { t: number }).t);
    const inWord = (k: { t: number }, w: { s: number; e: number }) => k.t >= w.s && k.t <= w.e;
    const voiced = keys.filter((k) => k.v !== 'sil');
    expect(voiced.map((k) => k.v)).toEqual([
      ...wordVisemes('Good'),
      ...wordVisemes('morning,'),
      ...wordVisemes('Maria.'),
    ]);
    expect(voiced.every((k) => spans.some((w) => inWord(k, w)))).toBe(true);
    // the mouth rests in the pause, though the audio never goes quiet
    expect(sample(keys, 1.3).jaw).toBe(0);
    // a mismatched word count falls back to the audio-only timing
    expect(timeline(text, env, spans.slice(1)).length).toBeGreaterThan(0);
  });

  it('rounds the lips ahead of a rounded vowel and never mutates the rest pose', () => {
    const keys = [
      { t: 0, v: 'sil' as const },
      { t: 0.3, v: 'DD' as const },
      { t: 0.5, v: 'U' as const },
      { t: 0.8, v: 'sil' as const },
    ];
    // just before the U is due, the lips are already partly rounded
    const early = sample(keys, 0.5 - ROUND_LEAD * 0.5);
    expect(early.mouthRound).toBeGreaterThan(0.3);
    const before = sample(keys, -1);
    before.mouthRound = 1;
    expect(sample(keys, -1).mouthRound).toBe(0);
  });

  it('moves the mouth on a critically damped spring: no overshoot, stable at any frame time', () => {
    for (const dt of [1 / 120, 1 / 30, 0.1]) {
      let x = 0;
      let v = 0;
      let max = 0;
      for (let i = 0; i < Math.ceil(1 / dt); i++) {
        [x, v] = spring(x, v, 1, 55, dt);
        max = Math.max(max, x);
      }
      expect(max).toBeLessThanOrEqual(1 + 1e-9);
      expect(x).toBeCloseTo(1, 3);
    }
  });
});
