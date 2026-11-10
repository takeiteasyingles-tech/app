import { STEP } from '../constants';
import type { Episode } from '../content/schema';
import { stepKey, type TieState } from '../state';

// need() from prototipo/js/screens/player.js, keyed by stable ids instead of list indexes:
// scores[phraseId] instead of scores['ep-i'], exAns[itemId] instead of exAns['ep-x-j']. Steps 1-3 follow
// STEP (In this episode, song, Take a Look… sing-along, Take the Test): the prototype's steps without
// its e-book (3), plus the episode test as the last step (0014).
// The server runs the same function before accepting /api/progress/advance.

export type GateEpisode = Pick<Episode, 'num' | 'ebook'> & {
  sceneVideo: string | null | undefined;
  mic: readonly { id: string }[];
  ex: readonly { items: readonly { id: string }[] }[];
  /** Questions of the episode test (Take the Test); 0 or absent = no test, the step does not gate. */
  testCount?: number;
};

export type GateState = Pick<TieState, 'ebooks' | 'epsDone' | 'prog' | 'stepOk' | 'scores' | 'exAns'> &
  Partial<Pick<TieState, 'testDone'>>;

/** What is still missing before the step lets the student move on ('' = unlocked). */
export function need(ep: GateEpisode, s: GateState, step: number): string {
  if (s.epsDone[ep.num] || (s.prog[ep.num] || 1) > step || s.stepOk[stepKey(ep.num, step)]) return '';
  if (step === STEP.INTRO) return 'Ouça a apresentação até o fim';
  if (step === STEP.SONG) return 'Ouça a música até o fim';
  if (step === STEP.LOOK) return ep.sceneVideo ? 'Assista à cena até o fim' : '';
  if (step === STEP.DIALOG) return 'Ouça o diálogo até o fim';
  if (step === STEP.MIC) {
    const left = ep.mic.filter((m) => s.scores[m.id] == null).length;
    return !left ? '' : left === 1 ? 'Falta gravar 1 frase' : `Faltam ${left} frases para gravar`;
  }
  if (step === STEP.ACTION) {
    const left = ep.ex.reduce((a, ex) => a + ex.items.filter((it) => s.exAns[it.id] == null).length, 0);
    return !left ? '' : left === 1 ? 'Falta 1 resposta' : `Faltam ${left} respostas`;
  }
  if (step === STEP.SING) return 'Cante a música até o fim';
  if (step === STEP.TEST) return !ep.testCount || (ep.ebook != null && s.testDone?.[ep.ebook]) ? '' : 'Faça o teste até o fim';
  return '';
}

/** gate(): "Etapas livres" (settings.free, only on with the dev.free_steps flag) skips need(). */
export function gate(ep: GateEpisode, s: GateState & { settings: { free: boolean } }, step: number): string {
  return s.settings.free ? '' : need(ep, s, step);
}
