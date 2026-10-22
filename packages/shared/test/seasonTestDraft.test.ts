import { describe, expect, it } from 'vitest';
import { seasonTestQuestionIssues } from '../src/contracts/seasonTest';
import { DEMO_DRAFT_PARTS, demoSeasonTestDraft } from '../src/demo/seasonTestDraft';

const episodes = [
  {
    num: 1,
    title: 'One',
    visual: [
      { en: 'door', pt: 'porta' },
      { en: 'kitchen', pt: 'cozinha' },
      { en: 'window', pt: 'janela' },
    ],
    awayExp: [
      { en: 'Nice to meet you', pt: 'Prazer' },
      { en: 'See you later', pt: 'Até mais' },
    ],
  },
  { num: 2, title: 'Two', visual: [{ en: 'table', pt: 'mesa' }], awayExp: [{ en: 'How are you?', pt: 'Como vai?' }] },
];

describe('demoSeasonTestDraft', () => {
  it('drafts valid, deduplicated questions grouped by part, deterministically', () => {
    const a = demoSeasonTestDraft({ episodes, count: 10, seed: 7 });
    expect(a).toEqual(demoSeasonTestDraft({ episodes, count: 10, seed: 7 }));
    expect(a).toHaveLength(10);
    for (const q of a) {
      expect(seasonTestQuestionIssues(q)).toEqual([]);
      expect([1, 2]).toContain(q.epNum);
      if (q.opts) expect(q.opts[q.answerIdx ?? -1]).toBe(q.show);
    }
    const order = Object.values(DEMO_DRAFT_PARTS) as string[];
    const idx = a.map((q) => order.indexOf(q.partTitle));
    expect(idx).toEqual([...idx].sort((x, y) => x - y));
  });

  it('respects count, skips existing questions and applies a forced part', () => {
    const first = demoSeasonTestDraft({ episodes, count: 3, seed: 1 });
    const second = demoSeasonTestDraft({ episodes, count: 30, existing: first.map((q) => q.q), partTitle: 'Parte A' });
    expect(second.some((q) => !q.audio && first.some((f) => f.q === q.q))).toBe(false);
    expect(second.every((q) => q.partTitle === 'Parte A')).toBe(true);
    expect(demoSeasonTestDraft({ episodes: [], count: 5 })).toEqual([]);
  });
});
