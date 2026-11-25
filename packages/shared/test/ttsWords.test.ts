import { describe, expect, it } from 'vitest';
import { decodeWordSpans, encodeWordSpans } from '../src/contracts/ai';

describe('TTS word-timing header', () => {
  it('round-trips spans at centisecond precision', () => {
    const raw = encodeWordSpans([
      { s: 0, e: 0.642 },
      { s: 0.7, e: 1.204 },
    ]);
    expect(raw).toBe('0,64;70,120');
    expect(decodeWordSpans(raw)).toEqual([
      { s: 0, e: 0.64 },
      { s: 0.7, e: 1.2 },
    ]);
  });

  it('rejects anything that is not the header format', () => {
    for (const bad of [null, undefined, '', '1,2;', 'a,b', '1;2', '1,2;3']) expect(decodeWordSpans(bad)).toBeNull();
  });

  it('never returns an end before its start', () => {
    expect(decodeWordSpans('50,40')).toEqual([{ s: 0.5, e: 0.5 }]);
  });
});
