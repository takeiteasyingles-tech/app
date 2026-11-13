// PROD (spec 05 "Take the Mic in the characters' voices"): who says a Take the Mic phrase, so the
// learner hears it in that character's voice. An explicit "Quem fala" wins; otherwise the phrase names
// its speaker ("My name is Zach", "I'm Margaret") or is (part of) a line of Take It In. null = nobody
// says it: the narration reads it.
import { norm } from './norm';

export interface SpeakerLine {
  who?: string | null;
  en: string;
  stage?: boolean;
}

const words = (s: string): string => ` ${norm(s)} `;

export function micSpeaker(
  en: string,
  dialog: readonly SpeakerLine[],
  cast: readonly string[],
  explicit?: string | null,
): string | null {
  const set = explicit?.trim();
  if (set) return set;
  const t = words(en);
  if (!t.trim()) return null;
  // The phrase introduces a character of the cast.
  for (const name of cast) {
    const n = norm(name);
    if (n && (t.includes(` my name is ${n} `) || t.includes(` i'm ${n} `))) return name;
  }
  // The phrase is said in Take It In (whole words, any case and punctuation).
  for (const d of dialog) {
    const who = d.who?.trim();
    if (d.stage || !who || /^(all|todos)$/i.test(who)) continue;
    if (words(d.en).includes(t)) return who;
  }
  return null;
}
