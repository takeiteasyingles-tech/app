import { describe, expect, it } from 'vitest';
import { AI_LIMITS, clampReport, ReportResult } from '../src/contracts/ai';
import { analyze, recast } from '../src/demo/analyze';
import { demoPronounce } from '../src/demo/demoPronounce';
import { demoReply } from '../src/demo/demoReply';
import { demoReport, type ReportTurn } from '../src/demo/demoReport';
import { hintFor } from '../src/demo/hints';
import { pronWatch } from '../src/demo/pronWatch';
import { PRAISE, PT_WORDS, RULES } from '../src/demo/rules';
import { type DemoSession, opener, script } from '../src/demo/script';
import { tsContent } from './helpers/catalog';
import { loadPrototypeCore, plain } from './helpers/core';
import type { Any } from './helpers/prototype';

const core = loadPrototypeCore();
const { T } = core;
const AI = T.ai;
const X = T.ai.__;
const C = tsContent(T.data);

// 50+ learner sentences: every one of the 15 rules, Portuguese mixing, short answers, clean ones.
const SENTENCES = [
  'I have 30 years.',
  'i has twenty-five years old',
  'I have 18 year',
  'am tired today',
  'Is very good.',
  'is raining',
  'I’m engineer.',
  "I'm designer at a startup",
  'She is teacher in my school.',
  'you are artist',
  'He’s student.',
  'People is very nice here.',
  'The people is crazy',
  'I am agree with you.',
  'I’m agree',
  'Can I make a question?',
  'I want to make some questions',
  'Please explain me the rule.',
  'It depends of the weather.',
  'That depend of you',
  'She like coffee.',
  'He have two kids.',
  'It work very well',
  'My brother, he go to school by bus.',
  'She don’t like rain.',
  "he don't know",
  "It don't matter",
  'I play soccer in the weekend.',
  'What do you do in the weekend?',
  'I like very much anime.',
  'I like so much pizza',
  'Yesterday I go to the beach.',
  'Last week we watch a movie.',
  'last weekend they play games at home',
  'Yesterday, after work, she eat pizza.',
  'I want that you help me.',
  'I live here since 3 years.',
  'I study English since two months.',
  'Eu não sei.',
  'I like it, mas é difícil.',
  'Muito obrigado!',
  'Yes.',
  'Pizza',
  'Fine, thanks',
  'I’m a designer and I love music.',
  'I watched a great movie yesterday.',
  'My favorite series is Woods & Beans. And you?',
  'I think it’s fun because I learn a lot.',
  'Hi, how are you?',
  'She speaks English very well.',
  'This is a big ship and the sheep is small.',
  'Thanks, I think so.',
  'Honestly, this hour is perfect.',
  'Stop speaking so slowly, Steve!',
  '',
  '   ',
];

describe('rules table matches ai.js', () => {
  it('15 rules with the same regexes and copy', () => {
    expect(RULES).toHaveLength(15);
    expect(X.RULES).toHaveLength(15);
    RULES.forEach((r, i) => {
      const p = X.RULES[i];
      expect(r.re.source).toBe(p.re.source);
      expect(r.re.flags).toBe(p.re.flags);
      expect(r.exp).toBe(p.exp);
      expect(r.cat).toBe(p.cat);
    });
    expect(PT_WORDS.source).toBe(X.PT.source);
    expect([...PRAISE]).toEqual(plain(X.PRAISE));
  });

  it('the sentence set exercises every rule as the first match', () => {
    const first = new Set(SENTENCES.map((s) => RULES.findIndex((r) => r.re.test(s.trim()))));
    for (let i = 0; i < RULES.length; i++) expect(first.has(i), `rule ${i}`).toBe(true);
    expect(SENTENCES.length).toBeGreaterThanOrEqual(40);
  });
});

describe('analyze / pronWatch / hintFor / recast', () => {
  it('analyze with a seeded Math.random', () => {
    SENTENCES.forEach((s, i) => {
      const rng = core.seed(1000 + i);
      expect(analyze(s, rng), s).toEqual(plain(AI.analyze(s)));
    });
    expect(analyze(null)).toEqual(plain(AI.analyze(null)));
    // The seed really drives the prototype's pick(): different seeds give different praise.
    const praises = new Set(
      Array.from({ length: 20 }, (_, i) => {
        core.seed(i);
        return AI.analyze('I watched a great movie yesterday.').explain_pt;
      }),
    );
    expect(praises.size).toBeGreaterThan(1);
  });

  it('pronWatch', () => {
    const extra = [
      'hour',
      'honest',
      'honor',
      'hello',
      'school',
      'speak',
      'think',
      'big',
      'good',
      'ok',
      'cup',
      'He’s',
      "I'm",
    ];
    for (const s of [...SENTENCES, ...extra]) expect(pronWatch(s), s).toEqual(plain(AI.pronWatch(s)));
  });

  it('hintFor on every scripted line and the sentences', () => {
    const M = T.data.MAGGIE;
    const lines: string[] = [
      ...Object.values(M.OPENERS).map((o: Any) => o.en),
      ...M.FOLLOW.map((f: Any) => f.en),
      ...Object.values(M.MISSIONS).flatMap((m: Any) => m.turns.map((t: Any) => t.en)),
      ...SENTENCES,
      'How old are you?',
      'How long are you staying?',
      'Is it hard?',
      'Was it fun?',
      'Are you OK?',
      'What are you listening to?',
      'What do you do?',
      'Do you have any questions for me?',
    ];
    expect(lines.length).toBeGreaterThan(60);
    for (const l of lines) expect(hintFor(l), l).toEqual(plain(X.hintFor(l)));
    expect(hintFor(undefined)).toEqual(plain(X.hintFor(undefined)));
  });

  it('recast', () => {
    const inputs = [
      ...SENTENCES.map((s) => analyze(s, () => 0).corrected),
      'I’m a designer.',
      'I am a teacher!!',
      'Explain to me my problem?',
      'I really like anime.',
      'This is a very long sentence with more than eight words in it.',
      '',
    ];
    for (const c of inputs) expect(recast(c), c).toBe(X.recast(c));
  });
});

describe('scripted replies', () => {
  const base = { name: 'Ana', aName: 'Robert', aThe: 'o Robert' };
  const sessions: DemoSession[] = [];
  for (const f of [['animes'], ['viagens', 'musica'], ['games'], [], undefined]) {
    sessions.push({ mode: 'livre', ctxFormats: f, turn: 0, ...base });
  }
  sessions.push({ mode: 'pronuncia', ctxFormats: ['series'], turn: 0, name: 'Bia' });
  for (const k of [...Object.keys(T.data.MAGGIE.MISSIONS), undefined]) {
    sessions.push({ mode: 'missao', mission: k ?? null, turn: 0, ...base });
  }
  for (const id of ['woods-and-beans', 'last-train', 'nope', undefined]) {
    sessions.push({ mode: 'extra', extraId: id ?? null, turn: 0, name: 'Caio', aName: 'Zach', aThe: 'o Zach' });
  }

  it('script selection', () => {
    for (const sess of sessions) {
      const proto = plain(X.script(sess)).map((t: Any) => ({
        ...t,
        ...(t.words ? { words: t.words.map(([en, pt]: string[]) => ({ en, pt })) } : {}),
      }));
      expect(plain(script(sess, C)), JSON.stringify(sess)).toEqual(proto);
    }
  });

  it('opener', () => {
    for (const sess of sessions) {
      const p = AI.opener(sess);
      const h = AI.hint(p.reply_en);
      expect(opener(sess, C)).toEqual({
        reply_en: p.reply_en,
        reply_pt: p.reply_pt,
        mood: p.mood,
        words: p.words.map(([en, pt]: string[]) => ({ en, pt })),
        hint_en: h.en,
        hint_pt: h.pt,
      });
    }
  });

  it('demoReply across modes, turns and answers with seeded randomness', () => {
    let n = 0;
    sessions.forEach((s0, si) => {
      for (let turn = 0; turn < 8; turn++) {
        const text = SENTENCES[(si * 7 + turn * 3) % SENTENCES.length] as string;
        const sess = { ...s0, turn };
        const seed = si * 100 + turn;
        const rng = core.seed(seed);
        const proto = plain(X.demoReply(sess, text));
        expect(demoReply(sess, text, C, rng), `${JSON.stringify(sess)} ${text}`).toEqual(proto);
        n++;
      }
    });
    expect(n).toBeGreaterThan(100);
  });
});

describe('demoReport', () => {
  const her = (en: string, words: [string, string][] = []): ReportTurn => ({
    who: 'her',
    en,
    words: words.map(([en, pt]) => ({ en, pt })),
  });
  const me = (en: string, seed: number): ReportTurn => ({
    who: 'me',
    en,
    fb: analyze(en, () => (seed % 5) / 5),
    pron: pronWatch(en),
    words: [],
  });

  const sessions: { turns: ReportTurn[]; aThe?: string }[] = [
    { turns: [her('Hi!')] },
    { turns: [her('Hi!', [['hello', 'olá']]), me('I have 30 years.', 1)], aThe: 'o Robert' },
    {
      turns: [
        her('Where are you from?', [['where are you from', 'de onde você é']]),
        me('I’m from Brazil. And you?', 2),
        her('What do you do?', [['What do you do?', 'Com o que você trabalha?']]),
        me('I’m engineer.', 3),
        her('Nice.', [['hello', 'olá']]),
        me('She like coffee and he have a dog.', 4),
        me('Yesterday I go to the beach with my friends.', 5),
        me('People is nice here.', 6),
        me('I really like the people in this town.', 7),
        me('Sim', 8),
      ],
      aThe: 'a Becky',
    },
    {
      turns: SENTENCES.flatMap((s, i) => [
        her(`Line ${i}`, [
          [`w${i % 11}`, `p${i}`],
          ['shared', 'comum'],
        ]),
        ...(s.trim() ? [me(s, i)] : []),
      ]),
    },
    { turns: [me('Hi', 0), me('Yes', 1)], aThe: 'o Zach' },
  ];

  it('matches ai.report offline (lists capped to AI_LIMITS)', async () => {
    for (const sess of sessions) {
      const proto = plain(await AI.report(structuredClone(sess)));
      expect(demoReport(sess)).toEqual(clampReport(proto));
    }
  });

  it('stays within ReportResult with more than 8 fixable turns', async () => {
    const fixable = SENTENCES.slice(0, 20).map((s, i) => me(s, i));
    const sess = { turns: fixable };
    const proto = plain(await AI.report(structuredClone(sess)));
    expect(proto.fixes.length).toBeGreaterThan(AI_LIMITS.fixes);

    const report = demoReport(sess);
    expect(ReportResult.safeParse(report).success).toBe(true);
    expect(report.fixes).toEqual(proto.fixes.slice(0, AI_LIMITS.fixes));
    // The summary still counts every fix, like the prototype.
    expect(report.summary_pt).toBe(proto.summary_pt);
  });
});

describe('demoPronounce', () => {
  it('matches ai.pronounce offline', async () => {
    const targets = [
      ...T.data.MAGGIE.PRON.map((p: Any) => p.en),
      ...Object.values(T.data.EPS).flatMap((E: Any) => E.mic.map((m: Any) => m.en)),
      'Hello! I’m Margaret.',
    ];
    const heardFor = (t: string) => [
      t,
      t.toUpperCase(),
      t.split(' ').slice(0, -1).join(' '),
      t.split(' ').slice(1).join(' '),
      t.split(' ').reverse().join(' '),
      'completely different words here',
      '',
      undefined,
      `${t} extra words`,
      'hello',
    ];
    let n = 0;
    for (const t of targets) {
      for (const h of heardFor(t)) {
        expect(demoPronounce(t, h), `${t} | ${h}`).toEqual(plain(await AI.pronounce('', t, h)));
        n++;
      }
    }
    expect(n).toBeGreaterThan(50);
  });
});
