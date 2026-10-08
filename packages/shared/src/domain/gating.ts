import type { Episode } from '../content/schema';
import { stepKey, type TieState } from '../state';

// need() from prototipo/js/screens/player.js, keyed by stable ids instead of list indexes:
// scores[phraseId] instead of scores['ep-i'], exAns[itemId] instead of exAns['ep-x-j'].
// The server runs the same function before accepting /api/progress/advance.

export type GateEpisode = Pick<Episode, 'num' | 'ebook'> & {
  sceneVideo: string | null | undefined;
  mic: readonly { id: string }[];
  ex: readonly { items: readonly { id: string }[] }[];
};

export type GateState = Pick<TieState, 'ebooks' | 'epsDone' | 'prog' | 'stepOk' | 'scores' | 'exAns'>;

/** What is still missing before the step lets the student move on ('' = unlocked). */
export function need(ep: GateEpisode, s: GateState, step: number): string {
  if (step === 3) return s.ebooks[ep.ebook] ? '' : 'Baixe o e-book para seguir';
  if (s.epsDone[ep.num] || (s.prog[ep.num] || 1) > step || s.stepOk[stepKey(ep.num, step)]) return '';
  if (step === 1) return 'Ouça a abertura até o fim';
  if (step === 2) return 'Ouça a música até o fim';
  if (step === 4) return ep.sceneVideo ? 'Assista à cena até o fim' : '';
  if (step === 5) return 'Ouça o diálogo até o fim';
  if (step === 6) {
    const left = ep.mic.filter((m) => s.scores[m.id] == null).length;
    return !left ? '' : left === 1 ? 'Falta gravar 1 frase' : `Faltam ${left} frases para gravar`;
  }
  if (step === 9) {
    const left = ep.ex.reduce((a, ex) => a + ex.items.filter((it) => s.exAns[it.id] == null).length, 0);
    return !left ? '' : left === 1 ? 'Falta 1 resposta' : `Faltam ${left} respostas`;
  }
  if (step === 10) return 'Cante a música até o fim';
  return '';
}

/** gate(): "Etapas livres" (settings.free, only on with the dev.free_steps flag) skips need(). */
export function gate(ep: GateEpisode, s: GateState & { settings: { free: boolean } }, step: number): string {
  return s.settings.free ? '' : need(ep, s, step);
}
