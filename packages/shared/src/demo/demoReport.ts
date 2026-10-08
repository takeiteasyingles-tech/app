import type { Bilingual } from '../content/schema';
import { clampReport, type Feedback, type PronTip, type ReportFix, type ReportResult } from '../contracts/ai';

export interface ReportTurn {
  who: string;
  en: string;
  fb?: Feedback | null;
  pron?: readonly PronTip[] | null;
  words?: readonly Bilingual[] | null;
}

export interface ReportSession {
  turns: readonly ReportTurn[];
  /** "a Maggie" / "o Robert". */
  aThe?: string | null;
}

/** End-of-conversation report built from the turns alone (ai.js report, demo branch). */
export function demoReport(sess: ReportSession): ReportResult {
  const aThe = sess.aThe || 'a Maggie';
  const mine = sess.turns.filter((t) => t.who === 'me');
  const fixes: ReportFix[] = mine.flatMap((t) =>
    t.fb && t.fb.status === 'ajuste'
      ? [{ said: t.fb.original, better: t.fb.corrected, why_pt: t.fb.explain_pt, cat: t.fb.cat }]
      : [],
  );
  const good = mine.filter((t) => t.fb && t.fb.status === 'certo');
  const pron: PronTip[] = [];
  for (const t of mine) for (const p of t.pron || []) if (!pron.find((x) => x.word === p.word)) pron.push(p);
  const words: Bilingual[] = [];
  for (const t of sess.turns) for (const w of t.words || []) if (!words.find((x) => x.en === w.en)) words.push(w);
  const cats: Record<string, number> = {};
  for (const f of fixes) cats[f.cat] = (cats[f.cat] || 0) + 1;
  const top = Object.keys(cats).sort((a, b) => (cats[b] ?? 0) - (cats[a] ?? 0))[0];

  const strengths: string[] = [];
  if (good.length) {
    strengths.push(
      good.length + (good.length > 1 ? ' falas saíram certas de primeira.' : ' fala saiu certa de primeira.'),
    );
  }
  if (mine.some((t) => t.en.split(' ').length >= 6)) {
    strengths.push('Você arriscou frases longas, e isso é o que mais faz a fala destravar.');
  }
  if (mine.some((t) => /\?$/.test(t.en.trim()) || /\b(and you|you\?)\b/i.test(t.en))) {
    strengths.push('Você devolveu perguntas. Conversa em inglês é assim: sempre devolva a bola.');
  }
  if (!strengths.length) {
    strengths.push('Você ficou até o fim da conversa. Voltar amanhã vale mais do que acertar tudo hoje.');
  }

  const summary_pt = mine.length
    ? `Você falou ${mine.length}${mine.length > 1 ? ' vezes' : ' vez'} com ${aThe}${
        fixes.length
          ? ` e ${fixes.length}${fixes.length > 1 ? ' falas pediram ajuste.' : ' fala pediu ajuste.'}`
          : ' sem nenhum ajuste.'
      }`
    : 'A conversa terminou antes de você falar. Tudo bem: tente de novo com a Dica ligada.';
  const next_goal_pt = top
    ? `Próxima meta: ${top.toLowerCase()}. ${aThe.replace(/^./, (c) => c.toUpperCase())} vai puxar esse ponto na próxima conversa.`
    : 'Próxima meta: frases mais longas. Tente juntar duas ideias com and ou because.';

  // The summary still counts every fix; only the lists are capped (the prototype did not cap fixes).
  return clampReport({ summary_pt, strengths, fixes, pron, words, next_goal_pt, source: 'demo' });
}
