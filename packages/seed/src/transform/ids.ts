// Deterministic content ids. User state (mic_scores, exercise_answers, ebook_test_answers) and award
// keys point at these, so they must never depend on anything but the content position.
// v6 prototype state keys are positional ('1-3', '1-0-2', test n); the mappers below turn them into
// the v7 ids (TieState in @tie/shared/state).

export const ids = {
  micPhrase: (ep: number, i: number) => `e${ep}-mic-${i}`,
  exercise: (ep: number, x: number) => `e${ep}-ex${x}`,
  exerciseItem: (ep: number, x: number, i: number) => `e${ep}-ex${x}-i${i}`,
  testQuestion: (ebook: number, n: number) => `eb${ebook}-t${n}`,
  lyric: (ep: number, i: number) => `e${ep}-ly${i}`,
  dialog: (ep: number, i: number) => `e${ep}-dl${i}`,
  visual: (ep: number, i: number) => `e${ep}-vi${i}`,
  track: (album: string, i: number) => `${album}-t${i}`,
  pron: (i: number) => `pron-${i}`,
  /** Media rows are keyed by their path under assets/: 'img/gen/bg/home.webp' → 'm-img-gen-bg-home-webp'. */
  media: (rel: string) =>
    `m-${rel
      .replace(/^assets\//, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()}`,
  plan: (slug: string) => `plan-${slug}`,
} as const;

/** v6 scores key `${ep}-${micIdx}` → phrase id. */
export function phraseIdFromV6(key: string): string | null {
  const m = /^(\d+)-(\d+)$/.exec(key);
  return m ? ids.micPhrase(Number(m[1]), Number(m[2])) : null;
}

/** v6 exAns key `${ep}-${exIdx}-${itemIdx}` → exercise item id. */
export function itemIdFromV6(key: string): string | null {
  const m = /^(\d+)-(\d+)-(\d+)$/.exec(key);
  return m ? ids.exerciseItem(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/** v6 testAns key (question n; the prototype only has e-book 1's test) → question id. */
export function questionIdFromV6(key: string, ebook = 1): string | null {
  return /^\d+$/.test(key) ? ids.testQuestion(ebook, Number(key)) : null;
}
