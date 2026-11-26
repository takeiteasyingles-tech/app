// PROD (spec 05 "Take the Mic: how it sounded"): how a Brazilian learner is likely to say a word "the
// Portuguese way", spelled as it sounds (thanks → tanks, this → dis, school → eschool, good → goodi).
// When the transcript holds one of these in a target word's place, scorePronunciation() says so
// ("Soou como “tanks”.") instead of "Não deu para entender esta palavra.".
//
// Not sent to the speech-to-text as a prompt: on Whisper that pushed native takes to the misreading
// (7 of 15 TTS test clips, 2026-11-26).

/** th- words said with a d (voiced th). */
const VOICED_TH = new Set([
  'the',
  'this',
  'that',
  'these',
  'those',
  'they',
  'them',
  'their',
  'there',
  'then',
  'than',
  'though',
  'theirs',
  'themselves',
]);

/** The likely misreadings of one (alignTokens) word, most likely first; [] when none is typical. */
export function misreadingsOf(word: string): string[] {
  const w = word.toLowerCase();
  if (w.length < 2 || !/^[a-z']+$/.test(w)) return [];
  const out: string[] = [];
  if (w.startsWith('th')) {
    const rest = w.slice(2);
    if (VOICED_TH.has(w)) out.push(`d${rest}`);
    else out.push(`t${rest}`, `f${rest}`);
  } else if (/^s[ptkcmnlw]/.test(w)) out.push(`e${w}`);
  if (w.length >= 3 && /th$/.test(w)) out.push(`${w.slice(0, -2)}t`, `${w.slice(0, -2)}f`);
  // A final stop, not a nasal ending (morning, think).
  else if (w.length >= 3 && /[bdgkpt]$/.test(w) && !/n[gk]$/.test(w)) out.push(`${w}i`);
  return [...new Set(out)].filter((m) => m !== w);
}
