import { describe, expect, it } from 'vitest';
import { envelope, MORPHS, sample, timeline, wordVisemes } from '../src/screens/maggie/avatar3d/lipsync';

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

  it('always returns every morph, also before and after the line', () => {
    const keys = timeline('Hi there.', envelope(buffer([[0.5, true]])));
    for (const t of [-1, 0.2, 99]) {
      const s = sample(keys, t);
      for (const m of MORPHS) expect(Number.isFinite(s[m])).toBe(true);
    }
  });
});
