import { norm } from './norm';

// PROD (0017, mic_phrases.who): who says a Mic phrase, so TTS reads it with that character's voice.

const words = (s: string) => ` ${norm(s)} `;

/** The dialog fields micSpeaker reads. */
export interface MicSpeakerLine {
  who?: string | null;
  en: string;
  stage?: boolean;
}

/**
 * The character who says a Mic phrase: the explicit choice ("Quem fala") when set; else a cast member
 * the phrase introduces ("my name is X", "I'm X"); else the speaker of the first dialog line that
 * contains the phrase (stage directions and "All"/"Todos" excluded). null = the narration.
 */
export function micSpeaker(
  en: string,
  dialog: readonly MicSpeakerLine[],
  cast: readonly string[],
  explicit?: string | null,
): string | null {
  const set = explicit?.trim();
  if (set) return set;
  const t = words(en);
  if (!t.trim()) return null;
  for (const name of cast) {
    const n = norm(name);
    if (n && (t.includes(` my name is ${n} `) || t.includes(` i'm ${n} `))) return name;
  }
  for (const d of dialog) {
    const who = d.who?.trim();
    if (d.stage || !who || /^(all|todos)$/i.test(who)) continue;
    if (words(d.en).includes(t)) return who;
  }
  return null;
}
