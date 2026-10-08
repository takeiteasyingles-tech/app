// TIE.data.norm (prototipo/js/data/curriculum.js): the key for typed test answers, SRS card
// dedupe and the `word:{normKey}` award key. Folds curly quotes and common contractions.
export function norm(x: unknown): string {
  return String(x || '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[.,!?;:—–"“”()-]/g, ' ')
    .replace(/\bi am\b/g, "i'm")
    .replace(/\bshe is\b/g, "she's")
    .replace(/\bhe is\b/g, "he's")
    .replace(/\bit is\b/g, "it's")
    .replace(/\bwho is\b/g, "who's")
    .replace(/\s+/g, ' ')
    .trim();
}
