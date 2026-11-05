import { describe, expect, it } from 'vitest';
import { LyricLine } from '../src/content/schema';
import {
  alignLyricTimes,
  gapIn,
  lineTimes,
  lyricLineAt,
  lyricTimesOutOfOrder,
  pickGap,
  songTokens,
  type TimedWord,
  wordsToLines,
} from '../src/domain/songSync';

/** Words of `text` sung one every `step` s from `from`. */
function sing(text: string, from: number, step = 0.4, seg = 0): TimedWord[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => ({ w, s: from + i * step, e: from + i * step + step * 0.8, seg }));
}

describe('songTokens', () => {
  it('folds case, accents, curly quotes and punctuation, keeping inner apostrophes', () => {
    expect(songTokens('Hi! Hi! I’m fine — and you?')).toEqual(['hi', 'hi', "i'm", 'fine', 'and', 'you']);
    expect(songTokens('Café, "olá"')).toEqual(['cafe', 'ola']);
    expect(songTokens('')).toEqual([]);
  });
});

describe('lyricLineAt / lineTimes', () => {
  const four = [{}, {}, {}, {}];
  it('without times keeps the prototype proportional rule', () => {
    expect(lineTimes(four, 40)).toBeNull();
    expect(lyricLineAt(four, 0, 40)).toBe(0);
    expect(lyricLineAt(four, 19.9, 40)).toBe(1);
    expect(lyricLineAt(four, 40, 40)).toBe(3);
    expect(lyricLineAt([], 5, 40)).toBe(0);
  });

  it('with times follows them, a little early', () => {
    const ly = [{ t: 2 }, { t: 6 }, { t: 11 }, { t: 30 }];
    expect(lyricLineAt(ly, 0, 40)).toBe(0);
    expect(lyricLineAt(ly, 5.7, 40)).toBe(0);
    expect(lyricLineAt(ly, 5.8, 40)).toBe(1);
    expect(lyricLineAt(ly, 29, 40)).toBe(2);
    expect(lyricLineAt(ly, 35, 40)).toBe(3);
    expect(lyricLineAt(ly, 5.8, 40, 0)).toBe(0);
  });

  it('interpolates the lines without a time between their neighbours', () => {
    expect(lineTimes([{ t: 10 }, {}, { t: 20 }], 60)).toEqual([10, 15, 20]);
    expect(lineTimes([{}, { t: 9 }], 60)).toEqual([4.5, 9]);
    expect(lineTimes([{ t: 30 }, {}, {}], 60)).toEqual([30, 40, 50]);
    expect(lineTimes([{ t: null }, { t: 4 }], 0)).toEqual([2, 4]);
  });

  it('finds a time that goes backwards', () => {
    expect(lyricTimesOutOfOrder([{ t: 1 }, {}, { t: 3 }])).toBe(-1);
    expect(lyricTimesOutOfOrder([{ t: 5 }, { t: 5 }, { t: 2 }])).toBe(2);
  });

  it('the content schema accepts the optional start time', () => {
    expect(LyricLine.parse({ en: 'Hi', pt: 'Oi', t: 1.5 })).toEqual({ en: 'Hi', pt: 'Oi', t: 1.5 });
    expect(LyricLine.safeParse({ en: 'Hi', pt: 'Oi', t: -1 }).success).toBe(false);
  });
});

describe('wordsToLines', () => {
  it('breaks at pauses, sentence ends and segments, and drops sound tags', () => {
    const words: TimedWord[] = [
      { w: '[Music]', s: 0, e: 4 },
      { w: '♪', s: 4, e: 4.2 },
      ...sing('Hi! Hi! Good morning!', 5),
      ...sing('Hi! Hi! How are you?', 7.5),
      ...sing("I'm fine, I'm fine, thank you.", 11, 0.4, 1),
      { w: '(upbeat', s: 14, e: 14.5 },
      { w: 'music)', s: 14.5, e: 15 },
      ...sing('Bye bye see you soon', 20, 0.4, 2),
      ...sing('Thanks for watching!', 40, 0.4, 3),
    ];
    const lines = wordsToLines(words);
    expect(lines.map((l) => l.en)).toEqual([
      'Hi! Hi! Good morning!',
      'Hi! Hi! How are you?',
      "I'm fine, I'm fine, thank you.",
      'Bye bye see you soon',
    ]);
    expect(lines.map((l) => l.t)).toEqual([5, 7.5, 11, 20]);
  });

  it('breaks at a sentence end without a pause once the line has 3 words', () => {
    const lines = wordsToLines(sing('Hi! Hi! Good morning! Hi! Hi! How are you?', 0, 0.3));
    expect(lines.map((l) => l.en)).toEqual(['Hi! Hi! Good morning!', 'Hi! Hi! How are you?']);
    expect(lines[1]?.t).toBe(1.2);
  });

  it('caps long lines and capitalises them', () => {
    const lines = wordsToLines(sing('one two three four five six seven eight nine ten eleven twelve', 1, 0.3), {
      maxWords: 6,
    });
    expect(lines.map((l) => l.en)).toEqual(['One two three four five six', 'Seven eight nine ten eleven twelve']);
    expect(lines[1]?.t).toBe(2.8);
  });
});

describe('alignLyricTimes', () => {
  const lyrics = [
    'Hi! Hi! Good morning!',
    'Hi! Hi! How are you?',
    "I'm fine, I'm fine, thank you.",
    "I'm fine — and how are you?",
    'Hello! Hello! My name is Zach.',
  ];

  it('times each typed line by the words heard, ignoring a spoken intro and misheard words', () => {
    const words = [
      ...sing('Take it easy everybody', 0),
      ...sing('hi hi good morning', 8.2),
      ...sing('hi hi how are you', 12),
      ...sing('im fine im fine thank you', 16.1),
      ...sing("I'm fine and how are you", 21),
      ...sing('hello hello my name is jack', 26.4),
    ];
    const r = alignLyricTimes(lyrics, words, 40);
    expect(r.heard).toEqual([true, true, true, true, true]);
    expect(r.t[0]).toBe(8.2);
    expect(r.t[1]).toBe(12);
    // "I'm" heard as "im" still matches.
    expect(r.t[2]).toBe(16.1);
    expect(r.t[3]).toBe(21);
    expect(r.t[4]).toBe(26.4);
  });

  it('interpolates a line the recognition skipped', () => {
    const words = [
      ...sing('hi hi good morning', 8),
      ...sing('hi hi how are you', 12),
      ...sing("I'm fine and how are you", 20),
      ...sing('hello hello my name is Zach', 24),
    ];
    const r = alignLyricTimes(lyrics, words, 40);
    expect(r.heard).toEqual([true, true, false, true, true]);
    expect(r.t[2]).toBe(16);
    expect(r.t[3]).toBe(20);
  });

  it('spreads the lines evenly when nothing was heard', () => {
    const r = alignLyricTimes(['a b', 'c d', 'e f', 'g h'], [], 40);
    expect(r).toEqual({ t: [0, 10, 20, 30], heard: [false, false, false, false] });
    expect(alignLyricTimes([], sing('x', 0), 10)).toEqual({ t: [], heard: [] });
  });
});

describe('gaps', () => {
  it('keeps a gap that is a word of the line, as written', () => {
    expect(gapIn('Hi! Hi! Good morning!', 'MORNING')).toBe('morning');
    expect(gapIn('My name is Zach.', 'Zach')).toBe('Zach');
    expect(gapIn('My name is Zach.', 'zack')).toBeNull();
    expect(gapIn('My name is Zach.', 'my name')).toBeNull();
  });

  it('picks the longest meaningful word', () => {
    expect(pickGap('Hi! Hi! Good morning!')).toBe('morning');
    expect(pickGap('I am a you')).toBe('you');
    expect(pickGap('Nice to meet you.')).toBe('meet');
  });
});
