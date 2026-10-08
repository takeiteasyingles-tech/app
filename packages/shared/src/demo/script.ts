import type { Bilingual, ExtraMeta, MicCatalog, MicMode, Mission } from '../content/schema';
import type { Opener } from '../contracts/mic';
import { hintFor } from './hints';

// Demo-mode scripts (ai.js script/lines/opener): which lines the assistant says, in order.

export interface DemoSession {
  mode: MicMode;
  mission?: string | null;
  extraId?: string | null;
  /** profile.formats; the first one picks the livre opener. */
  ctxFormats?: readonly string[] | null;
  /** Student name for {N}. */
  name?: string | null;
  /** Assistant name for {A} ("Maggie"). */
  aName?: string | null;
  /** Assistant with article for {oA} ("a Maggie"). */
  aThe?: string | null;
  /** Index of the assistant line being answered (0 = opener). */
  turn: number;
}

export interface ScriptContent {
  mic: Pick<MicCatalog, 'openers' | 'follow'> & { missions: readonly Mission[] };
  extras: readonly Pick<ExtraMeta, 'id' | 'title'>[];
}

export interface ScriptTurn extends Bilingual {
  end?: boolean;
  words?: readonly Bilingual[];
}

const mission = (c: ScriptContent, k: string): Mission | undefined => c.mic.missions.find((m) => m.k === k);

/** missao → mission turns; extra → "series" turns with line 0 about the extra; else opener + FOLLOW. */
export function script(sess: DemoSession, c: ScriptContent): ScriptTurn[] {
  if (sess.mode === 'missao') {
    const m = mission(c, sess.mission || 'gente') ?? mission(c, 'gente') ?? c.mic.missions[0];
    if (!m) throw new Error('no missions in catalog');
    return m.turns;
  }
  if (sess.mode === 'extra') {
    const x = c.extras.find((e) => e.id === sess.extraId) ?? c.extras[0];
    const series = mission(c, 'series');
    if (!x || !series) throw new Error('extra script needs extras and the series mission');
    return series.turns.map((t, i) =>
      i === 0
        ? {
            en: `So, did you watch ${x.title}? What happened in the episode?`,
            pt: `E aí, você viu ${x.title}? O que aconteceu no episódio?`,
            words: t.words,
          }
        : t,
    );
  }
  const f = (sess.ctxFormats || [])[0];
  const opener = (f !== undefined ? c.mic.openers[f] : undefined) ?? c.mic.openers._;
  if (!opener) throw new Error('catalog has no fallback opener "_"');
  return [opener, ...c.mic.follow];
}

/** {N} = student name, {A} = assistant name, {oA} = "a Maggie" / "o Robert". */
export function fillLine(t: string, sess: Pick<DemoSession, 'name' | 'aName' | 'aThe'>): string {
  return String(t || '')
    .split('{N}')
    .join(sess.name || '')
    .split('{A}')
    .join(sess.aName || 'Maggie')
    .split('{oA}')
    .join(sess.aThe || 'a Maggie');
}

/** ai.opener plus the Dica for it (the prototype screen computed hintFor(reply_en) right after). */
export function opener(sess: DemoSession, c: ScriptContent): Opener {
  const s = script(sess, c)[0];
  if (!s) throw new Error('empty script');
  const reply_en = fillLine(s.en, sess);
  const [hint_en, hint_pt] = hintFor(reply_en);
  return {
    reply_en,
    reply_pt: fillLine(s.pt, sess),
    mood: 'happy',
    words: (s.words || []).map((w) => ({ en: w.en, pt: w.pt })),
    hint_en,
    hint_pt,
  };
}
