import type { Mood, TutorReply } from '../contracts/ai';
import { analyze, recast } from './analyze';
import { hintFor } from './hints';
import { pronWatch } from './pronWatch';
import { pick, type Rng } from './rng';
import { type DemoSession, fillLine, type ScriptContent, script } from './script';

const ACKS = ['Nice. ', 'Cool. ', 'Oh, I see. ', 'Great. ', ''] as const;
const MOODS: readonly Mood[] = ['happy', 'curious'];

/**
 * Scripted tutor reply (ai.js demoReply): feedback from the demo rules, then the next scripted
 * line. No delay here; the client adds the prototype's 700–1200 ms pause. The rng is consumed in
 * the prototype's order (praise, acknowledgement, mood), so a seeded rng reproduces it exactly.
 */
export function demoReply(sess: DemoSession, text: string, c: ScriptContent, rng: Rng = Math.random): TutorReply {
  const turns = script(sess, c);
  const next = turns[Math.min(sess.turn + 1, turns.length - 1)];
  if (!next) throw new Error('empty script');
  const fb = analyze(text, rng);
  const pre = fb.status === 'ajuste' ? recast(fb.corrected) : fb.status === 'certo' ? pick(ACKS, rng) : '';
  const [hint_en, hint_pt] = hintFor(next.en);
  const pron_watch = pronWatch(text);
  const new_words = (next.words || []).map((w) => ({ en: w.en, pt: w.pt }));
  const mood: Mood = fb.status === 'ajuste' ? 'correcting' : pick(MOODS, rng);
  return {
    reply_en: fillLine(pre + next.en, sess),
    reply_pt: fillLine(next.pt, sess),
    feedback: fb,
    pron_watch,
    new_words,
    mood,
    end: !!next.end || sess.turn + 1 >= turns.length - 1,
    hint_en,
    hint_pt,
    source: 'demo',
  };
}
