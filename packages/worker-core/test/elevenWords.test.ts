import { describe, expect, it } from 'vitest';
import { wordSpans } from '../src/services/eleven';

const align = (text: string, step = 0.05) => {
  const chars = [...text];
  return { chars, starts: chars.map((_, i) => i * step), ends: chars.map((_, i) => (i + 1) * step) };
};

describe('ElevenLabs character alignment → word spans', () => {
  it('gives one span per whitespace-separated word, from its first to its last character', () => {
    const text = 'Hi, I am  Maggie.';
    const a = align(text);
    const spans = wordSpans(text, a.chars, a.starts, a.ends);
    expect(spans?.map((w) => [Math.round(w.s * 100), Math.round(w.e * 100)])).toEqual([
      [0, 15],
      [20, 25],
      [30, 40],
      [50, 85],
    ]);
  });

  it('is null when the alignment is not the text one to one', () => {
    const a = align('Hello there');
    expect(wordSpans('Hello there!', a.chars, a.starts, a.ends)).toBeNull();
    expect(wordSpans('Hello there', a.chars, a.starts.slice(1), a.ends)).toBeNull();
  });
});
