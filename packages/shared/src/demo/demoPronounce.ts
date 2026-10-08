import type { PronounceIssue, PronounceResult } from '../contracts/ai';
import { pronWatch } from './pronWatch';

const words = (s: unknown) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z' ]/g, '')
    .split(/\s+/)
    .filter(Boolean);

/** Shared praise tiers: 9+ all clear, 7+ almost, otherwise try again. */
export function praiseFor(score: number): string {
  return score >= 9
    ? 'Entendi tudo de primeira.'
    : score >= 7
      ? 'Quase lá. Ajuste os pontos abaixo.'
      : 'Tente de novo, mais devagar.';
}

/**
 * Pronunciation score without the AI (ai.js pronounce, demo branch): word overlap between the
 * target and what the browser recognizer heard; 7 when nothing was heard.
 */
export function demoPronounce(target: string, heard: string | null | undefined): PronounceResult {
  const T = words(target);
  const H = words(heard);
  const hit = T.filter((w) => H.includes(w)).length;
  const score = heard ? Math.max(4, Math.round((hit / Math.max(1, T.length)) * 10)) : 7;
  const miss = T.filter((w) => !H.includes(w));
  const issues: PronounceIssue[] = (miss.length ? miss : T).slice(0, 2).map((w) => {
    const p = pronWatch(w)[0];
    return {
      word: w,
      issue_pt: miss.includes(w) ? 'Não deu para entender esta palavra.' : 'Ponto de atenção para quem fala português.',
      tip_pt: p ? p.tip_pt : 'Fale mais devagar e marque a sílaba forte.',
    };
  });
  return { score, heard: heard || '', issues: score >= 9 ? [] : issues, praise_pt: praiseFor(score), source: 'demo' };
}
