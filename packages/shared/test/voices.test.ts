import { describe, expect, it } from 'vitest';
import { mergeVoices, sameVoices } from '../src/domain/voices';

const A = 'VoiceAAAA0000001';
const B = 'VoiceBBBB0000002';
const C = 'VoiceCCCC0000003';

describe('mergeVoices', () => {
  it('applies only this screen changes over the latest saved voices', () => {
    // This screen loaded no voices and set the Take a Look narration; meanwhile someone set the cast.
    const latest = { cast: { Zach: A, Margaret: B } };
    const out = mergeVoices(latest, {}, { steps: { '3': C } });
    expect(out).toEqual({ steps: { '3': C }, cast: { Zach: A, Margaret: B } });
  });

  it('removes what this screen cleared and keeps what it did not touch', () => {
    const base = { narrator: A, cast: { Zach: B } };
    const latest = { narrator: A, cast: { Zach: B, Becky: C }, extras: { narrator: C } };
    const out = mergeVoices(latest, base, { narrator: A, cast: {} });
    expect(out).toEqual({ narrator: A, cast: { Becky: C }, extras: { narrator: C } });
  });

  it('merges the extras voices the same way', () => {
    const latest = { cast: { Zach: A }, extras: { cast: { Margaret: B } } };
    const out = mergeVoices(latest, { extras: undefined }, { extras: { narrator: C } });
    expect(out).toEqual({ cast: { Zach: A }, extras: { narrator: C, cast: { Margaret: B } } });
    expect(sameVoices(out, { extras: { cast: { Margaret: B }, narrator: C }, cast: { Zach: A } })).toBe(true);
  });
});
