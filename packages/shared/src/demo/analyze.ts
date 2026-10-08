import type { Feedback } from '../contracts/ai';
import { pick, type Rng } from './rng';
import { PRAISE, PT_WORDS, RULES } from './rules';

/** Demo feedback for one learner sentence (ai.js analyze). Only 'certo' consumes the rng. */
export function analyze(text: unknown, rng: Rng = Math.random): Feedback {
  const t = String(text || '').trim();
  const words = t.split(/\s+/).filter(Boolean);
  for (const r of RULES) {
    const m = t.match(r.re);
    if (m) {
      const at = m.index ?? 0;
      const corrected = (t.slice(0, at) + r.fix(m) + t.slice(at + m[0].length)).replace(/^\w/, (c) => c.toUpperCase());
      return { status: 'ajuste', original: t, corrected, explain_pt: r.exp, cat: r.cat };
    }
  }
  if (PT_WORDS.test(t)) {
    return {
      status: 'natural',
      original: t,
      corrected: '',
      explain_pt: 'Tudo bem misturar. Quando faltar a palavra, pergunte: How do you say “…” in English?',
      cat: 'Português no meio',
    };
  }
  if (words.length <= 2) {
    return {
      status: 'natural',
      original: t,
      corrected: '',
      explain_pt: 'Resposta curta funciona. Para treinar, tente uma frase inteira, começando com I…',
      cat: 'Resposta curta',
    };
  }
  return { status: 'certo', original: t, corrected: '', explain_pt: pick(PRAISE, rng), cat: '' };
}

/** Echoes a short correction back in second person: "Oh, you’re a designer. " ('' if long). */
export function recast(c: string | null | undefined): string {
  if (!c || c.split(' ').length > 8) return '';
  let r = ` ${c.replace(/[.!?]+$/, '')} `;
  r = r
    .replace(/ I’m /gi, ' you’re ')
    .replace(/ I am /gi, ' you are ')
    .replace(/ I /g, ' you ')
    .replace(/ my /gi, ' your ')
    .replace(/ me /gi, ' you ');
  return `Oh, ${r.trim()}. `;
}
