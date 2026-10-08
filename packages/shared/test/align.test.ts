import { describe, expect, it } from 'vitest';
import { PronounceResult } from '../src/contracts/ai';
import { align, alignTokens, scorePronunciation } from '../src/demo/align';

describe('alignTokens', () => {
  it('normalizes punctuation, case, quotes, accents, contractions and small numbers', () => {
    expect(alignTokens('Hello! I am Ana.')).toEqual(['hello', "i'm", 'ana']);
    expect(alignTokens('I’m from São Paulo')).toEqual(["i'm", 'from', 'sao', 'paulo']);
    expect(alignTokens('Gate 12, please')).toEqual(['gate', 'twelve', 'please']);
    expect(alignTokens('  ')).toEqual([]);
    expect(alignTokens(undefined)).toEqual([]);
  });
});

describe('align', () => {
  it('identical sentences score 10', () => {
    const a = align('Hi, how are you?', 'hi how are you');
    expect(a).toMatchObject({ distance: 0, score: 10, missed: [] });
    expect(a.ops.every((o) => o.op === 'ok')).toBe(true);
  });

  it('counts substitutions, deletions and insertions', () => {
    const a = align('She’s a student at school.', 'she is a student and school');
    expect(a.distance).toBe(1);
    expect(a.missed).toEqual(['at']);
    expect(a.score).toBe(8);

    const del = align('This is a big ship.', 'this is a ship');
    expect(del.ops.filter((o) => o.op === 'del')).toEqual([{ op: 'del', target: 'big' }]);
    expect(del.score).toBe(8);

    const ins = align('Thanks', 'thanks thanks a lot');
    expect(ins.ops.filter((o) => o.op === 'ins')).toHaveLength(3);
    expect(ins.score).toBe(0);
  });

  it('is 0..10, symmetric in edge cases and deterministic', () => {
    expect(align('Hello there', '').score).toBe(0);
    expect(align('', '').score).toBe(10);
    expect(align('', 'something').score).toBe(0);
    expect(align('one two three four', 'four three two one').score).toBe(
      align('one two three four', 'four three two one').score,
    );
    for (const h of [
      '',
      'a',
      'welcome',
      'welcome to',
      'welcome to our',
      'welcome to our home',
      'welcome to our home today',
    ]) {
      const s = align('Welcome to our home.', h).score;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(10);
    }
  });
});

describe('scorePronunciation', () => {
  it('returns a valid PronounceResult with tips for missed words', () => {
    const r = scorePronunciation('Welcome to our home.', 'welcome to our');
    expect(PronounceResult.safeParse(r).success).toBe(true);
    expect(r.score).toBe(8);
    expect(r.issues).toEqual([
      {
        word: 'home',
        issue_pt: 'Não deu para entender esta palavra.',
        tip_pt: 'O h de home é só ar. Nada de R de “rato”.',
      },
    ]);
    expect(r.praise_pt).toBe('Quase lá. Ajuste os pontos abaixo.');
    expect(r.source).toBe('ia');
  });

  it('a perfect read has no issues', () => {
    const r = scorePronunciation('Thanks, I think so.', 'Thanks, I think so.');
    expect(r).toMatchObject({ score: 10, issues: [], praise_pt: 'Entendi tudo de primeira.' });
  });

  it('nothing heard scores 0', () => {
    const r = scorePronunciation('Sheep and ship.', '');
    expect(r.score).toBe(0);
    expect(r.issues.map((i) => i.word)).toEqual(['sheep', 'and']);
    expect(r.praise_pt).toBe('Tente de novo, mais devagar.');
  });
});
